// Side panel UI. Runs inside the extension; when opened as a plain web page (dev harness) it
// loads a chrome.* shim so the interface can be previewed without installing the extension.
if (!globalThis.chrome?.runtime?.id) await import("../dev/chrome-shim.js");

import { BOARDS } from "./lib/boards.js";
import { KIND_LABELS } from "./lib/classify.js";
import { getSettings, getJobs, getMail, getResumes, getJdLibrary, getScanState, upsertJobs, updateJob, deleteJob, b64ToBytes, addTailorRecord } from "./lib/storage.js";
import { tailorResume, parseList } from "./lib/tailor.js";
import { openDocx, blocksText } from "./lib/docx.js";
import { findSkills } from "./lib/skills-dict.js";

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

async function reload() {
  [settings, jobs, mail, resumes] = await Promise.all([getSettings(), getJobs(), getMail(), getResumes()]);
  $("#who").textContent = settings.candidateName ? `${settings.candidateName}${settings.targetTitles ? " · " + settings.targetTitles.split(/[,\n]/)[0].trim() : ""}` : "No candidate set yet — open Settings";
  renderHome();
  renderJobs();
  renderInbox();
  renderResumeTab();
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

// ----------------------------------------------------------------------------- boot

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.jobs || changes.mail || changes.settings || changes.resumes || changes.scanState)) reload();
});
await reload();
