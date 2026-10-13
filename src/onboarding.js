if (!globalThis.chrome?.runtime?.id) await import("../dev/chrome-shim.js");

import { getSettings, saveSettings, getProfile, saveProfile, getResumes, saveResumes, bytesToB64 } from "./lib/storage.js";
import { cloudSignIn, cloudSignUp, cloudStatus, syncProfile } from "./lib/cloud.js";
import { openDocx } from "./lib/docx.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SIMPLE = ["first_name", "last_name", "phone", "linkedin_url", "address_line", "city", "state", "zip", "country", "field", "years_experience", "desired_salary", "available_from", "work_authorization", "needs_sponsorship_future", "gender", "veteran_status", "race_ethnicity", "disability_status", "blocked_terms", "rules"];
const BOOLS = ["willing_to_relocate", "has_drivers_license", "needs_sponsorship_now"];

let step = 0;
let settings = {};
let profile = {};
let resumes = [];

function showStep(n) {
  step = n;
  document.querySelectorAll(".step").forEach((s) => s.classList.toggle("active", +s.dataset.step === n));
  document.querySelectorAll(".steps span").forEach((s) => { s.classList.toggle("active", +s.dataset.step === n); s.classList.toggle("done", +s.dataset.step < n); });
  window.scrollTo(0, 0);
}

function msg(sel, text, cls = "") {
  const el = $(sel);
  el.textContent = text;
  el.className = `msg ${cls}`;
}

// ---- step 0: account
async function renderAccount() {
  const s = await cloudStatus();
  $("#acStatus").textContent = s.signedIn ? `Signed in as ${s.email}${s.accessOk ? " · AI access active" : " · AI access not unlocked yet (enter the access code)"}` : "Not signed in yet.";
  if (s.email && !$("#acEmail").value) $("#acEmail").value = s.email;
}

async function account(kind) {
  const email = $("#acEmail").value.trim();
  const password = $("#acPassword").value;
  const name = $("#acName").value.trim();
  if (!email || !password) return msg("#acMsg", "Email and password are required.", "error");
  try {
    msg("#acMsg", kind === "up" ? "Creating your account…" : "Signing in…");
    const r = kind === "up" ? await cloudSignUp(email, password, name) : await cloudSignIn(email, password);
    if (r.requireEmailVerification && !r.accessToken) return msg("#acMsg", "Check your email and click the verification link, then sign in here.", "ok");
    if (name) await saveProfile({ full_name: name, first_name: name.split(" ")[0], last_name: name.split(" ").slice(1).join(" ") });
    await saveSettings({ candidateName: name || settings.candidateName, candidateEmail: email, aiMode: "cloud" });
    const code = $("#acCode").value.trim();
    if (code) {
      const p = await syncProfile(await getProfile(), code);
      msg("#acMsg", p.accessMessage || "Signed in.", p.accessOk ? "ok" : "error");
    } else msg("#acMsg", "Signed in.", "ok");
    await renderAccount();
    showStep(1);
  } catch (e) {
    msg("#acMsg", e.message, "error");
  }
}
$("#btnSignIn").addEventListener("click", () => account("in"));
$("#btnSignUp").addEventListener("click", () => account("up"));

// ---- step 1: resume
function renderResumes() {
  $("#resumeList").innerHTML = resumes.length ? resumes.map((r) => `✓ ${esc(r.label || r.fileName)} — ${r.stats?.skills ?? "?"} skill rows, ${r.stats?.bullets ?? "?"} bullets`).join("<br>") : "No resume file yet.";
}
$("#btnAddResume").addEventListener("click", async () => {
  const file = $("#resumeFile").files[0];
  if (!file) return ($("#resumeMsg").textContent = "Choose a .docx file first.");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openDocx(bytes);
    const ed = doc.blocks.filter((b) => !b.locked);
    const stats = { skills: ed.filter((b) => b.kind === "skill").length, bullets: ed.filter((b) => b.kind === "bullet").length, summary: ed.filter((b) => b.kind === "summary").length };
    if (!stats.skills && !stats.bullets) throw new Error("No editable skills rows or bullets found in this file.");
    const rec = { id: `r${Date.now()}`, label: $("#resumeLabel").value.trim() || "Master", fileName: file.name, size: bytes.length, addedAt: Date.now(), dataB64: bytesToB64(bytes), stats };
    resumes.push(rec);
    await saveResumes(resumes);
    if (!settings.defaultResumeId) await saveSettings({ defaultResumeId: rec.id });
    $("#resumeMsg").textContent = `Added: ${stats.skills} skill rows, ${stats.bullets} bullets${stats.summary ? ", summary" : ""}.`;
    renderResumes();
  } catch (e) {
    $("#resumeMsg").textContent = e.message;
  }
});

// ---- step 2: profile
function loadProfileForm() {
  for (const k of SIMPLE) if ($(`#${k}`)) $(`#${k}`).value = profile[k] ?? "";
  for (const k of BOOLS) $(`#${k}`).value = profile[k] == null ? "" : String(profile[k]);
  $("#target_titles").value = (profile.target_titles || []).join("\n");
  $("#target_locations").value = (profile.target_locations || []).join("\n");
  (profile.education || []).slice(0, 2).forEach((e, i) => { $(`#edu${i + 1}_school`).value = e.school || ""; $(`#edu${i + 1}_degree`).value = e.degree || ""; $(`#edu${i + 1}_year`).value = e.year || ""; $(`#edu${i + 1}_major`).value = e.major || ""; });
  (profile.employment || []).slice(0, 2).forEach((e, i) => { $(`#emp${i + 1}_company`).value = e.company || ""; $(`#emp${i + 1}_title`).value = e.title || ""; $(`#emp${i + 1}_from`).value = e.from || ""; $(`#emp${i + 1}_to`).value = e.to || ""; });
  if (!$("#first_name").value && settings.candidateName) { const [f, ...r] = settings.candidateName.split(" "); $("#first_name").value = f; $("#last_name").value = r.join(" "); }
  if (!$("#blocked_terms").value && settings.blockedTerms) $("#blocked_terms").value = settings.blockedTerms;
  if (!$("#rules").value && settings.rules) $("#rules").value = settings.rules;
  if (!$("#target_titles").value && settings.targetTitles) $("#target_titles").value = settings.targetTitles.split(/,\s*/).join("\n");
}

function collectProfile() {
  const p = {};
  for (const k of SIMPLE) if ($(`#${k}`)) p[k] = $(`#${k}`).value.trim();
  for (const k of BOOLS) p[k] = $(`#${k}`).value === "" ? null : $(`#${k}`).value === "true";
  p.years_experience = p.years_experience === "" ? null : +p.years_experience;
  p.full_name = `${p.first_name} ${p.last_name}`.trim();
  p.target_titles = $("#target_titles").value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  p.target_locations = $("#target_locations").value.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
  p.education = [1, 2].map((i) => ({ school: $(`#edu${i}_school`).value.trim(), degree: $(`#edu${i}_degree`).value.trim(), year: $(`#edu${i}_year`).value.trim(), major: $(`#edu${i}_major`).value.trim() })).filter((e) => e.school || e.degree);
  p.employment = [1, 2].map((i) => ({ company: $(`#emp${i}_company`).value.trim(), title: $(`#emp${i}_title`).value.trim(), from: $(`#emp${i}_from`).value.trim(), to: $(`#emp${i}_to`).value.trim() })).filter((e) => e.company || e.title);
  const text = $("#resumeText").value.trim();
  p.extra_answers = { ...(profile.extra_answers || {}), ...(text ? { resume_text: text.slice(0, 12000) } : {}) };
  return p;
}

async function saveAndSync() {
  const p = collectProfile();
  profile = await saveProfile(p);
  await saveSettings({ candidateName: p.full_name || settings.candidateName, targetTitles: p.target_titles.join(", "), blockedTerms: p.blocked_terms, rules: p.rules });
  const s = await cloudStatus();
  if (!s.signedIn) return "Saved on this computer. Sign in on step 1 to sync it to CCP Cloud.";
  try {
    const r = await syncProfile(profile, $("#acCode").value.trim());
    return `Saved and synced to CCP Cloud${r.accessOk ? " · AI access active" : " · AI access not unlocked yet (access code)"}.`;
  } catch (e) {
    return `Saved locally; cloud sync failed: ${e.message}`;
  }
}

// ---- navigation
document.querySelectorAll(".back").forEach((b) => b.addEventListener("click", () => showStep(Math.max(0, step - 1))));
document.querySelectorAll(".next").forEach((b) => b.addEventListener("click", async () => {
  if (step === 1) { showStep(2); return; }
  if (step === 2) {
    msg("#profileMsg", "Saving…");
    const text = await saveAndSync();
    msg("#profileMsg", "", "");
    $("#finishNote").textContent = text;
    showStep(3);
  }
}));
document.querySelectorAll(".steps span").forEach((s) => s.addEventListener("click", () => showStep(+s.dataset.step)));

$("#btnScanGmail").addEventListener("click", async () => {
  msg("#finishMsg", "Scanning Gmail (a Gmail tab will open)…");
  try {
    const r = await chrome.runtime.sendMessage({ type: "SCAN_GMAIL" });
    if (r?.error) throw new Error(r.error);
    msg("#finishMsg", `Gmail: ${r.rows} threads read, ${r.jobsAdded} past applications recorded.`, "ok");
  } catch (e) {
    msg("#finishMsg", e.message, "error");
  }
});
$("#btnOpenBoards").addEventListener("click", () => chrome.runtime.sendMessage({ type: "OPEN_BOARDS" }));
$("#btnDone").addEventListener("click", async () => { await saveSettings({ onboarded: true }); window.close(); });

settings = await getSettings();
profile = await getProfile();
resumes = await getResumes();
await renderAccount();
renderResumes();
loadProfileForm();
if ((await cloudStatus()).signedIn && new URLSearchParams(location.search).get("step")) showStep(+new URLSearchParams(location.search).get("step"));
