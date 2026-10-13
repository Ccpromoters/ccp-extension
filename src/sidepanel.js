// Side panel UI. Runs inside the extension; when opened as a plain web page (dev harness) it
// loads a chrome.* shim so the interface can be previewed without installing the extension.
if (!globalThis.chrome?.runtime?.id) await import("../dev/chrome-shim.js");

import { BOARDS } from "./lib/boards.js";
import { KIND_LABELS } from "./lib/classify.js";
import { getSettings, getJobs, getMail, getResumes, getJdLibrary, getScanState, upsertJobs, updateJob, deleteJob, b64ToBytes, bytesToB64, addTailorRecord, getProfile, saveProfile } from "./lib/storage.js";
import { tailorResume, parseList } from "./lib/tailor.js";
import { openDocx, blocksText } from "./lib/docx.js";
import { findSkills } from "./lib/skills-dict.js";
import { cloudStatus, invoke as cloudInvoke, syncProfile } from "./lib/cloud.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY = 86400e3;
const fmtDate = (ts) => (ts ? new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const ago = (ts) => {
  if (!ts) return "never";
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
};
const boardName = (k) => BOARDS[k]?.name || (k === "email" ? "Email" : k === "web" ? "Web" : k || "");
const safeName = (s) => String(s || "").replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

let settings = {};
let jobs = {};
let mail = {};
let resumes = [];
let mailKind = "recruiter";
let lastTailor = null;

function status(msg, cls = "") {
  const el = $("#status");
  el.textContent = msg;
  el.className = `status ${cls}`;
}

async function send(msg) {
  const r = await chrome.runtime.sendMessage(msg);
  if (r?.error) throw new Error(r.error);
  return r;
}

// ----------------------------------------------------------------------------- tabs

for (const b of document.querySelectorAll(".tabs button")) {
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === `tab-${b.dataset.tab}`));
    try {
      localStorage.setItem("ccp.tab", b.dataset.tab);
    } catch {}
  });
}
try {
  const t = localStorage.getItem("ccp.tab");
  if (t) document.querySelector(`.tabs button[data-tab="${t}"]`)?.click();
} catch {}

$("#btnSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ----------------------------------------------------------------------------- data + render

let cloud = { signedIn: false };
let cloudJobs = [];
let apply = null; // the application currently being prepared

async function reload() {
  [settings, jobs, mail, resumes, cloud] = await Promise.all([getSettings(), getJobs(), getMail(), getResumes(), cloudStatus()]);
  const who = settings.candidateName ? `${settings.candidateName}${settings.targetTitles ? " · " + settings.targetTitles.split(/[,\n]/)[0].trim() : ""}` : "No candidate set yet — open Settings";
  $("#who").textContent = cloud.signedIn ? `${who} · ${cloud.accessOk ? "CCP Cloud ✓" : "CCP Cloud (no access code)"}` : `${who} · not signed in to CCP Cloud`;
  renderHome();
  renderJobs();
  renderInbox();
  renderResumeTab();
  renderCloudJobs();
}

function jobList() {
  return Object.values(jobs).map((j) => ({ ...j, when: j.appliedAt || j.lastSeen || j.firstSeen || 0 }));
}

function renderHome() {
  const since = Date.now() - 7 * DAY;
  const all = jobList();
  const applied7 = all.filter((j) => j.status === "applied" && j.when >= since);
  const viewed7 = all.filter((j) => j.status !== "applied" && j.when >= since);
  const mails = Object.values(mail);
  $("#stApplied").textContent = applied7.length;
  $("#stViewed").textContent = viewed7.length;
  $("#stRecruiters").textContent = mails.filter((m) => (m.kind === "recruiter" || m.kind === "rtr") && m.dateTs >= since).length;
  $("#stInterviews").textContent = mails.filter((m) => m.kind === "interview" && m.dateTs >= since).length;
  $("#jobsCount").textContent = all.filter((j) => j.status === "applied").length || "";
  $("#inboxCount").textContent = mails.filter((m) => m.kind === "recruiter" || m.kind === "rtr").length || "";

  getScanState().then((s) => {
    $("#lastScan").textContent = `Last scans — history: ${ago(s.lastHistoryScan)} · Gmail: ${ago(s.lastGmailScan)} · board lists: ${ago(s.lastAppliedScan)}`;
  });

  const recent = all.filter((j) => j.status === "applied").sort((a, b) => b.when - a.when).slice(0, 5);
  $("#homeRecent").innerHTML = recent.length ? recent.map(jobItem).join("") : `<div class="empty">No applications recorded yet. Run a scan.</div>`;
  const rm = mails.filter((m) => m.kind === "recruiter" || m.kind === "rtr" || m.kind === "interview").sort((a, b) => b.dateTs - a.dateTs).slice(0, 5);
  $("#homeMail").innerHTML = rm.length ? rm.map(mailItem).join("") : `<div class="empty">No recruiter mail recorded yet.</div>`;
  bindJobActions($("#homeRecent"));
  bindMailActions($("#homeMail"));
}

function jobItem(j) {
  const label = j.status === "applied" ? "Applied" : j.status === "likely" ? "Likely applied" : "Viewed";
  const srcs = (j.sources || []).join(", ");
  return `<div class="item" data-key="${esc(j.key)}">
    <div class="t"><a href="${esc(j.url || "#")}" target="_blank" rel="noopener">${esc(j.title || "(untitled job)")}</a></div>
    <div class="m"><span>${esc(j.company || "")}</span><span>${esc(boardName(j.board))}</span><span>${fmtDate(j.when)}</span><span class="badge ${j.status}">${label}</span>${srcs ? `<span title="sources">${esc(srcs)}</span>` : ""}</div>
    <div class="acts">${j.status !== "applied" ? `<button class="small" data-act="applied">Mark applied</button>` : ""}<button class="small" data-act="delete">Remove</button></div>
  </div>`;
}

function bindJobActions(root) {
  root.querySelectorAll("[data-act]").forEach((b) => {
    b.addEventListener("click", async (e) => {
      const key = e.target.closest(".item").dataset.key;
      if (b.dataset.act === "applied") await updateJob(key, { status: "applied", appliedAt: Date.now(), sources: [...new Set([...(jobs[key]?.sources || []), "manual"])] });
      else await deleteJob(key);
      await reload();
    });
  });
}

function renderJobs() {
  const st = $("#jobStatus").value;
  const days = +$("#jobRange").value;
  const q = $("#jobSearch").value.trim().toLowerCase();
  const since = days ? Date.now() - days * DAY : 0;
  const rows = jobList()
    .filter((j) => (!st || j.status === st) && j.when >= since && (!q || `${j.title} ${j.company}`.toLowerCase().includes(q)))
    .sort((a, b) => b.when - a.when);
  $("#jobList").innerHTML = rows.length ? rows.map(jobItem).join("") : `<div class="empty">Nothing here yet. Click “Scan history + Gmail” on Home, or apply to jobs on the boards and scan again.</div>`;
  bindJobActions($("#jobList"));
}
["#jobStatus", "#jobRange", "#jobSearch"].forEach((s) => $(s).addEventListener("input", renderJobs));

function mailItem(m) {
  return `<div class="item clickable" data-url="${esc(m.url || "")}">
    <div class="t">${esc(m.subject || "(no subject)")}</div>
    <div class="m"><span>${esc(m.recruiter || m.from || "")}</span><span>${fmtDate(m.dateTs)}</span><span class="badge ${esc(m.kind)}">${esc(KIND_LABELS[m.kind] || m.kind)}</span>${(m.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join("")}</div>
    ${m.snippet ? `<div class="snippet">${esc(m.snippet)}</div>` : ""}
  </div>`;
}

function bindMailActions(root) {
  root.querySelectorAll(".item.clickable").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.url) chrome.tabs.create({ url: el.dataset.url });
    });
  });
}

function renderInbox() {
  const mails = Object.values(mail);
  const counts = {};
  for (const m of mails) counts[m.kind] = (counts[m.kind] || 0) + 1;
  const kinds = ["recruiter", "rtr", "interview", "applied", "rejection", "other"];
  $("#mailKinds").innerHTML = kinds.map((k) => `<span class="chip ${k === mailKind ? "active" : ""}" data-kind="${k}">${esc(KIND_LABELS[k])} ${counts[k] ? `(${counts[k]})` : ""}</span>`).join("");
  $("#mailKinds").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { mailKind = c.dataset.kind; renderInbox(); }));
  const rows = mails.filter((m) => m.kind === mailKind).sort((a, b) => (b.dateTs || 0) - (a.dateTs || 0));
  $("#mailList").innerHTML = rows.length ? rows.map(mailItem).join("") : `<div class="empty">No ${esc(KIND_LABELS[mailKind]).toLowerCase()} mail found yet. Run “Scan history + Gmail”.</div>`;
  bindMailActions($("#mailList"));
}

// ----------------------------------------------------------------------------- home actions

async function run(btn, label, fn) {
  const p = $("#progress");
  btn.disabled = true;
  p.textContent = label;
  p.classList.remove("hidden");
  try {
    const r = await fn();
    status(r, "ok");
  } catch (e) {
    status(e.message, "error");
  } finally {
    btn.disabled = false;
    p.classList.add("hidden");
    await reload();
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "SCAN_PROGRESS") {
    const p = $("#progress");
    p.textContent = `${msg.label}${msg.total > 1 ? ` (${msg.step}/${msg.total})` : ""}`;
    p.classList.remove("hidden");
  }
});

$("#btnOpen").addEventListener("click", (e) => run(e.target, "Opening job boards…", async () => {
  const r = await send({ type: "OPEN_BOARDS" });
  return `Opened ${r.opened} tab(s)${r.skipped ? `, ${r.skipped} already open` : ""}.`;
}));

$("#btnScanAll").addEventListener("click", (e) => run(e.target, "Scanning browser history…", async () => {
  const h = await send({ type: "SCAN_HISTORY" });
  const g = await send({ type: "SCAN_GMAIL" });
  const kinds = Object.entries(g.byKind || {}).map(([k, n]) => `${n} ${k}`).join(", ");
  return `History: ${h.matched} job pages in ${h.days} days (${h.added} new). Gmail: ${g.rows} threads (${kinds || "none"}), ${g.jobsAdded} new applications.`;
}));

$("#btnScanApplied").addEventListener("click", (e) => run(e.target, "Reading the boards' applied lists…", async () => {
  const r = await send({ type: "SCAN_APPLIED" });
  const per = Object.entries(r.perBoard || {}).map(([k, v]) => `${boardName(k)}: ${v}`).join(", ");
  return `Applied lists read — ${per}. ${r.added} new, ${r.updated} updated.`;
}));

$("#btnReport").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/report.html?days=7") }));

$("#btnCsv").addEventListener("click", async () => {
  const rows = jobList().sort((a, b) => b.when - a.when);
  const head = ["date", "status", "title", "company", "location", "board", "url", "sources"];
  const csv = [head.join(",")].concat(rows.map((j) => [new Date(j.when).toISOString().slice(0, 10), j.status, j.title, j.company, j.location, boardName(j.board), j.url, (j.sources || []).join(" ")].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
  await chrome.downloads.download({ url, filename: `CCP Extension/${safeName(settings.candidateName || "candidate")}-applications-${new Date().toISOString().slice(0, 10)}.csv`, saveAs: false });
  status("CSV saved to your Downloads folder.", "ok");
});

// ----------------------------------------------------------------------------- resume tab

function renderResumeTab() {
  const sel = $("#resumeSelect");
  const cur = sel.value || settings.defaultResumeId;
  sel.innerHTML = resumes.length
    ? resumes.map((r) => `<option value="${esc(r.id)}" ${r.id === cur ? "selected" : ""}>${esc(r.label || r.fileName)}</option>`).join("")
    : `<option value="">No master resume uploaded</option>`;
  $("#resumeHint").innerHTML = resumes.length
    ? `${resumes.length} master resume(s) on file. <button class="link" id="lnkSettings">Manage</button>`
    : `Upload the candidate's final resume (.docx) in <button class="link" id="lnkSettings">Settings</button> first.`;
  $("#lnkSettings")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#btnTailor").disabled = !resumes.length;
}

$("#btnUseTab").addEventListener("click", async () => {
  try {
    status("Reading the job posting from the current tab…");
    const jd = await send({ type: "GET_ACTIVE_JD" });
    $("#jdText").value = jd.text;
    $("#jobTitle").value = jd.title || "";
    $("#jobCompany").value = jd.company || "";
    $("#jdMeta").textContent = `From ${boardName(jd.board)}: ${jd.title || "?"}${jd.company ? " @ " + jd.company : ""}${jd.location ? " · " + jd.location : ""}`;
    $("#jdMeta").dataset.url = jd.url || "";
    status(`Job description loaded (${jd.text.length.toLocaleString()} characters).`, "ok");
  } catch (e) {
    status(e.message, "error");
  }
});

$("#btnTailor").addEventListener("click", async () => {
  const resume = resumes.find((r) => r.id === $("#resumeSelect").value) || resumes[0];
  const jdText = $("#jdText").value.trim();
  if (!resume) return status("Upload a master resume in Settings first.", "error");
  if (jdText.length < 80) return status("Paste the full job description first.", "error");
  const btn = $("#btnTailor");
  const prog = $("#tailorProgress");
  btn.disabled = true;
  prog.classList.remove("hidden");
  $("#tailorResult").innerHTML = "";
  const job = { title: $("#jobTitle").value.trim(), company: $("#jobCompany").value.trim(), url: $("#jdMeta").dataset.url || "" };
  try {
    const result = await tailorResume({
      resumeBytes: b64ToBytes(resume.dataB64),
      jdText,
      job,
      settings,
      approvedOverrides: parseList($("#overrides").value),
      onProgress: (m) => (prog.textContent = m),
    });
    const title = job.title || result.plan.job?.title || "";
    const company = job.company || result.plan.job?.company || "";
    const fileName = `${safeName(settings.candidateName || resume.label || "Resume")}_Resume${company ? "_" + safeName(company) : ""}${title ? "_" + safeName(title) : ""}.docx`.replace(/\s+/g, "_");
    lastTailor = { ...result, fileName, title, company, resumeId: resume.id, url: job.url };
    renderTailorResult(lastTailor);
    await addTailorRecord({ title, company, url: job.url, resumeId: resume.id, fileName, changes: result.changes.length, gaps: result.plan.gaps, experienceGap: result.plan.experience_gap });
    status(`Done: ${result.changes.length} change(s). Review, then download.`, "ok");
  } catch (e) {
    $("#tailorResult").innerHTML = `<div class="card"><div class="banner bad">${esc(e.message)}</div>${/API key/i.test(e.message) ? `<button class="small" id="lnkKey">Open Settings</button>` : ""}</div>`;
    $("#lnkKey")?.addEventListener("click", () => chrome.runtime.openOptionsPage());
    status("Tailoring failed.", "error");
  } finally {
    btn.disabled = false;
    prog.classList.add("hidden");
  }
});

function renderTailorResult(r) {
  const p = r.plan;
  const years = p.job?.years_required ?? r.yearsRequired;
  let banner = "";
  if (p.experience_gap) banner = `<div class="banner bad"><b>Experience gap:</b> ${esc(p.experience_gap)} Dates were not changed — decide whether to submit.</div>`;
  else if (years) banner = `<div class="banner ok">Experience: the JD asks for ${years}+ years${p.candidate_years ? `; the resume shows about ${p.candidate_years}` : ""}.</div>`;

  const li = (arr) => arr.map((s) => `<li>${esc(s)}</li>`).join("");
  const skills = r.changes.filter((c) => c.type === "skill");
  const bullets = r.changes.filter((c) => c.type.startsWith("bullet"));
  const summary = r.changes.filter((c) => c.type === "summary");
  const html = `<div class="card">
    ${banner}
    <div><b>${esc(r.title || "Job")}</b>${r.company ? ` @ ${esc(r.company)}` : ""} · ${r.changes.length} change(s), ~${r.wordsAdded} words added${r.usage ? ` · ${(r.usage.input_tokens || 0) + (r.usage.output_tokens || 0)} tokens` : ""}</div>
    <h4>Skills added</h4>
    ${skills.length ? `<ul>${skills.map((c) => `<li><b>${esc(c.label)}:</b> <span class="plus">+ ${esc(c.added.join(", "))}</span></li>`).join("")}</ul>` : `<div class="muted small">None</div>`}
    <h4>Bullet points</h4>
    ${bullets.length ? `<ul class="diff">${bullets.map((c) => c.type === "bullet-add"
      ? `<li><span class="plus">+ New bullet</span> (after “${esc(c.anchor.slice(0, 50))}…”)<span class="after">${esc(c.text)}</span></li>`
      : `<li><span class="before">${esc(c.before)}</span><span class="after">${esc(c.after)}</span></li>`).join("")}</ul>` : `<div class="muted small">None</div>`}
    ${summary.length ? `<h4>Summary</h4><ul class="diff">${summary.map((c) => `<li><span class="before">${esc(c.before)}</span><span class="after">${esc(c.after)}</span></li>`).join("")}</ul>` : ""}
    ${p.gaps?.length ? `<h4>JD requirements the candidate does not have</h4><ul>${li(p.gaps)}</ul>` : ""}
    ${p.confirm?.length ? `<h4>Confirm with the candidate before adding</h4><ul>${li(p.confirm)}</ul>` : ""}
    ${r.warnings?.length ? `<div class="banner warn">${esc(r.warnings.join(" · "))}</div>` : ""}
    ${p.notes ? `<div class="muted small" style="margin-top:8px">${esc(p.notes)}</div>` : ""}
    <details style="margin-top:8px"><summary class="small">Already matched (${(p.already_matched || []).length}) · Dropped suggestions (${r.dropped.length}) · Keyword check</summary>
      ${p.already_matched?.length ? `<h4>Already in the resume</h4><ul>${li(p.already_matched)}</ul>` : ""}
      ${r.dropped?.length ? `<h4>Dropped by the safety rules</h4><ul>${li(r.dropped)}</ul>` : ""}
      <h4>Dictionary keyword check</h4>
      <div class="small">Matched: ${esc(r.keyword.matched.join(", ") || "—")}<br>Missing in resume: ${esc(r.keyword.missing.join(", ") || "—")}</div>
    </details>
    <div class="acts">
      <button class="primary" id="btnDownload">Download tailored .docx</button>
      <button id="btnMarkApplied">Mark as applied</button>
      <button id="btnCopySummary">Copy summary</button>
    </div>
  </div>`;
  $("#tailorResult").innerHTML = html;
  $("#btnDownload").addEventListener("click", async () => {
    const url = URL.createObjectURL(new Blob([r.bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    await chrome.downloads.download({ url, filename: `CCP Extension/${r.fileName}`, saveAs: false, conflictAction: "uniquify" });
    status(`Saved to Downloads/CCP Extension/${r.fileName}`, "ok");
  });
  $("#btnMarkApplied").addEventListener("click", async () => {
    const key = `manual:${(r.title || "").toLowerCase()}@${(r.company || "").toLowerCase()}`;
    await upsertJobs([{ key, board: "manual", jobId: null, title: r.title, company: r.company, url: r.url, status: "applied", source: "manual", firstSeen: Date.now(), lastSeen: Date.now(), appliedAt: Date.now() }]);
    await reload();
    status("Recorded as applied.", "ok");
  });
  $("#btnCopySummary").addEventListener("click", async () => {
    const lines = [
      `${settings.candidateName || "Candidate"} – resume for ${r.title || "job"}${r.company ? " at " + r.company : ""}`,
      ...skills.map((c) => `Skills (${c.label}): + ${c.added.join(", ")}`),
      ...bullets.map((c) => (c.type === "bullet-add" ? `New bullet: ${c.text}` : `Bullet: ${c.after}`)),
      ...(p.experience_gap ? [`Experience gap: ${p.experience_gap}`] : []),
      ...(p.gaps?.length ? [`Gaps: ${p.gaps.join("; ")}`] : []),
      ...(p.confirm?.length ? [`Confirm with candidate: ${p.confirm.join("; ")}`] : []),
      `File: ${r.fileName}`,
    ];
    await navigator.clipboard.writeText(lines.join("\n"));
    status("Summary copied.", "ok");
  });
}

// market gap: skills demanded by the JDs the user viewed vs. the selected master resume
$("#marketGap").addEventListener("toggle", async (e) => {
  if (!e.target.open) return;
  const body = $("#marketGapBody");
  body.textContent = "Analysing…";
  try {
    const lib = await getJdLibrary();
    const words = (settings.targetTitles || "").toLowerCase().split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    const rel = lib.filter((j) => !words.length || words.some((w) => (j.title || "").toLowerCase().includes(w.split(" ")[0])));
    if (!rel.length) {
      body.innerHTML = `No job descriptions captured yet. Open postings on LinkedIn, Indeed, ZipRecruiter, Dice or Monster and they are collected automatically.`;
      return;
    }
    const resume = resumes.find((x) => x.id === $("#resumeSelect").value) || resumes[0];
    let have = new Set();
    if (resume) {
      const doc = await openDocx(b64ToBytes(resume.dataB64));
      have = new Set(findSkills(blocksText(doc.blocks)).map((s) => s.name));
    }
    const counts = {};
    for (const j of rel) for (const s of j.skills || []) counts[s] = (counts[s] || 0) + 1;
    const missing = Object.entries(counts).filter(([s]) => !have.has(s)).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const matched = Object.entries(counts).filter(([s]) => have.has(s)).sort((a, b) => b[1] - a[1]).slice(0, 15);
    const yrs = rel.map((j) => j.years).filter(Boolean);
    body.innerHTML = `<div>${rel.length} job description(s) analysed${yrs.length ? `; typical ask: ${Math.round(yrs.reduce((a, b) => a + b, 0) / yrs.length)} years` : ""}.</div>
      <h4>Asked for, missing in the resume</h4>${missing.length ? `<ul>${missing.map(([s, n]) => `<li>${esc(s)} <span class="muted">(${n} of ${rel.length})</span></li>`).join("")}</ul>` : "<div class='muted'>Nothing missing from the dictionary list.</div>"}
      <h4>Asked for, already in the resume</h4>${matched.length ? `<ul>${matched.map(([s, n]) => `<li>${esc(s)} <span class="muted">(${n})</span></li>`).join("")}</ul>` : "—"}
      <div class="muted" style="margin-top:6px">Add a missing skill only if the candidate truly has it — ask them first.</div>`;
  } catch (err) {
    body.textContent = err.message;
  }
});

// ----------------------------------------------------------------------------- CCP Cloud: find jobs + apply assist

function needCloud() {
  if (!cloud.signedIn) {
    status("Sign in to CCP Cloud first (Settings → CCP Cloud account).", "error");
    return false;
  }
  return true;
}

async function loadCloudJobs() {
  if (!cloud.signedIn) return;
  try {
    const r = await cloudInvoke("ccp-log", null, { method: "GET" });
    cloudJobs = r.jobs || [];
    renderCloudJobs();
  } catch (e) {
    $("#findMsg").textContent = e.message;
  }
}

function renderCloudJobs() {
  const list = $("#cloudJobs");
  if (!cloud.signedIn) {
    list.innerHTML = `<div class="empty">Sign in to CCP Cloud (Settings) to search employers' career sites and get one-click applications.</div>`;
    return;
  }
  const open = cloudJobs.filter((j) => ["found", "approved", "prepared"].includes(j.status));
  if (!open.length) {
    list.innerHTML = `<div class="empty">No open leads. Click “Find jobs for me”.</div>`;
    return;
  }
  list.innerHTML = open.map((j) => `<div class="item" data-id="${esc(j.id)}">
      <div class="t"><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a></div>
      <div class="m"><span>${esc(j.company || "")}</span><span>${esc(j.location || "")}</span><span class="badge">${esc(j.ats || j.source || "")}</span>${j.score ? `<span class="badge">${Math.round(j.score * 100)}% match</span>` : ""}${j.years_required ? `<span>${j.years_required}+ yrs</span>` : ""}${j.status === "prepared" ? `<span class="badge likely">prepared</span>` : ""}</div>
      <div class="acts"><button class="small primary" data-act="apply">Prepare &amp; apply</button><button class="small" data-act="skip">Skip</button></div>
    </div>`).join("");
  list.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async (e) => {
    const id = e.target.closest(".item").dataset.id;
    const job = cloudJobs.find((j) => j.id === id);
    if (b.dataset.act === "skip") {
      await cloudInvoke("ccp-log", { job_id: id, job_status: "skipped" }).catch(() => {});
      cloudJobs = cloudJobs.map((j) => (j.id === id ? { ...j, status: "skipped" } : j));
      renderCloudJobs();
    } else startApply(job);
  }));
}

$("#btnFindJobs").addEventListener("click", async () => {
  if (!needCloud()) return;
  const btn = $("#btnFindJobs");
  btn.disabled = true;
  $("#findMsg").textContent = "Searching employers' career sites…";
  try {
    const r = await cloudInvoke("ccp-research-jobs", { limit: +$("#findLimit").value || 20 });
    $("#findMsg").textContent = `${r.employers} employers read, ${r.fetched} openings, ${r.matched} match your targets, ${r.added} new.`;
    await loadCloudJobs();
  } catch (e) {
    $("#findMsg").textContent = e.message;
  } finally {
    btn.disabled = false;
  }
});

$("#btnDiscover").addEventListener("click", async () => {
  if (!needCloud()) return;
  const names = parseList($("#discoverNames").value);
  if (!names.length) return;
  $("#findMsg").textContent = "Looking for their career-site feeds…";
  try {
    const r = await cloudInvoke("ccp-research-jobs", { discover: names, limit: +$("#findLimit").value || 20 });
    $("#findMsg").textContent = `${r.discovered.length} of ${names.length} employers found (${r.discovered.map((d) => d.name).join(", ") || "none"}); ${r.added} new jobs.`;
    $("#discoverNames").value = "";
    await loadCloudJobs();
  } catch (e) {
    $("#findMsg").textContent = e.message;
  }
});

async function ensureSiteAccess(url) {
  try {
    const origin = new URL(url).origin + "/*";
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return true;
  }
}

function applyCard(html) {
  $("#applyCard").innerHTML = `<div class="card">${html}</div>`;
}

async function startApply(job) {
  if (!needCloud()) return;
  const resume = resumes.find((r) => r.id === settings.defaultResumeId) || resumes[0];
  if (!resume) return status("Upload your master resume first (Settings).", "error");
  const target = job.apply_url || job.url;
  if (!(await ensureSiteAccess(target))) return status("Site access was not granted; the form cannot be filled.", "error");
  apply = { job, resume, tabId: null, questions: [], answers: [], manual: {}, app: null };
  applyCard(`<b>${esc(job.title)}</b> @ ${esc(job.company || "")}<div id="applyProgress" class="progress">Opening the application page…</div>`);
  const prog = (m) => { const p = $("#applyProgress"); if (p) p.textContent = m; };
  try {
    const opened = await send({ type: "APPLY_OPEN", url: target, active: true });
    apply.tabId = opened.tabId;
    // 1. job description (feed text, else the page itself)
    let jd = job.description || "";
    if (jd.length < 300) {
      prog("Reading the job description from the page…");
      const pt = await send({ type: "PAGE_TEXT", tabId: apply.tabId });
      jd = pt.text || "";
    }
    // 2. tailored resume
    prog("Tailoring your resume for this job…");
    const result = await tailorResume({ resumeBytes: b64ToBytes(resume.dataB64), jdText: jd, job: { title: job.title, company: job.company, url: job.url }, settings, approvedOverrides: [], onProgress: prog });
    const fileName = `${safeName(settings.candidateName || "Resume")}_Resume_${safeName(job.company || "")}_${safeName(job.title || "")}.docx`.replace(/\s+/g, "_");
    apply.tailored = { ...result, fileName, title: job.title, company: job.company, resumeId: resume.id, url: job.url };
    lastTailor = apply.tailored;
    renderTailorResult(lastTailor);
    const url = URL.createObjectURL(new Blob([result.bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
    await chrome.downloads.download({ url, filename: `CCP Extension/${fileName}`, saveAs: false, conflictAction: "uniquify" }).catch(() => {});
    await addTailorRecord({ title: job.title, company: job.company, url: job.url, resumeId: resume.id, fileName, changes: result.changes.length, gaps: result.plan.gaps, experienceGap: result.plan.experience_gap });
    // 3. the form
    prog("Reading the application form…");
    await fillCurrentPage(prog);
  } catch (e) {
    applyCard(`<div class="banner bad">${esc(e.message)}</div><div class="acts"><button class="small" id="btnApplyClose">Close</button></div>`);
    $("#btnApplyClose").addEventListener("click", () => { apply = null; $("#applyCard").innerHTML = ""; });
  }
}

async function fillCurrentPage(prog = () => {}) {
  const scan = await send({ type: "APPLY_SCAN", tabId: apply.tabId });
  apply.scan = scan;
  apply.questions = scan.questions || [];
  if (!apply.questions.length) {
    renderApplyCard({ note: "No form fields on this page yet. Click Apply on the page (or sign in there), then press “Scan this page”." });
    return;
  }
  prog(`Answering ${apply.questions.length} questions from your profile…`);
  const r = await cloudInvoke("ccp-answer", { questions: apply.questions.map((q) => ({ id: q.id, label: q.label, type: q.type, options: q.options, required: q.required })), job: { title: apply.job.title, company: apply.job.company, ats: scan.ats } });
  apply.answers = r.answers || [];
  for (const a of apply.answers) if (apply.manual[a.id] != null) { a.answer = apply.manual[a.id]; a.source = "you"; a.needs_candidate = false; }
  prog("Filling the form…");
  const fill = await send({ type: "APPLY_FILL", tabId: apply.tabId, answers: apply.answers.filter((a) => a.answer != null && a.answer !== ""), resume: { fileName: apply.tailored.fileName, bytesB64: bytesToB64(apply.tailored.bytes) } });
  apply.report = fill.report || [];
  // record as prepared
  try {
    const log = await cloudInvoke("ccp-log", { job_id: apply.job.id, job_status: "prepared", application: { id: apply.app?.id, job_id: apply.job.id, job_url: apply.job.url, company: apply.job.company, title: apply.job.title, ats: scan.ats, resume_file_name: apply.tailored.fileName, answers: Object.fromEntries(apply.answers.map((a) => [a.id, { q: apply.questions.find((q) => q.id === a.id)?.label, a: a.answer, src: a.source }])), changes: apply.tailored.changes, status: "prepared" } });
    apply.app = log.application || apply.app;
  } catch {}
  renderApplyCard({});
}

function renderApplyCard({ note = "" } = {}) {
  const qById = Object.fromEntries(apply.questions.map((q) => [q.id, q]));
  const rep = Object.fromEntries((apply.report || []).map((r) => [r.id, r]));
  const filled = apply.answers.filter((a) => a.answer != null && a.answer !== "" && !a.needs_candidate);
  const needs = apply.answers.filter((a) => a.needs_candidate || a.answer == null || a.answer === "");
  const gap = apply.tailored?.plan?.experience_gap;
  const html = `
    <b>${esc(apply.job.title)}</b> @ ${esc(apply.job.company || "")} <span class="badge">${esc(apply.scan?.ats || "")}</span>
    ${gap ? `<div class="banner bad" style="margin-top:6px">${esc(gap)}</div>` : ""}
    ${note ? `<div class="banner warn">${esc(note)}</div>` : ""}
    <div class="small muted" style="margin:6px 0">Resume: ${esc(apply.tailored?.fileName || "")} (${apply.tailored?.changes?.length ?? 0} changes — details on the Resume tab)</div>
    <h4>Filled from your profile (${filled.length})</h4>
    <ul class="small">${filled.map((a) => `<li>${esc(qById[a.id]?.label || a.id)}: <b>${esc(String(rep[a.id]?.value ?? a.answer))}</b>${rep[a.id] && rep[a.id].ok === false ? ` <span class="badge rejection">not filled: ${esc(rep[a.id].note || "")}</span>` : ""}${a.source === "ai" ? ' <span class="badge">AI</span>' : ""}${rep[a.id]?.note ? ` <span class="muted">${esc(rep[a.id].note)}</span>` : ""}</li>`).join("") || "<li class='muted'>none</li>"}</ul>
    ${needs.length ? `<h4>Needs you (${needs.length})</h4><div class="small">${needs.map((a) => { const q = qById[a.id] || {}; const opts = q.options?.length ? `<select data-q="${esc(a.id)}"><option value="">choose…</option>${q.options.map((o) => `<option>${esc(o)}</option>`).join("")}</select>` : `<input data-q="${esc(a.id)}" placeholder="${esc(a.note || "your answer")}">`; return `<div class="row"><span style="flex:1">${esc(q.label || a.id)}${q.required ? " *" : ""}</span>${opts}</div>`; }).join("")}<button class="small" id="btnApplyFillMine">Fill my answers</button></div>` : ""}
    <div class="acts">
      <button class="primary" id="btnApplySubmit">${apply.scan?.submitText ? `Submit (“${esc(apply.scan.submitText)}”)` : "Submit application"}</button>
      <button id="btnApplyNext">Next page</button>
      <button id="btnApplyRescan">Scan this page</button>
      <button id="btnApplyShow">Show tab</button>
      <button id="btnApplyManual">I submitted it myself</button>
      <button id="btnApplyCancel">Cancel</button>
    </div>
    <div class="muted small" style="margin-top:6px">Check the page before submitting. Sponsorship and EEO answers come only from your profile.</div>`;
  applyCard(html);
  $("#btnApplyFillMine")?.addEventListener("click", async () => {
    const extra = {};
    for (const el of $("#applyCard").querySelectorAll("[data-q]")) if (el.value) { apply.manual[el.dataset.q] = el.value; extra[norm(qById[el.dataset.q]?.label)] = el.value; }
    if (Object.keys(extra).length) {
      const p = await getProfile();
      await saveProfile({ extra_answers: { ...(p.extra_answers || {}), ...extra } });
      syncProfile(await getProfile()).catch(() => {});
    }
    status("Filling your answers…");
    await fillCurrentPage();
    status("Done. Review the page, then Submit.", "ok");
  });
  $("#btnApplySubmit").addEventListener("click", async () => {
    const r = await send({ type: "APPLY_SUBMIT", tabId: apply.tabId });
    if (!r.clicked) return status(r.note || "Could not find the submit button — click it on the page, then press “I submitted it myself”.", "error");
    await markSubmitted(`Clicked “${r.text}”.`);
  });
  $("#btnApplyNext").addEventListener("click", async () => {
    const r = await send({ type: "APPLY_NEXT", tabId: apply.tabId });
    status(r.clicked ? `Clicked “${r.text}” — scanning the next page…` : "No Next button found.");
    if (r.clicked) { await new Promise((x) => setTimeout(x, 2000)); await fillCurrentPage(); }
  });
  $("#btnApplyRescan").addEventListener("click", () => fillCurrentPage());
  $("#btnApplyShow").addEventListener("click", () => send({ type: "FOCUS_TAB", tabId: apply.tabId }));
  $("#btnApplyManual").addEventListener("click", () => markSubmitted("Submitted by you on the page."));
  $("#btnApplyCancel").addEventListener("click", () => { apply = null; $("#applyCard").innerHTML = ""; });
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

async function markSubmitted(note) {
  try {
    await cloudInvoke("ccp-log", { job_id: apply.job.id, job_status: "applied", application: { id: apply.app?.id, job_id: apply.job.id, job_url: apply.job.url, company: apply.job.company, title: apply.job.title, ats: apply.scan?.ats, resume_file_name: apply.tailored?.fileName, status: "submitted", notes: note } });
  } catch (e) {
    status(`Logged locally only: ${e.message}`, "error");
  }
  await upsertJobs([{ key: jobKeyFor(apply.job), board: apply.scan?.ats || "web", jobId: null, title: apply.job.title, company: apply.job.company, location: apply.job.location, url: apply.job.url, status: "applied", source: "ccp-apply", firstSeen: Date.now(), lastSeen: Date.now(), appliedAt: Date.now() }]);
  cloudJobs = cloudJobs.map((j) => (j.id === apply.job.id ? { ...j, status: "applied" } : j));
  status(`Application recorded: ${apply.job.title} @ ${apply.job.company}. ${note}`, "ok");
  apply = null;
  $("#applyCard").innerHTML = "";
  await reload();
}

const jobKeyFor = (j) => `ccp:${(j.url || j.title + "@" + j.company).toLowerCase()}`;

// ----------------------------------------------------------------------------- market demand (CCP data)

async function showMarket(refresh = false) {
  if (!needCloud()) return;
  const body = $("#marketBody");
  const field = $("#marketField").value;
  const years = $("#marketYears").value;
  body.textContent = refresh ? "Researching the market (this takes a minute)…" : "Loading…";
  try {
    if (refresh) {
      const r = await cloudInvoke("ccp-market", { field });
      body.textContent = JSON.stringify(r.report);
    }
    const r = await cloudInvoke("ccp-market", null, { method: "GET", query: `?field=${encodeURIComponent(field)}${years ? "&years=" + encodeURIComponent(years) : ""}` });
    const rows = r.rows || [];
    if (!rows.length) { body.innerHTML = `No market data for this field yet. Press Refresh to research it (needs AI access).`; return; }
    const resume = resumes.find((x) => x.id === $("#resumeSelect").value) || resumes[0];
    let have = new Set();
    if (resume) { const doc = await openDocx(b64ToBytes(resume.dataB64)); have = new Set(findSkills(blocksText(doc.blocks)).map((s) => s.name.toLowerCase())); }
    const bands = {};
    for (const row of rows) (bands[row.years_band] ||= []).push(row);
    body.innerHTML = Object.entries(bands).map(([band, list]) => `<h4>${esc(band)} years</h4><div>${list.slice(0, 25).map((row) => `<span class="badge ${[...have].some((h) => row.software.toLowerCase().includes(h) || h.includes(row.software.toLowerCase())) ? "applied" : ""}" title="${row.demand} of ${row.sources} postings">${esc(row.software)} ${row.demand}</span> `).join("")}</div>`).join("") + `<div class="muted" style="margin-top:6px">Green = already on your resume. Updated ${new Date(rows[0].updated_at).toLocaleDateString()}.</div>`;
  } catch (e) {
    body.textContent = e.message;
  }
}
$("#btnMarket").addEventListener("click", () => showMarket(false));
$("#btnMarketRefresh").addEventListener("click", () => showMarket(true));
$("#marketDemand").addEventListener("toggle", async (e) => {
  if (!e.target.open) return;
  const p = await getProfile();
  if (p.field && [...$("#marketField").options].some((o) => o.value === p.field)) $("#marketField").value = p.field;
  if (p.years_experience) $("#marketYears").value = p.years_experience;
  showMarket(false);
});

// ----------------------------------------------------------------------------- boot

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.jobs || changes.mail || changes.settings || changes.resumes || changes.scanState || changes.cloud)) reload();
});
await reload();
loadCloudJobs();
