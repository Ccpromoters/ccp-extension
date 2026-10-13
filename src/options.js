if (!globalThis.chrome?.runtime?.id) await import("../dev/chrome-shim.js");

import { DEFAULT_SETTINGS, getSettings, saveSettings, getResumes, saveResumes, bytesToB64, b64ToBytes, getProfile } from "./lib/storage.js";
import { MODELS, DEFAULT_MODEL, testConnection } from "./lib/ai.js";
import { openDocx } from "./lib/docx.js";
import { cloudSignIn, cloudSignUp, cloudSignOut, cloudStatus, syncProfile } from "./lib/cloud.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const FIELDS = ["candidateName", "candidateEmail", "targetTitles", "aiMode", "apiProvider", "apiKey", "apiBaseUrl", "effort", "maxBulletChanges", "maxSkillTerms", "allowSummaryEdit", "blockedTerms", "rules", "customUrls", "openGmail", "openHistory", "openOnStartup", "gmailIndex", "scanDays", "redactContacts"];
const BOARD_KEYS = ["linkedin", "indeed", "ziprecruiter", "dice", "monster", "glassdoor"];

let settings = {};
let resumes = [];

function fillModels() {
  const sel = $("#model");
  sel.innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("") + `<option value="__custom">Custom model name…</option>`;
}

function syncProviderUi() {
  const p = $("#apiProvider").value;
  const anthropic = p === "anthropic";
  // Coming back to Anthropic with no custom model name: fall back to the default model.
  if (anthropic && $("#model").value === "__custom" && !$("#modelCustom").value.trim()) $("#model").value = DEFAULT_MODEL;
  $("#model").classList.toggle("hidden", !anthropic);
  $("#modelCustom").classList.toggle("hidden", anthropic && $("#model").value !== "__custom");
  $("#apiKey").placeholder = anthropic ? "sk-ant-…" : "API key (leave empty for a local server)";
  $("#apiBaseUrl").placeholder = anthropic ? "https://api.anthropic.com" : "https://api.openai.com/v1";
}

function load() {
  for (const f of FIELDS) {
    const el = $(`#${f}`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!settings[f];
    else el.value = settings[f] ?? "";
  }
  for (const b of BOARD_KEYS) $(`#board_${b}`).checked = !!settings.boards?.[b];
  const known = MODELS.some((m) => m.id === settings.model);
  if (settings.apiProvider === "anthropic" && known) {
    $("#model").value = settings.model || DEFAULT_MODEL;
    $("#modelCustom").value = "";
  } else {
    $("#model").value = "__custom";
    $("#modelCustom").value = settings.model || "";
  }
  syncProviderUi();
  renderResumes();
}

function collect() {
  const out = {};
  for (const f of FIELDS) {
    const el = $(`#${f}`);
    if (!el) continue;
    out[f] = el.type === "checkbox" ? el.checked : el.type === "number" ? +el.value : el.value.trim();
  }
  out.boards = Object.fromEntries(BOARD_KEYS.map((b) => [b, $(`#board_${b}`).checked]));
  out.model = $("#apiProvider").value === "anthropic" && $("#model").value !== "__custom" ? $("#model").value : $("#modelCustom").value.trim();
  if (!out.model && out.apiProvider === "anthropic") out.model = DEFAULT_MODEL;
  return out;
}

function renderResumes() {
  const list = $("#resumeList");
  if (!resumes.length) {
    list.innerHTML = `<div class="help">No master resume yet.</div>`;
    return;
  }
  list.innerHTML = resumes.map((r) => `<div class="resume" data-id="${esc(r.id)}">
      <input type="radio" name="defaultResume" ${r.id === settings.defaultResumeId ? "checked" : ""} title="Default" style="width:auto">
      <div class="grow"><b>${esc(r.label || r.fileName)}</b><div class="help">${esc(r.fileName)} · ${(r.size / 1024).toFixed(0)} KB · ${r.stats?.skills ?? "?"} skill rows, ${r.stats?.bullets ?? "?"} bullets${r.stats?.summary ? ", summary" : ""} · added ${new Date(r.addedAt).toLocaleDateString()}</div></div>
      <button class="small" data-act="download">Download</button>
      <button class="small" data-act="delete">Remove</button>
    </div>`).join("");
  list.querySelectorAll("input[type=radio]").forEach((rb) => rb.addEventListener("change", async (e) => {
    settings.defaultResumeId = e.target.closest(".resume").dataset.id;
    await saveSettings({ defaultResumeId: settings.defaultResumeId });
  }));
  list.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async (e) => {
    const id = e.target.closest(".resume").dataset.id;
    const r = resumes.find((x) => x.id === id);
    if (b.dataset.act === "download") {
      const url = URL.createObjectURL(new Blob([b64ToBytes(r.dataB64)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
      await chrome.downloads.download({ url, filename: `CCP Extension/${r.fileName}`, saveAs: true });
    } else if (confirm(`Remove "${r.label || r.fileName}" from this profile?`)) {
      resumes = resumes.filter((x) => x.id !== id);
      await saveResumes(resumes);
      if (settings.defaultResumeId === id) await saveSettings({ defaultResumeId: resumes[0]?.id || "" });
      settings = await getSettings();
      renderResumes();
    }
  }));
}

$("#btnAddResume").addEventListener("click", async () => {
  const file = $("#resumeFile").files[0];
  const msg = $("#resumeMsg");
  if (!file) return (msg.textContent = "Choose a .docx file first.");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await openDocx(bytes);
    const editable = doc.blocks.filter((b) => !b.locked);
    const stats = {
      skills: editable.filter((b) => b.kind === "skill").length,
      bullets: editable.filter((b) => b.kind === "bullet").length,
      summary: editable.filter((b) => b.kind === "summary").length,
    };
    if (!stats.skills && !stats.bullets) throw new Error("No editable skills rows or bullet points found. Use real Word bullets and a skills table or 'Label: items' lines.");
    const rec = { id: `r${Date.now()}`, label: $("#resumeLabel").value.trim() || file.name.replace(/\.docx$/i, ""), fileName: file.name, size: bytes.length, addedAt: Date.now(), dataB64: bytesToB64(bytes), stats };
    resumes.push(rec);
    await saveResumes(resumes);
    if (!settings.defaultResumeId) {
      settings.defaultResumeId = rec.id;
      await saveSettings({ defaultResumeId: rec.id });
    }
    $("#resumeFile").value = "";
    $("#resumeLabel").value = "";
    msg.textContent = `Added: ${stats.skills} skill rows, ${stats.bullets} bullets${stats.summary ? ", summary found" : ", no summary paragraph detected"}.`;
    renderResumes();
  } catch (e) {
    msg.textContent = `Could not add this file: ${e.message}`;
  }
});

$("#apiProvider").addEventListener("change", syncProviderUi);
$("#model").addEventListener("change", syncProviderUi);

$("#btnTest").addEventListener("click", async () => {
  const el = $("#testMsg");
  el.textContent = "Testing…";
  try {
    const s = collect();
    await ensureHostPermission(s);
    const r = await testConnection({ ...settings, ...s });
    el.textContent = `OK – ${r.model || s.model} replied.`;
  } catch (e) {
    el.textContent = e.message;
  }
});

async function ensureHostPermission(s) {
  if (!s.apiBaseUrl) return;
  let origin;
  try {
    origin = new URL(s.apiBaseUrl).origin + "/*";
  } catch {
    throw new Error("Base URL is not a valid URL.");
  }
  if (origin.startsWith("https://api.anthropic.com")) return;
  if (!chrome.permissions?.request) return;
  const ok = await chrome.permissions.request({ origins: [origin] });
  if (!ok) throw new Error(`Permission to call ${origin} was not granted.`);
}

$("#btnSave").addEventListener("click", async () => {
  const msg = $("#saveMsg");
  try {
    const s = collect();
    await ensureHostPermission(s);
    await saveSettings(s);
    settings = await getSettings();
    msg.textContent = "Saved.";
    setTimeout(() => (msg.textContent = ""), 2500);
  } catch (e) {
    msg.textContent = e.message;
  }
});

$("#btnExport").addEventListener("click", async () => {
  const data = { ccpExtension: 1, exportedAt: new Date().toISOString(), settings: await getSettings(), resumes: await getResumes() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  await chrome.downloads.download({ url, filename: `CCP Extension/ccp-profile-${(data.settings.candidateName || "candidate").replace(/\W+/g, "_")}.json`, saveAs: true });
  $("#backupMsg").textContent = "Exported.";
});

$("#btnImport").addEventListener("click", async () => {
  const file = $("#importFile").files[0];
  const msg = $("#backupMsg");
  if (!file) return (msg.textContent = "Choose an exported JSON file first.");
  try {
    const data = JSON.parse(await file.text());
    if (!data.ccpExtension) throw new Error("Not a CCP Extension export.");
    await saveSettings({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
    if (Array.isArray(data.resumes)) await saveResumes(data.resumes);
    settings = await getSettings();
    resumes = await getResumes();
    load();
    msg.textContent = "Imported.";
  } catch (e) {
    msg.textContent = `Import failed: ${e.message}`;
  }
});

// ---- CCP Cloud
async function renderCloud() {
  const s = await cloudStatus();
  $("#cloudStatus").innerHTML = s.signedIn
    ? `Signed in as <b>${esc(s.email)}</b> · AI access: ${s.accessOk ? "<b>active</b>" : "not unlocked (enter the access code and press Sync)"} · profile synced ${s.lastSync ? new Date(s.lastSync).toLocaleString() : "never"}`
    : "Not signed in. Sign in with your CCP account, or create one.";
  if (s.email && !$("#cloudEmail").value) $("#cloudEmail").value = s.email;
  const own = $("#aiMode").value === "own";
  $("#ownKeySection").classList.toggle("hidden", !own);
  $("#ownKeyHeading").classList.toggle("hidden", !own);
}
$("#aiMode").addEventListener("change", renderCloud);
$("#btnWizard").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("src/onboarding.html") }));
async function cloudAction(kind) {
  const m = $("#cloudMsg");
  try {
    m.textContent = "Working…";
    const email = $("#cloudEmail").value.trim();
    const password = $("#cloudPassword").value;
    if (kind === "in") await cloudSignIn(email, password);
    if (kind === "up") await cloudSignUp(email, password, settings.candidateName || "");
    if (kind === "out") await cloudSignOut();
    if (kind !== "out") {
      await saveSettings({ aiMode: "cloud", candidateEmail: email });
      $("#aiMode").value = "cloud";
      const r = await syncProfile(await getProfile(), $("#cloudCode").value.trim());
      m.textContent = r.accessMessage || "Signed in and profile synced.";
    } else m.textContent = "Signed out.";
    settings = await getSettings();
    await renderCloud();
  } catch (e) {
    m.textContent = e.message;
  }
}
$("#btnCloudIn").addEventListener("click", () => cloudAction("in"));
$("#btnCloudUp").addEventListener("click", () => cloudAction("up"));
$("#btnCloudOut").addEventListener("click", () => cloudAction("out"));
$("#btnCloudSync").addEventListener("click", () => cloudAction("sync"));

fillModels();
settings = await getSettings();
resumes = await getResumes();
load();
await renderCloud();
