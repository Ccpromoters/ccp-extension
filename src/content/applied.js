// Content script for the boards' own "applied jobs" pages (LinkedIn My Items, Indeed My Jobs).
// Reads the visible cards: title, company, location and the "Applied ... ago" text.
(() => {
  if (window.__ccpApplied) return;
  window.__ccpApplied = true;

  const isLinkedIn = /linkedin\.com$/.test(location.hostname);

  function collect() {
    const items = [];
    const seen = new Set();
    const anchors = document.querySelectorAll(isLinkedIn ? "a[href*='/jobs/view/']" : "a[href*='viewjob'], a[href*='jk='], a[href*='/job/'], a[href*='/rc/clk']");
    for (const a of anchors) {
      const href = a.href || "";
      const m = isLinkedIn ? href.match(/\/jobs\/view\/(\d+)/) : href.match(/[?&]jk=([0-9a-f]{8,})/i);
      const jobId = m ? m[1] : href;
      if (!jobId || seen.has(jobId)) continue;
      const card = a.closest("li, article, [class*='card'], [class*='Card'], [data-testid*='card'], [data-testid*='Card']") || a.parentElement;
      const lines = (card?.innerText || a.innerText || "").split("\n").map((s) => s.trim()).filter(Boolean);
      const title = (a.innerText || "").trim().split("\n")[0] || lines[0] || "";
      if (!title) continue;
      seen.add(jobId);
      const idx = lines.findIndex((l) => l === title);
      const company = idx >= 0 ? lines[idx + 1] || "" : "";
      const loc = idx >= 0 ? lines[idx + 2] || "" : "";
      const appliedText = lines.find((l) => /applied/i.test(l)) || "";
      items.push({
        board: isLinkedIn ? "linkedin" : "indeed",
        jobId: m ? jobId : null,
        url: isLinkedIn && m ? `https://www.linkedin.com/jobs/view/${m[1]}/` : href.split("#")[0],
        title, company, location: /applied/i.test(loc) ? "" : loc, appliedText,
      });
    }
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
