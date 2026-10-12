// Rule-based classification of Gmail thread rows (from, subject, snippet) into
// applied / interview / rejection / rtr / recruiter / alert / other, with light extraction
// of company, title and field tags. No network, no AI.

import { boardForSender } from "./boards.js";
import { fieldTags } from "./skills-dict.js";

const ALERT_SENDERS = /jobalerts-noreply@linkedin\.com|jobs-listings@linkedin\.com|alert@indeed\.com|noreply@(?:ziprecruiter|dice|monster|glassdoor)\.com|invitations@linkedin\.com|notifications-noreply@linkedin\.com/i;
const ALERT_SUBJECT = /job alert|new jobs? (?:for|matching|in|near)|jobs for you|recommended (?:jobs|for you)|\d+ new jobs|apply now:|you may be interested|top job picks|jobs you might like|hiring now near|your job search|daily (?:jobs|digest)|weekly (?:jobs|digest)/i;

const APPLIED = /your application (?:was sent|has been (?:sent|submitted|received)|to .+ (?:was|has been) (?:sent|received))|application (?:sent|submitted|received|confirmation|complete)|thank(?:s| you) for (?:applying|your application|your interest)|we(?:'ve| have) received your (?:application|resume)|you (?:applied|have applied) (?:to|for)|^indeed application:|successfully applied|application for .+ (?:received|submitted)/i;
const INTERVIEW = /\binterview\b|phone screen|screening call|schedule (?:a |an |the )?(?:call|time|meeting|conversation)|your availability|technical (?:round|discussion|assessment)|next steps? in (?:the|our) (?:process|hiring)|assessment invitation|coding (?:test|challenge)/i;
const REJECTION = /not (?:be )?moving forward|other candidates|unfortunately|not selected|decided to (?:move forward|pursue|proceed) with|position has been filled|no longer under consideration|will not be moving|not a match at this time|pursue other (?:candidates|applicants)|more closely (?:match|align)|not able to offer|application (?:status|update): (?:not|closed)|regret to inform/i;
const RTR = /right to represent|\bRTR\b|authorization to (?:represent|submit)|consent to submit|submission (?:for|to) (?:client|end client)/i;
const RECRUITER = /opportunit(?:y|ies)|requirement|job (?:opening|description|order|title|opportunity)|\bJD\b|\bC2C\b|\bW2\b|\b1099\b|corp[- ]to[- ]corp|contract (?:role|position|to hire|opportunity)|\bC2H\b|\brate\b|urgent(?:ly)? (?:hiring|need|requirement|looking)|hiring for|immediate (?:need|requirement|opening|joiner)|looking for (?:a|an|experienced)|open (?:position|role|requisition)|we have an? (?:opening|position|role|requirement)|updated resume|share your resume|send (?:me |us )?your resume|are you (?:available|open|interested)|hot (?:job|requirement|list)|remote (?:role|position|job)|onsite|hybrid|\$\d{2,3}(?:\/hr|k)|per hour|\bhr\b rate/i;

function extractCompanyTitle(row, board) {
  const s = row.subject || "";
  const snip = row.snippet || "";
  let company = "";
  let title = "";
  let m;
  if ((m = s.match(/your application (?:was sent|has been sent|was received) to (.+?)(?:\s*[-–|:]|$)/i))) company = m[1].trim();
  else if ((m = s.match(/^indeed application:\s*(.+)$/i))) title = m[1].trim();
  else if ((m = s.match(/application (?:for|to) (?:the )?(.+?) (?:at|with|@) (.+?)(?:\s*[-–|]|$)/i))) { title = m[1].trim(); company = m[2].trim(); }
  else if ((m = s.match(/(?:applied|application) (?:for|to) (?:the )?(.+?)(?:\s*[-–|]|$)/i))) title = m[1].trim();
  if (!company && (m = s.match(/\bat ([A-Z][\w&.,' -]{2,60}?)(?:\s*[-–|!]|$)/))) company = m[1].trim();
  if (!company && (m = snip.match(/(?:applied|application) (?:to|for|at) (?:the )?.+? (?:at|with) ([A-Z][\w&.,' -]{2,50}?)(?:[.!,]|\s+(?:on|in|for)\b|$)/))) company = m[1].trim();
  if (!title && (m = snip.match(/(?:applied|application) (?:to|for) (?:the )?([A-Z][\w/&,' -]{3,70}?)(?: (?:position|role|job|opening|at|with)\b|[.!,]|$)/))) title = m[1].trim();
  if (!company && board === "indeed" && (m = snip.match(/^([A-Z][\w&.,' -]{2,50}?) - [A-Z][a-z]+/))) company = m[1].trim();
  if (!company && !board && row.from && !/noreply|no-reply|notification|donotreply/i.test(row.fromEmail || "")) company = "";
  return { company, title };
}

/** Classify one Gmail row. */
export function classifyMail(row) {
  const from = row.from || "";
  const fromEmail = (row.fromEmail || "").toLowerCase();
  const subject = row.subject || "";
  const snippet = row.snippet || "";
  const all = `${subject}\n${snippet}`;
  const board = boardForSender(fromEmail);
  const tags = fieldTags(all);
  const base = { board, tags, company: "", title: "", recruiter: "" };

  if (ALERT_SENDERS.test(fromEmail) || ALERT_SUBJECT.test(subject)) return { ...base, kind: "alert" };

  if (APPLIED.test(subject) || (board && APPLIED.test(snippet))) {
    return { ...base, kind: "applied", ...extractCompanyTitle(row, board) };
  }
  if (REJECTION.test(all)) return { ...base, kind: "rejection", ...extractCompanyTitle(row, board) };
  if (RTR.test(all)) return { ...base, kind: "rtr", recruiter: from };
  if (INTERVIEW.test(subject) || (INTERVIEW.test(snippet) && !board)) return { ...base, kind: "interview", recruiter: from, ...extractCompanyTitle(row, board) };
  const automated = /noreply|no-reply|donotreply|notification|mailer|newsletter|support@|billing|security|verify|password/i.test(fromEmail);
  if (RECRUITER.test(all) && (!automated || /messages-noreply@linkedin\.com/i.test(fromEmail))) {
    const rec = /messages-noreply@linkedin\.com/i.test(fromEmail) ? (subject.match(/(?:from|message from)\s+(.+?)(?:\s*[-–|:]|$)/i) || [, from])[1] : from;
    return { ...base, kind: "recruiter", recruiter: (rec || from).trim() };
  }
  return { ...base, kind: "other" };
}

export const KIND_LABELS = {
  applied: "Application confirmed",
  interview: "Interview / next step",
  rejection: "Rejection",
  rtr: "Right to represent (RTR)",
  recruiter: "Recruiter outreach",
  alert: "Job alert",
  other: "Other",
};
