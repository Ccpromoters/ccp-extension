// Service worker: opens job boards, scans history / Gmail / board "applied" pages, captures job
// descriptions from pages, and answers the side panel. All data stays in chrome.storage.local.

import { BOARDS, DEFAULT_OPEN_ORDER, GMAIL_URL, HISTORY_URL, classifyJobUrl, parseHistoryTitle, parseAppliedDate, jobKey, boardForUrl } from "./lib/boards.js";
import { classifyMail } from "./lib/classify.js";
import { getSettings, upsertJobs, upsertMail, addJd, setScanState } from "./lib/storage.js";
import { findSkills, yearsRequired } from "./lib/skills-dict.js";

const JOB_SITE_PATTERNS = [
  "https://*.linkedin.com/jobs/*", "https://*.indeed.com/*", "https://*.ziprecruiter.com/*",
  "https://*.dice.com/*", "https://*.monster.com/*", "https://*.glassdoor.com/*",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch {}
  try {
    await chrome.contextMenus.removeAll();
    chrome.contextMenus.create({ id: "ccp-tailor", title: "CCP: Tailor resume for this job", contexts: ["page"], documentUrlPatterns: JOB_SITE_PATTERNS });
    chrome.contextMenus.create({ id: "ccp-open-boards", title: "Open job boards", contexts: ["action"] });
    chrome.contextMenus.create({ id: "ccp-options", title: "Settings", contexts: ["action"] });
  } catch {}
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await setup();
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("src/onboarding.html") });
});

chrome.runtime.onStartup.addListener(async () => {
  await setup();
  const s = await getSettings();
  if (s.openOnStartup) await openBoards(s);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "ccp-tailor" && tab?.id != null) {
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch {}
  } else if (info.menuItemId === "ccp-open-boards") {
    await openBoards(await getSettings());
  } else if (info.menuItemId === "ccp-options") {
    chrome.runtime.openOptionsPage();
  }
});

// ----------------------------------------------------------------------------- helpers

function progress(label, step, total) {
  chrome.runtime.sendMessage({ type: "SCAN_PROGRESS", label, step, total }).catch(() => {});
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Send a message to a tab's content script, injecting the script first if it is not there yet. */
async function askTab(tabId, msg, file) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    await sleep(400);
    return chrome.tabs.sendMessage(tabId, msg);
  }
}

function waitForLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then((t) => t.status === "complete" && finish()).catch(finish);
    setTimeout(finish, timeoutMs);
  });
}

function cleanJobUrl(url) {
  try {
    const u = new URL(url);
    if (/linkedin\.com$/i.test(u.hostname)) {
      const m = u.pathname.match(/\/jobs\/view\/(\d+)/);
      if (m) return `https://www.linkedin.com/jobs/view/${m[1]}/`;
      const id = u.searchParams.get("currentJobId");
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
    }
    if (/indeed\.com$/i.test(u.hostname)) {
      const jk = u.searchParams.get("jk") || u.searchParams.get("vjk");
      if (jk) return `https://www.indeed.com/viewjob?jk=${jk}`;
    }
    u.hash = "";
    for (const p of ["refId", "trackingId", "trk", "utm_source", "utm_medium", "utm_campaign", "from", "tk"]) u.searchParams.delete(p);
    return u.toString();
  } catch {
    return url;
  }
}

// ----------------------------------------------------------------------------- open boards

export async function openBoards(settings) {
  const urls = [];
  for (const key of [...DEFAULT_OPEN_ORDER, "glassdoor"]) if (settings.boards?.[key]) urls.push(BOARDS[key].home);
  for (const line of (settings.customUrls || "").split(/\n+/)) {
    const u = line.trim();
    if (/^https?:\/\//i.test(u)) urls.push(u);
  }
  if (settings.openGmail) urls.push(GMAIL_URL(settings.gmailIndex || 0));
  if (settings.openHistory) urls.push(HISTORY_URL);

  const existing = await chrome.tabs.query({});
  const openHosts = new Set(existing.map((t) => hostOf(t.url || "")));
  let opened = 0;
  let firstTab = null;
  for (const url of urls) {
    const host = hostOf(url);
    const already = host ? openHosts.has(host) : existing.some((t) => (t.url || "").startsWith(url));
    if (already) continue;
    const tab = await chrome.tabs.create({ url, active: false });
    if (host) openHosts.add(host);
    firstTab ??= tab;
    opened++;
  }
  if (firstTab) await chrome.tabs.update(firstTab.id, { active: true }).catch(() => {});
  return { opened, skipped: urls.length - opened, total: urls.length };
}

// ----------------------------------------------------------------------------- history scan

async function scanHistory(settings) {
  const days = Math.max(1, +settings.scanDays || 30);
  const since = Date.now() - days * 86400e3;
  progress("Reading browser history…", 0, 1);
  const items = await chrome.history.search({ text: "", startTime: since, maxResults: 100000 });
  const recs = [];
  for (const h of items) {
    const c = classifyJobUrl(h.url || "");
    if (!c) continue;
    const meta = parseHistoryTitle(c.board, h.title);
    if (!c.jobId && !meta.title) continue;
    const key = jobKey({ board: c.board, jobId: c.jobId, title: meta.title, company: meta.company });
    recs.push({
      key, board: c.board, jobId: c.jobId, title: meta.title, company: meta.company, location: meta.location,
      url: cleanJobUrl(h.url), status: c.status, source: "history",
      firstSeen: h.lastVisitTime, lastSeen: h.lastVisitTime,
      appliedAt: c.status === "applied" ? h.lastVisitTime : undefined, visits: h.visitCount || 1,
    });
  }
  const r = await upsertJobs(recs);
  await setScanState({ lastHistoryScan: Date.now() });
  return { ...r, scanned: items.length, matched: recs.length, days };
}

// ----------------------------------------------------------------------------- Gmail scan

const gmailQueries = (days) => [
  { kind: "applied", q: `newer_than:${days}d (subject:(application OR applied OR applying) OR "your application" OR "thank you for applying" OR "application received" OR "application submitted" OR "Indeed Application")` },
  { kind: "recruiter", q: `newer_than:${days}d (opportunity OR requirement OR "job description" OR C2C OR W2 OR "right to represent" OR RTR OR "contract role" OR "open position" OR "hiring for" OR "looking for" OR "updated resume") -from:jobalerts-noreply@linkedin.com -from:alert@indeed.com -from:jobs-listings@linkedin.com -subject:"new jobs"` },
  { kind: "interview", q: `newer_than:${days}d (interview OR "phone screen" OR "screening call" OR "schedule a call" OR "your availability")` },
  { kind: "rejection", q: `newer_than:${days}d ("not moving forward" OR "other candidates" OR unfortunately OR "not selected" OR "no longer under consideration" OR "position has been filled")` },
];

async function getGmailTab(settings) {
  const tabs = await chrome.tabs.query({ url: "https://mail.google.com/*" });
  if (tabs.length) return { tab: tabs[0], created: false, originalUrl: tabs[0].url };
  const tab = await chrome.tabs.create({ url: GMAIL_URL(settings.gmailIndex || 0), active: false });
  await waitForLoad(tab.id, 30000);
  await sleep(2500);
  return { tab, created: true, originalUrl: GMAIL_URL(settings.gmailIndex || 0) };
}

async function collectGmailSearch(tabId, index, query) {
  const hash = `#search/${encodeURIComponent(query)}`;
  await chrome.tabs.update(tabId, { url: `https://mail.google.com/mail/u/${index}/${hash}` });
  let last = -1;
  let stable = 0;
  const deadline = Date.now() + 15000;
  let result = { rows: [] };
  while (Date.now() < deadline) {
    await sleep(800);
    let r;
    try {
      r = await askTab(tabId, { type: "GMAIL_COLLECT", expectHash: hash }, "src/content/gmail.js");
    } catch {
      continue;
    }
    if (!r || !r.ready) continue;
    if (r.loading && !r.rows.length) continue;
    result = r;
    if (r.empty) break;
    // Gmail renders the list progressively: accept once the row count stops changing.
    if (r.rows.length === last && r.rows.length > 0) {
      if (++stable >= 1) break;
    } else stable = 0;
    last = r.rows.length;
  }
  return result.rows || [];
}

async function scanGmail(settings) {
  const days = Math.max(1, +settings.scanDays || 30);
  const index = settings.gmailIndex || 0;
  const { tab, originalUrl } = await getGmailTab(settings);
  const queries = gmailQueries(days);
  const all = new Map();
  let i = 0;
  try {
    for (const { kind, q } of queries) {
      progress(`Gmail: searching ${kind} mail…`, ++i, queries.length);
      const rows = await collectGmailSearch(tab.id, index, q);
      for (const r of rows) if (r.threadId && !all.has(r.threadId)) all.set(r.threadId, r);
    }
  } finally {
    try {
      await chrome.tabs.update(tab.id, { url: originalUrl && /#/.test(originalUrl) ? originalUrl : GMAIL_URL(index) });
    } catch {}
  }

  const mailRows = [];
  const jobRecs = [];
  const byKind = {};
  for (const r of all.values()) {
    const c = classifyMail(r);
    byKind[c.kind] = (byKind[c.kind] || 0) + 1;
    mailRows.push({
      threadId: r.threadId, from: r.from, fromEmail: r.fromEmail, subject: r.subject, snippet: r.snippet,
      date: r.dateText, dateTs: r.dateTs || Date.now(), unread: !!r.unread, url: r.url,
      kind: c.kind, board: c.board, title: c.title, company: c.company, recruiter: c.recruiter, tags: c.tags,
    });
    if (c.kind === "applied" && (c.title || c.company)) {
      jobRecs.push({
        key: jobKey({ board: c.board || "email", title: c.title, company: c.company }),
        board: c.board || "email", jobId: null, title: c.title, company: c.company, url: r.url,
        status: "applied", source: "gmail", firstSeen: r.dateTs || Date.now(), lastSeen: r.dateTs || Date.now(), appliedAt: r.dateTs || Date.now(),
      });
    }
  }
  const m = await upsertMail(mailRows);
  const j = await upsertJobs(jobRecs);
  await setScanState({ lastGmailScan: Date.now() });
  return { rows: mailRows.length, newMail: m.added, byKind, jobsAdded: j.added, days };
}

// ----------------------------------------------------------------------------- "Applied" lists on the boards

async function scanAppliedLists() {
  const boards = Object.entries(BOARDS).filter(([, b]) => b.appliedList);
  const recs = [];
  const perBoard = {};
  let i = 0;
  for (const [key, b] of boards) {
    progress(`${b.name}: reading your applied jobs…`, ++i, boards.length);
    let tab;
    try {
      tab = await chrome.tabs.create({ url: b.appliedList, active: false });
      await waitForLoad(tab.id, 25000);
      let items = [];
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        await sleep(1500);
        try {
          const r = await askTab(tab.id, { type: "APPLIED_COLLECT" }, "src/content/applied.js");
          if (r?.items?.length) {
            items = r.items;
            if (r.items.length === items.length) break;
          }
        } catch {}
      }
      perBoard[key] = items.length;
      for (const it of items) {
        const ts = parseAppliedDate(it.appliedText) || Date.now();
        recs.push({
          key: jobKey({ board: key, jobId: it.jobId, title: it.title, company: it.company }),
          board: key, jobId: it.jobId, title: it.title, company: it.company, location: it.location, url: it.url,
          status: "applied", source: "applied-list", firstSeen: ts, lastSeen: ts, appliedAt: ts,
          notes: it.status || "",
        });
      }
    } catch (e) {
      perBoard[key] = `error: ${e.message}`;
    } finally {
      if (tab) chrome.tabs.remove(tab.id).catch(() => {});
    }
  }
  const r = await upsertJobs(recs);
  await setScanState({ lastAppliedScan: Date.now() });
  return { ...r, perBoard };
}

// ----------------------------------------------------------------------------- JD capture

async function getActiveJd() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("Open a job posting in the current tab first.");
  const jd = await askTab(tab.id, { type: "EXTRACT_JD" }, "src/content/jobpage.js");
  if (!jd || !jd.text || jd.text.length < 80) throw new Error("Could not read a job description on this page. Paste the JD text instead.");
  jd.url = cleanJobUrl(jd.url || tab.url);
  jd.board = jd.board || boardForUrl(jd.url) || "web";
  return jd;
}

async function captureJd(jd) {
  const url = cleanJobUrl(jd.url);
  const text = (jd.text || "").slice(0, 12000);
  const board = jd.board || boardForUrl(url) || "web";
  await addJd({ url, board, title: jd.title || "", company: jd.company || "", location: jd.location || "", text, skills: findSkills(text).map((s) => s.name), years: yearsRequired(text) });
  const c = classifyJobUrl(url);
  const key = jobKey({ board, jobId: c?.jobId, title: jd.title, company: jd.company });
  if (jd.title) {
    await upsertJobs([{ key, board, jobId: c?.jobId || null, title: jd.title, company: jd.company || "", location: jd.location || "", url, status: "viewed", source: "page", firstSeen: Date.now(), lastSeen: Date.now() }]);
  }
  return { ok: true };
}

// ----------------------------------------------------------------------------- messages

async function handle(msg, sender) {
  const settings = await getSettings();
  switch (msg?.type) {
    case "OPEN_BOARDS": return openBoards(settings);
    case "SCAN_HISTORY": return scanHistory(settings);
    case "SCAN_GMAIL": return scanGmail(settings);
    case "SCAN_APPLIED": return scanAppliedLists();
    case "SCAN_ALL": {
      const history = await scanHistory(settings);
      const gmail = await scanGmail(settings);
      return { history, gmail };
    }
    case "GET_ACTIVE_JD": return getActiveJd();
    case "JD_CAPTURED": return captureJd({ ...msg.jd, url: msg.jd?.url || sender?.tab?.url });
    // ---- application assist (the side panel drives the ATS page through src/content/apply.js)
    case "APPLY_OPEN": {
      const tab = await chrome.tabs.create({ url: msg.url, active: msg.active !== false });
      await waitForLoad(tab.id, 30000);
      await sleep(1500);
      return { tabId: tab.id, url: (await chrome.tabs.get(tab.id)).url };
    }
    case "APPLY_SCAN": return askTab(msg.tabId, { type: "APPLY_SCAN" }, "src/content/apply.js");
    case "APPLY_FILL": return askTab(msg.tabId, { type: "APPLY_FILL", answers: msg.answers, resume: msg.resume }, "src/content/apply.js");
    case "APPLY_SUBMIT": return askTab(msg.tabId, { type: "APPLY_SUBMIT" }, "src/content/apply.js");
    case "APPLY_NEXT": return askTab(msg.tabId, { type: "APPLY_NEXT" }, "src/content/apply.js");
    case "PAGE_TEXT": return askTab(msg.tabId, { type: "PAGE_TEXT" }, "src/content/apply.js");
    case "ACTIVE_TAB": {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return { tabId: tab?.id, url: tab?.url || "", title: tab?.title || "" };
    }
    case "FOCUS_TAB": await chrome.tabs.update(msg.tabId, { active: true }).catch(() => {}); return { ok: true };
    case "OPEN_OPTIONS": chrome.runtime.openOptionsPage(); return { ok: true };
    case "OPEN_URL": await chrome.tabs.create({ url: msg.url, active: msg.active !== false }); return { ok: true };
    default: throw new Error(`Unknown message ${msg?.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender).then(
    (r) => sendResponse(r ?? { ok: true }),
    (e) => sendResponse({ error: e?.message || String(e) }),
  );
  return true;
});
