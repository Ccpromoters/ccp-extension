// Job board definitions: where to open them, how to recognise job pages and apply flows in
// browser history, and how to read a job title/company out of a history entry's page title.

export const BOARDS = {
  linkedin: {
    name: "LinkedIn",
    home: "https://www.linkedin.com/jobs/",
    host: /(^|\.)linkedin\.com$/i,
    jobView: [/\/jobs\/view\/(\d+)/],
    applyFlow: [/\/jobs\/view\/\d+\/post-apply/i, /\/jobs\/application\//i],
    applied: [/\/post-apply\//i],
    appliedList: "https://www.linkedin.com/jobs-tracker/?stage=applied",
    mailSenders: [/jobs-noreply@linkedin\.com/i, /@linkedin\.com$/i],
  },
  indeed: {
    name: "Indeed",
    home: "https://www.indeed.com/",
    host: /(^|\.)indeed\.com$/i,
    jobView: [/[?&]jk=([0-9a-f]{8,})/i, /\/viewjob/i, /\/job\/[^/?]+-([0-9a-f]{8,})/i],
    applyFlow: [/smartapply\.indeed\.com/i, /\/applystart/i, /indeedapply/i],
    applied: [/post-apply|thank-?you|\/form\/confirmation|application-submitted/i],
    appliedList: "https://myjobs.indeed.com/applied",
    mailSenders: [/indeedapply@indeed\.com/i, /@indeed\.com$/i],
  },
  ziprecruiter: {
    name: "ZipRecruiter",
    home: "https://www.ziprecruiter.com/jobs-search",
    host: /(^|\.)ziprecruiter\.com$/i,
    jobView: [/[?&]jid=([A-Za-z0-9_-]{8,})/i, /\/c\/[^/]+\/Job\//i, /\/jobs\/[^/?]+-([0-9a-f]{8,})/i],
    applyFlow: [/\/apply\b/i, /\/candidate\/apply/i],
    applied: [/\/applied|application-complete|\/success/i],
    appliedList: null,
    mailSenders: [/@ziprecruiter\.com$/i],
  },
  dice: {
    name: "Dice",
    home: "https://www.dice.com/jobs",
    host: /(^|\.)dice\.com$/i,
    jobView: [/\/job-detail\/([0-9a-f-]{20,})/i, /\/jobs\/detail\/[^/]+\/([0-9a-f-]{20,})/i],
    applyFlow: [/\/apply\b/i],
    applied: [/application-submitted|\/success/i],
    appliedList: null,
    mailSenders: [/@dice\.com$/i],
  },
  monster: {
    name: "Monster",
    home: "https://www.monster.com/jobs/",
    host: /(^|\.)monster\.com$/i,
    jobView: [/\/job-openings\/([^/?#]+)/i, /\/jobs\/[^/]+\/([^/?#]+)/i],
    applyFlow: [/\/apply\b/i],
    applied: [/application-submitted|\/success|thank-?you/i],
    appliedList: null,
    mailSenders: [/@monster\.com$/i],
  },
  glassdoor: {
    name: "Glassdoor",
    home: "https://www.glassdoor.com/Job/index.htm",
    host: /(^|\.)glassdoor\.com$/i,
    jobView: [/jobListingId=(\d+)/i, /\/job-listing\//i, /[?&]jl=(\d+)/i],
    applyFlow: [/\/apply\b/i],
    applied: [],
    appliedList: null,
    mailSenders: [/@glassdoor\.com$/i],
  },
};

export const DEFAULT_OPEN_ORDER = ["linkedin", "indeed", "ziprecruiter", "dice", "monster"];
export const GMAIL_URL = (index = 0) => `https://mail.google.com/mail/u/${index}/#inbox`;
export const HISTORY_URL = "chrome://history/";

/** Board key for a URL, or null. */
export function boardForUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  for (const [key, b] of Object.entries(BOARDS)) if (b.host.test(host)) return key;
  return null;
}

/** Board key for an email sender address, or null. */
export function boardForSender(email) {
  if (!email) return null;
  for (const [key, b] of Object.entries(BOARDS)) if (b.mailSenders.some((rx) => rx.test(email))) return key;
  return null;
}

function firstCapture(url, patterns) {
  for (const rx of patterns) {
    const m = url.match(rx);
    if (m) return m[1] || null;
  }
  return null;
}

/**
 * Classify a history URL. Returns null for non-job pages, else
 * { board, jobId, status: 'viewed'|'likely'|'applied' }.
 */
export function classifyJobUrl(url) {
  const board = boardForUrl(url);
  if (!board) return null;
  const b = BOARDS[board];
  const isView = b.jobView.some((rx) => rx.test(url));
  const isFlow = b.applyFlow.some((rx) => rx.test(url));
  if (!isView && !isFlow) return null;
  const jobId = firstCapture(url, b.jobView) || firstCapture(url, b.applyFlow);
  let status = "viewed";
  if (isFlow) status = b.applied.some((rx) => rx.test(url)) ? "applied" : "likely";
  return { board, jobId, status };
}

/** Pull { title, company, location } out of a page title saved in browser history. */
export function parseHistoryTitle(board, pageTitle) {
  const t = (pageTitle || "").replace(/^\(\d+\)\s*/, "").trim();
  const out = { title: "", company: "", location: "" };
  if (!t) return out;
  let m;
  switch (board) {
    case "linkedin":
      if ((m = t.match(/^(.+?) hiring (.+?) in (.+?)\s*\|\s*LinkedIn$/i))) {
        return { company: m[1].trim(), title: m[2].trim(), location: m[3].trim() };
      }
      if ((m = t.match(/^(.+?)\s*\|\s*(.+?)\s*\|\s*LinkedIn$/i))) return { title: m[1].trim(), company: m[2].trim(), location: "" };
      break;
    case "indeed":
      if ((m = t.match(/^(.+?) - (.+?) - Indeed\.com$/i))) return { title: m[1].trim(), company: "", location: m[2].trim() };
      if ((m = t.match(/^(.+?) - Indeed\.com$/i))) return { title: m[1].trim(), company: "", location: "" };
      break;
    case "ziprecruiter":
      if ((m = t.match(/^(.+?) Job in (.+?) at (.+?)(?:\s*\|\s*ZipRecruiter)?$/i))) {
        return { title: m[1].trim(), location: m[2].trim(), company: m[3].trim() };
      }
      break;
    case "dice":
      if ((m = t.match(/^(.+?) Job in (.+?) at (.+?)(?:\s*\|\s*Dice(?:\.com)?)?$/i))) {
        return { title: m[1].trim(), location: m[2].trim(), company: m[3].trim() };
      }
      if ((m = t.match(/^(.+?) - (.+?) - (.+?)\s*\|\s*Dice(?:\.com)?$/i))) return { title: m[1].trim(), company: m[2].trim(), location: m[3].trim() };
      break;
    default:
      break;
  }
  // Generic: strip a trailing site name and take what is left as the title.
  const generic = t.replace(/\s*[|\-–]\s*(LinkedIn|Indeed(?:\.com)?|ZipRecruiter|Dice(?:\.com)?|Monster(?:\.com)?|Glassdoor)\s*$/i, "").trim();
  if ((m = generic.match(/^(.+?)\s+at\s+(.+)$/i)) && m[1].length < 90) return { title: m[1].trim(), company: m[2].trim(), location: "" };
  return { title: generic, company: "", location: "" };
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

/**
 * Timestamp for the "applied" text a board shows: "Applied 2w ago", "Applied on Indeed on 23 Jun",
 * "Applied Oct 3, 2026", "Applied 3 days ago". Returns null when nothing is recognised.
 */
export function parseAppliedDate(text, now = Date.now()) {
  const t = (text || "").trim();
  if (!t) return null;
  let m;
  if ((m = t.match(/(\d+)\s*(h|hr|hour|d|day|w|wk|week|mo|month|m|y|year)s?\b\s*ago/i))) {
    const n = +m[1];
    const u = m[2].toLowerCase();
    const ms = /^h/.test(u) ? 3600e3 : /^d/.test(u) ? 86400e3 : /^w/.test(u) ? 7 * 86400e3 : /^mo|^m$/.test(u) ? 30 * 86400e3 : 365 * 86400e3;
    return now - n * ms;
  }
  if ((m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?\b/)) && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) {
    return dateFromParts(+m[1], MONTHS[m[2].slice(0, 3).toLowerCase()], m[3] ? +m[3] : null, now);
  }
  if ((m = t.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/)) && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) {
    return dateFromParts(+m[2], MONTHS[m[1].slice(0, 3).toLowerCase()], m[3] ? +m[3] : null, now);
  }
  if (/\b(today|just now)\b/i.test(t)) return now;
  if (/\byesterday\b/i.test(t)) return now - 86400e3;
  return null;
}

function dateFromParts(day, month, year, now) {
  const d = new Date(now);
  const y = year ?? d.getFullYear();
  let ts = new Date(y, month, day, 12).getTime();
  if (year == null && ts > now + 86400e3) ts = new Date(y - 1, month, day, 12).getTime();
  return ts;
}

/** Stable key for de-duplicating a job across history, Gmail and board lists. */
export function jobKey({ board, jobId, title, company }) {
  if (board && jobId) return `${board}:${jobId}`;
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${board || "x"}:${norm(title)}@${norm(company)}`;
}
