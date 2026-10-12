// Content script for the boards' own "applied jobs" pages.
// Verified on 12 Oct 2026:
//  - LinkedIn: https://www.linkedin.com/jobs-tracker/?stage=applied  (class names are obfuscated, so
//    each card is read from the text segments inside its a[href*='/jobs/view/'] link:
//    ["Title", "Company · Location (On-site)", "Applied 2w ago", "(Posted 2w ago)"])
//  - Indeed: https://myjobs.indeed.com/applied  (.atw-AppCard with .atw-JobInfo-jobTitle,
//    .atw-JobInfo-companyLocation, .atw-StatusTag-description and an "Applied on Indeed on 23 Jun" line)
(() => {
  if (window.__ccpApplied) return;
  window.__ccpApplied = true;

  const isLinkedIn = /linkedin\.com$/.test(location.hostname);
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  function leaves(root) {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const t = clean(n.textContent);
      if (t) out.push(t);
    }
    return out;
  }

  function collectLinkedIn() {
    const items = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href*='/jobs/view/']")) {
      const m = (a.getAttribute("href") || "").match(/\/jobs\/view\/(\d+)/);
      if (!m || seen.has(m[1])) continue;
      const seg = leaves(a);
      if (!seg.length) continue;
      seen.add(m[1]);
      const title = seg[0];
      const meta = seg.find((s, i) => i > 0 && s.includes(" · ")) || seg[1] || "";
      const [company, ...rest] = meta.split(" · ");
      const location = rest.join(" · ").replace(/\s*\((?:On-site|Remote|Hybrid)\)\s*$/i, "").trim();
      const workType = (meta.match(/\((On-site|Remote|Hybrid)\)/i) || [])[1] || "";
      const appliedText = seg.find((s) => /^applied\b/i.test(s)) || "";
      const note = seg.find((s) => /^\((?:posted|no longer)/i.test(s)) || "";
      items.push({ board: "linkedin", jobId: m[1], url: `https://www.linkedin.com/jobs/view/${m[1]}/`, title, company: clean(company), location, workType, appliedText, status: note, statusText: "Applied" });
    }
    return items;
  }

  function collectIndeed() {
    const items = [];
    const seen = new Set();
    const cards = document.querySelectorAll(".atw-AppCard, [class*='AppCard']:not([class*='AppCard-'])");
    const t = (sel, root) => clean(root.querySelector(sel)?.innerText);
    for (const card of cards) {
      const a = card.querySelector("a[href*='viewjob'], a[href*='jk='], a[href*='/rc/clk'], a[href]");
      if (!a) continue;
      const href = a.href || "";
      const jk = (href.match(/[?&]jk=([0-9a-f]{8,})/i) || [])[1] || null;
      const key = jk || href;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      let title = t(".atw-JobInfo-jobTitle", card) || clean(a.innerText).split("\n")[0];
      title = title.replace(/\s*job description opens in a new window\s*/i, "").trim();
      const compLoc = (card.querySelector(".atw-JobInfo-companyLocation")?.innerText || "").split("\n").map(clean).filter(Boolean);
      const status = t(".atw-StatusTag-description", card);
      const appliedText = leaves(card).find((s) => /^applied on/i.test(s)) || "";
      if (!title) continue;
      items.push({
        board: "indeed", jobId: jk, url: jk ? `https://www.indeed.com/viewjob?jk=${jk}` : href.split("#")[0],
        title, company: compLoc[0] || "", location: compLoc[1] || "", appliedText, statusText: status, status: /not selected|rejected|closed/i.test(status) ? status : "",
      });
    }
    return items;
  }

  function collectGeneric() {
    const items = [];
    const seen = new Set();
    for (const a of document.querySelectorAll("a[href*='/job'], a[href*='jk=']")) {
      const href = a.href || "";
      if (seen.has(href)) continue;
      const card = a.closest("li, article, [class*='card'], [class*='Card']") || a.parentElement;
      const seg = leaves(card || a);
      const title = clean(a.innerText).split("\n")[0] || seg[0] || "";
      if (!title) continue;
      seen.add(href);
      items.push({ board: "web", jobId: null, url: href.split("#")[0], title, company: seg[1] || "", location: "", appliedText: seg.find((s) => /applied/i.test(s)) || "" });
    }
    return items;
  }

  function collect() {
    const items = isLinkedIn ? collectLinkedIn() : /indeed\.com$/.test(location.hostname) ? collectIndeed() : collectGeneric();
    return { items, url: location.href, count: items.length };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "APPLIED_COLLECT") return;
    try {
      sendResponse(collect());
    } catch (e) {
      sendResponse({ items: [], error: e.message });
    }
  });
})();
