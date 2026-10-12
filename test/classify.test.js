import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyMail } from "../src/lib/classify.js";
import { classifyJobUrl, parseHistoryTitle, jobKey } from "../src/lib/boards.js";
import { keywordGap, yearsRequired, fieldTags } from "../src/lib/skills-dict.js";

const row = (from, fromEmail, subject, snippet = "") => ({ from, fromEmail, subject, snippet });

test("classifyMail: application confirmations from boards", () => {
  const li = classifyMail(row("LinkedIn", "jobs-noreply@linkedin.com", "Your application was sent to Intec Select", "Senior System Administrator - Houston, TX"));
  assert.equal(li.kind, "applied");
  assert.equal(li.board, "linkedin");
  assert.equal(li.company, "Intec Select");
  const ind = classifyMail(row("Indeed Apply", "indeedapply@indeed.com", "Indeed Application: Systems Administrator", "Shentel - Edinburg, VA"));
  assert.equal(ind.kind, "applied");
  assert.equal(ind.title, "Systems Administrator");
  assert.equal(ind.board, "indeed");
  const generic = classifyMail(row("Workday", "noreply@myworkday.com", "Thank you for applying to Service Wire", "We have received your application for Network Administrator."));
  assert.equal(generic.kind, "applied");
});

test("classifyMail: alerts, rejections, interviews, RTR and recruiter outreach", () => {
  assert.equal(classifyMail(row("LinkedIn Job Alerts", "jobalerts-noreply@linkedin.com", "30+ new jobs for systems administrator")).kind, "alert");
  assert.equal(classifyMail(row("Indeed", "alert@indeed.com", "Systems Administrator jobs in Charleston, WV")).kind, "alert");
  assert.equal(classifyMail(row("Talent Team", "careers@acme.com", "Update on your application", "Unfortunately we have decided to move forward with other candidates.")).kind, "rejection");
  assert.equal(classifyMail(row("Priya R", "priya@staffingco.com", "Interview availability - Windows Admin role", "Can you share your availability for a phone screen this week?")).kind, "interview");
  const rtr = classifyMail(row("Raj K", "raj@vendor.com", "RTR needed for Systems Engineer - Charlotte NC", "Please reply with your right to represent."));
  assert.equal(rtr.kind, "rtr");
  const rec = classifyMail(row("Amit S", "amit@techstaff.com", "Urgent requirement: Windows Server Administrator (W2, Hybrid)", "We have an immediate need for a Windows admin with Active Directory and VMware. Rate $55/hr on W2."));
  assert.equal(rec.kind, "recruiter");
  assert.equal(rec.recruiter, "Amit S");
  assert.ok(rec.tags.includes("Windows / Infrastructure"), rec.tags.join(","));
  const inmail = classifyMail(row("LinkedIn", "messages-noreply@linkedin.com", "New message from Sara Lee", "Hi, I have a contract opportunity for a Release Manager..."));
  assert.equal(inmail.kind, "recruiter");
  assert.equal(inmail.recruiter, "Sara Lee");
  assert.equal(classifyMail(row("Netflix", "info@netflix.com", "New arrivals this week")).kind, "other");
});

test("classifyJobUrl recognises job pages and apply flows per board", () => {
  assert.deepEqual(classifyJobUrl("https://www.linkedin.com/jobs/view/4012345678/?refId=abc"), { board: "linkedin", jobId: "4012345678", status: "viewed" });
  assert.equal(classifyJobUrl("https://www.linkedin.com/jobs/view/4012345678/post-apply/add-skills").status, "applied");
  assert.deepEqual(classifyJobUrl("https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b&from=serp"), { board: "indeed", jobId: "1a2b3c4d5e6f7a8b", status: "viewed" });
  assert.equal(classifyJobUrl("https://smartapply.indeed.com/beta/indeedapply/form/resume").status, "likely");
  assert.equal(classifyJobUrl("https://smartapply.indeed.com/beta/indeedapply/form/post-apply").status, "applied");
  assert.equal(classifyJobUrl("https://www.dice.com/job-detail/0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d").board, "dice");
  assert.equal(classifyJobUrl("https://www.ziprecruiter.com/c/Acme/Job/Systems-Administrator/-in-Houston,TX?jid=abcdef1234567890").jobId, "abcdef1234567890");
  assert.equal(classifyJobUrl("https://www.monster.com/job-openings/systems-administrator-houston-tx--abc123").board, "monster");
  assert.equal(classifyJobUrl("https://www.linkedin.com/feed/"), null);
  assert.equal(classifyJobUrl("https://www.google.com/"), null);
});

test("parseHistoryTitle extracts title and company from page titles", () => {
  assert.deepEqual(parseHistoryTitle("linkedin", "Intec Select hiring Senior System Administrator in Houston, TX | LinkedIn"), { company: "Intec Select", title: "Senior System Administrator", location: "Houston, TX" });
  assert.deepEqual(parseHistoryTitle("linkedin", "(2) Systems Engineer | Robert Half | LinkedIn"), { title: "Systems Engineer", company: "Robert Half", location: "" });
  assert.deepEqual(parseHistoryTitle("indeed", "Systems Administrator - Houston, TX 77002 - Indeed.com"), { title: "Systems Administrator", company: "", location: "Houston, TX 77002" });
  assert.deepEqual(parseHistoryTitle("ziprecruiter", "Network Administrator Job in Charleston, WV at Service Wire | ZipRecruiter"), { title: "Network Administrator", location: "Charleston, WV", company: "Service Wire" });
  assert.equal(parseHistoryTitle("monster", "IT Infrastructure Administrator | Monster").title, "IT Infrastructure Administrator");
  assert.equal(jobKey({ board: "linkedin", jobId: "1" }), "linkedin:1");
  assert.equal(jobKey({ board: "indeed", title: "Sys Admin", company: "Acme Inc." }), "indeed:sys admin@acme inc");
});

test("skills dictionary: keyword gap, years and field tags", () => {
  const jd = "Senior Systems Administrator. 7+ years of experience with Windows Server, Active Directory, VMware vSphere and Veeam. Intune a plus. Minimum of 5 years with PowerShell.";
  const resume = "Windows Server 2019, Active Directory, Group Policy, VMware ESXi, Backup Exec, PowerShell scripting.";
  const gap = keywordGap(jd, resume);
  assert.ok(gap.matched.includes("Windows Server"));
  assert.ok(gap.missing.includes("Backup (Veeam)"));
  assert.ok(gap.missing.includes("Intune"));
  assert.ok(!gap.missing.includes("PowerShell"));
  assert.equal(yearsRequired(jd), 7);
  assert.equal(yearsRequired("No experience needed"), null);
  assert.ok(fieldTags("Need a SOC analyst with Splunk, SIEM and incident response").includes("Cybersecurity / SOC"));
});
