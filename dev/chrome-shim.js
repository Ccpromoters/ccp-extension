// Development shim: lets src/sidepanel.html, src/options.html and src/report.html run as plain web
// pages (e.g. `python -m http.server` from the repo root) so the UI can be previewed and screenshotted
// without loading the extension. Never shipped (scripts/package.mjs excludes dev/).
import { buildDocx } from "../test/helpers.js";

const KEY = "ccp-dev-storage";
const listeners = [];
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
};
const persist = (data) => localStorage.setItem(KEY, JSON.stringify(data));

async function seed() {
  const data = load();
  if (data.__seeded) return;
  const now = Date.now();
  const DAY = 86400e3;
  const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const docx = await buildDocx();
  data.settings = {
    candidateName: "Jane Sample", targetTitles: "Systems Administrator, Windows Administrator", apiProvider: "mock",
    blockedTerms: "Veeam, Intune, SolarWinds", rules: "Cloud stays at concept level only.", defaultResumeId: "r1",
    boards: { linkedin: true, indeed: true, ziprecruiter: true, dice: true, monster: true, glassdoor: false }, openGmail: true, openHistory: true,
  };
  data.resumes = [{ id: "r1", label: "Infrastructure", fileName: "Jane_Sample_Resume.docx", size: docx.length, addedAt: now - 3 * DAY, dataB64: b64(docx), stats: { skills: 4, bullets: 3, summary: 1 } }];
  const J = (key, board, title, company, status, daysAgo, src) => [key, { key, board, jobId: key.split(":")[1], title, company, location: "Houston, TX", url: "https://example.com/" + key, status, sources: [src], firstSeen: now - daysAgo * DAY, lastSeen: now - daysAgo * DAY, appliedAt: status === "applied" ? now - daysAgo * DAY : undefined }];
  data.jobs = Object.fromEntries([
    J("linkedin:1", "linkedin", "Senior Systems Administrator", "Intec Select", "applied", 1, "gmail"),
    J("indeed:2", "indeed", "Windows Server Administrator", "Shentel", "applied", 2, "history"),
    J("dice:3", "dice", "Infrastructure Engineer", "V-Soft Consulting", "likely", 2, "history"),
    J("linkedin:4", "linkedin", "IT Systems Engineer", "Harvard Partners", "applied", 4, "applied-list"),
    J("ziprecruiter:5", "ziprecruiter", "Network Administrator", "Service Wire", "viewed", 5, "page"),
  ]);
  const M = (id, kind, from, fromEmail, subject, snippet, daysAgo, tags = ["Windows / Infrastructure"]) => [id, { threadId: id, kind, from, fromEmail, recruiter: from, subject, snippet, dateTs: now - daysAgo * DAY, tags, url: "https://mail.google.com/" }];
  data.mail = Object.fromEntries([
    M("m1", "recruiter", "Amit S", "amit@techstaff.com", "Urgent requirement: Windows Server Administrator (W2, Hybrid)", "We have an immediate need for a Windows admin with Active Directory and VMware. Rate $55/hr on W2.", 0),
    M("m2", "applied", "LinkedIn", "jobs-noreply@linkedin.com", "Your application was sent to Intec Select", "Senior Systems Administrator - Houston, TX", 1, []),
    M("m3", "interview", "Priya R", "priya@staffingco.com", "Interview availability - Windows Admin role", "Can you share your availability for a phone screen this week?", 2),
    M("m4", "rtr", "Raj K", "raj@vendor.com", "RTR needed for Systems Engineer - Charlotte NC", "Please reply with your right to represent.", 3),
    M("m5", "rejection", "Talent Team", "careers@acme.com", "Update on your application", "Unfortunately we have decided to move forward with other candidates.", 4, []),
  ]);
  data.jdLibrary = [
    { url: "https://example.com/jd1", board: "linkedin", title: "Senior Systems Administrator", company: "Intec Select", skills: ["Windows Server", "Active Directory", "VMware", "Backup (Veeam)", "Intune", "PowerShell"], years: 7, capturedAt: now },
    { url: "https://example.com/jd2", board: "indeed", title: "Windows Server Administrator", company: "Shentel", skills: ["Windows Server", "Active Directory", "Intune", "Microsoft 365", "SCCM"], years: 5, capturedAt: now },
    { url: "https://example.com/jd3", board: "dice", title: "Systems Administrator", company: "Acme", skills: ["Windows Server", "Backup (Veeam)", "Monitoring (SolarWinds/PRTG/SCOM)", "VMware"], years: 6, capturedAt: now },
  ];
  data.scanState = { lastHistoryScan: now - 3600e3, lastGmailScan: now - 3600e3 };
  data.__seeded = true;
  persist(data);
}

const storageLocal = {
  async get(keys) {
    const data = load();
    if (keys == null) return data;
    const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out = {};
    for (const k of list) if (data[k] !== undefined) out[k] = data[k];
    return out;
  },
  async set(obj) {
    const data = load();
    const changes = {};
    for (const [k, v] of Object.entries(obj)) {
      changes[k] = { oldValue: data[k], newValue: v };
      data[k] = v;
    }
    persist(data);
    for (const fn of listeners) setTimeout(() => fn(changes, "local"), 0);
  },
  async remove(keys) {
    const data = load();
    for (const k of [].concat(keys)) delete data[k];
    persist(data);
  },
};

const SAMPLE_JD = `Senior Systems Administrator (Windows / VMware)\nSample Health Systems - Houston, TX (Hybrid)\n\nWe are looking for a Senior Systems Administrator with 7+ years of experience managing Windows Server 2016/2019/2022 environments. Responsibilities include Active Directory, DNS, DHCP, Group Policy, Sites and Services; VMware vSphere / vCenter / ESXi host maintenance; Veeam backups; PowerShell automation; WSUS and SCCM patching; Microsoft 365 / Exchange Online; Intune device management; Tier 3 escalation support; change advisory board participation; disaster recovery testing; on-call rotation. Bachelor's degree or equivalent. VCP certification a plus.`;

const fakeBackground = async (msg) => {
  switch (msg.type) {
    case "OPEN_BOARDS": return { opened: 7, skipped: 0, total: 7 };
    case "SCAN_HISTORY": return { added: 0, updated: 0, total: 5, scanned: 1200, matched: 5, days: 30 };
    case "SCAN_GMAIL": return { rows: 5, newMail: 0, byKind: { recruiter: 1, applied: 1, interview: 1, rtr: 1, rejection: 1 }, jobsAdded: 0, days: 30 };
    case "SCAN_APPLIED": return { added: 0, updated: 0, total: 5, perBoard: { linkedin: 1, indeed: 1 } };
    case "GET_ACTIVE_JD": return { url: "https://www.linkedin.com/jobs/view/4012345678/", board: "linkedin", title: "Senior Systems Administrator (Windows / VMware)", company: "Sample Health Systems", location: "Houston, TX", text: SAMPLE_JD };
    case "OPEN_OPTIONS": location.href = "options.html"; return { ok: true };
    case "OPEN_URL": window.open(msg.url, "_blank"); return { ok: true };
    default: return { error: `dev shim: unknown message ${msg.type}` };
  }
};

globalThis.chrome = {
  runtime: {
    id: "dev",
    getURL: (p) => new URL("../" + p, import.meta.url).href,
    sendMessage: (msg) => fakeBackground(msg),
    onMessage: { addListener() {} },
    openOptionsPage: () => (location.href = new URL("../src/options.html", import.meta.url).href),
  },
  storage: { local: storageLocal, onChanged: { addListener: (fn) => listeners.push(fn) } },
  tabs: { create: async ({ url }) => (window.open(url, "_blank"), { id: 1 }) },
  downloads: {
    async download({ url, filename }) {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.split("/").pop();
      a.click();
      return 1;
    },
  },
  permissions: { request: async () => true },
};
await seed();
