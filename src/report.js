if (!globalThis.chrome?.runtime?.id) await import("../dev/chrome-shim.js");

import { getSettings, getJobs, getMail } from "./lib/storage.js";
import { BOARDS } from "./lib/boards.js";
import { KIND_LABELS } from "./lib/classify.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DAY = 86400e3;
const boardName = (k) => BOARDS[k]?.name || (k === "email" ? "Email" : k === "manual" ? "Manual" : k || "");
const d = (ts) => new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });

const params = new URLSearchParams(location.search);
$("#days").value = params.get("days") || "7";
$("#days").addEventListener("change", render);
$("#btnPrint").addEventListener("click", () => print());

async function render() {
  const days = +$("#days").value;
  const since = Date.now() - days * DAY;
  const [settings, jobs, mail] = await Promise.all([getSettings(), getJobs(), getMail()]);
  const applied = Object.values(jobs).filter((j) => j.status === "applied" && (j.appliedAt || j.lastSeen) >= since).map((j) => ({ ...j, when: j.appliedAt || j.lastSeen }));
  const likely = Object.values(jobs).filter((j) => j.status === "likely" && (j.lastSeen || 0) >= since);
  const mails = Object.values(mail).filter((m) => (m.dateTs || 0) >= since);
  document.title = `Job Application Report - ${settings.candidateName || "Candidate"}`;
  $("#sub").textContent = `${settings.candidateName || "Candidate"}${settings.candidateEmail ? " · " + settings.candidateEmail : ""}${settings.targetTitles ? " · Target: " + settings.targetTitles : ""}`;
  $("#gen").textContent = `${d(since)} – ${d(Date.now())}\nGenerated ${new Date().toLocaleString()}`;

  const byBoard = {};
  for (const j of applied) byBoard[j.board] = (byBoard[j.board] || 0) + 1;
  const tiles = [
    [applied.length, "Applications"],
    ...Object.entries(byBoard).sort((a, b) => b[1] - a[1]).map(([b, n]) => [n, boardName(b)]),
    [mails.filter((m) => m.kind === "recruiter" || m.kind === "rtr").length, "Recruiter messages"],
    [mails.filter((m) => m.kind === "interview").length, "Interview requests"],
  ];
  $("#tiles").innerHTML = tiles.map(([n, l]) => `<div class="tile"><b>${n}</b><span>${esc(l)}</span></div>`).join("");

  const byDay = {};
  for (const j of applied) {
    const k = new Date(j.when).toISOString().slice(0, 10);
    (byDay[k] ||= []).push(j);
  }
  const dayRows = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    const list = byDay[k] || [];
    const detail = list.length ? Object.entries(list.reduce((a, j) => ((a[boardName(j.board)] = (a[boardName(j.board)] || 0) + 1), a), {})).map(([b, n]) => `${b} ${n}`).join(", ") : "No applications";
    dayRows.push(`<tr><td>${d(new Date(k + "T12:00:00"))}</td><td>${list.length}</td><td>${esc(detail)}</td></tr>`);
  }
  $("#byDay").innerHTML = `<tr><th>Date</th><th>Applied</th><th>Detail</th></tr>${dayRows.join("")}<tr><th>Total</th><th>${applied.length}</th><th></th></tr>`;

  const all = applied.sort((a, b) => b.when - a.when);
  $("#all").innerHTML = `<tr><th>#</th><th>Date</th><th>Job title</th><th>Company</th><th>Location</th><th>Board</th></tr>` +
    (all.length ? all.map((j, i) => `<tr><td>${i + 1}</td><td>${new Date(j.when).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td><td>${j.url ? `<a href="${esc(j.url)}">${esc(j.title)}</a>` : esc(j.title)}</td><td>${esc(j.company)}</td><td>${esc(j.location || "")}</td><td>${esc(boardName(j.board))}</td></tr>`).join("") : `<tr><td colspan="6">No applications in this period.</td></tr>`) +
    (likely.length ? `<tr><td colspan="6" class="muted">${likely.length} further apply flow(s) were started but not confirmed (not counted).</td></tr>` : "");

  const rec = mails.filter((m) => ["recruiter", "rtr", "interview", "rejection"].includes(m.kind)).sort((a, b) => b.dateTs - a.dateTs);
  $("#recruiters").innerHTML = `<tr><th>Date</th><th>Type</th><th>From</th><th>Subject</th><th>Field</th></tr>` +
    (rec.length ? rec.map((m) => `<tr><td>${new Date(m.dateTs).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td><td>${esc(KIND_LABELS[m.kind])}</td><td>${esc(m.recruiter || m.from)}</td><td>${esc(m.subject)}</td><td>${esc((m.tags || []).join(", "))}</td></tr>`).join("") : `<tr><td colspan="5">No recruiter activity recorded in this period.</td></tr>`);
}

await render();
