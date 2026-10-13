// Typed helpers around chrome.storage.local. Everything the extension knows lives here, in the
// browser profile - no server.

export const DEFAULT_SETTINGS = {
  candidateName: "",
  candidateEmail: "",
  targetTitles: "",
  aiMode: "cloud", // cloud (CCP account, no key) | own (provider + key below)
  apiProvider: "anthropic", // anthropic | openai | mock
  apiKey: "",
  apiBaseUrl: "",
  model: "claude-opus-5-5",
  effort: "high",
  maxBulletChanges: 2,
  maxSkillTerms: 8,
  allowSummaryEdit: true,
  blockedTerms: "",
  rules: "",
  boards: { linkedin: true, indeed: true, ziprecruiter: true, dice: true, monster: true, glassdoor: false },
  customUrls: "",
  openGmail: true,
  openHistory: true,
  openOnStartup: false,
  gmailIndex: 0,
  scanDays: 30,
  redactContacts: true,
  defaultResumeId: "",
};

const STATUS_RANK = { viewed: 1, likely: 2, applied: 3 };

const area = () => chrome.storage.local;

export async function get(key, fallback) {
  const r = await area().get(key);
  return r[key] === undefined ? fallback : r[key];
}

export async function set(obj) {
  await area().set(obj);
}

export async function getSettings() {
  const s = await get("settings", {});
  return { ...DEFAULT_SETTINGS, ...s, boards: { ...DEFAULT_SETTINGS.boards, ...(s.boards || {}) } };
}

export async function saveSettings(patch) {
  const cur = await get("settings", {});
  const next = { ...cur, ...patch };
  await set({ settings: next });
  return next;
}

// ---- candidate memory (the onboarding answers; mirrored to CCP Cloud when signed in)

export const EMPTY_PROFILE = {
  full_name: "", first_name: "", last_name: "", phone: "", address_line: "", city: "", state: "", zip: "", country: "United States",
  linkedin_url: "", website_url: "", field: "", years_experience: "", target_titles: [], target_locations: [],
  work_authorization: "", needs_sponsorship_now: null, needs_sponsorship_future: "", veteran_status: "decline", gender: "decline",
  race_ethnicity: "decline", disability_status: "decline", desired_salary: "", available_from: "", willing_to_relocate: null,
  has_drivers_license: null, over_18: true, education: [], employment: [], extra_answers: {}, rules: "", blocked_terms: "",
};

export async function getProfile() {
  return { ...EMPTY_PROFILE, ...(await get("profile", {})) };
}

export async function saveProfile(patch) {
  const next = { ...(await getProfile()), ...patch };
  await set({ profile: next });
  return next;
}

// ---- resumes (master .docx files, stored as base64)

export function bytesToB64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}

export function b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function getResumes() {
  return get("resumes", []);
}

export async function saveResumes(list) {
  await set({ resumes: list });
}

// ---- jobs (applications tracker)

export async function getJobs() {
  return get("jobs", {});
}

/** Merge job records; a stronger status (applied > likely > viewed) always wins. */
export async function upsertJobs(records) {
  const jobs = await getJobs();
  let added = 0;
  let updated = 0;
  for (const r of records) {
    if (!r.key) continue;
    const cur = jobs[r.key];
    if (!cur) {
      jobs[r.key] = { sources: [], ...r, sources: [...new Set([...(r.sources || []), r.source].filter(Boolean))] };
      delete jobs[r.key].source;
      added++;
      continue;
    }
    const merged = { ...cur };
    if ((STATUS_RANK[r.status] || 0) > (STATUS_RANK[cur.status] || 0)) merged.status = r.status;
    for (const f of ["title", "company", "location", "url"]) if (!merged[f] && r[f]) merged[f] = r[f];
    if (r.lastSeen && (!merged.lastSeen || r.lastSeen > merged.lastSeen)) merged.lastSeen = r.lastSeen;
    if (r.firstSeen && (!merged.firstSeen || r.firstSeen < merged.firstSeen)) merged.firstSeen = r.firstSeen;
    if (r.appliedAt && (!merged.appliedAt || r.appliedAt < merged.appliedAt)) merged.appliedAt = r.appliedAt;
    merged.sources = [...new Set([...(cur.sources || []), ...(r.sources || []), r.source].filter(Boolean))];
    if (JSON.stringify(merged) !== JSON.stringify(cur)) updated++;
    jobs[r.key] = merged;
  }
  await set({ jobs });
  return { added, updated, total: Object.keys(jobs).length };
}

export async function updateJob(key, patch) {
  const jobs = await getJobs();
  if (!jobs[key]) return;
  jobs[key] = { ...jobs[key], ...patch };
  await set({ jobs });
}

export async function deleteJob(key) {
  const jobs = await getJobs();
  delete jobs[key];
  await set({ jobs });
}

// ---- mail (Gmail rows)

export async function getMail() {
  return get("mail", {});
}

export async function upsertMail(rows) {
  const mail = await getMail();
  let added = 0;
  for (const r of rows) {
    if (!r.threadId) continue;
    if (!mail[r.threadId]) added++;
    mail[r.threadId] = { ...(mail[r.threadId] || {}), ...r };
  }
  await set({ mail });
  return { added, total: Object.keys(mail).length };
}

// ---- JD library (job descriptions seen while browsing)

export async function getJdLibrary() {
  return get("jdLibrary", []);
}

export async function addJd(jd) {
  const lib = await getJdLibrary();
  const i = lib.findIndex((x) => x.url === jd.url);
  const rec = { ...jd, capturedAt: Date.now() };
  if (i >= 0) lib[i] = { ...lib[i], ...rec };
  else lib.unshift(rec);
  await set({ jdLibrary: lib.slice(0, 300) });
  return rec;
}

// ---- tailoring history

export async function addTailorRecord(rec) {
  const hist = await get("tailorHistory", []);
  hist.unshift({ id: `t${Date.now()}`, at: Date.now(), ...rec });
  await set({ tailorHistory: hist.slice(0, 200) });
}

export async function getTailorHistory() {
  return get("tailorHistory", []);
}

export async function setScanState(patch) {
  const s = await get("scanState", {});
  await set({ scanState: { ...s, ...patch } });
}

export async function getScanState() {
  return get("scanState", {});
}
