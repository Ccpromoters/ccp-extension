// Content script for Gmail: reads the thread list that is currently on screen (sender, subject,
// snippet, date) when the extension asks for it. Message bodies are never opened or read.
// Verified against Gmail's DOM on 12 Oct 2026: rows are tr.zA, the thread id sits on any element
// with data-legacy-thread-id (currently span.bqe), sender on span[email], date on td.xW span[title].
(() => {
  if (window.__ccpGmail) return;
  window.__ccpGmail = true;

  const accountIndex = () => {
    const m = location.pathname.match(/\/mail\/u\/(\d+)/);
    return m ? m[1] : "0";
  };

  // Gmail rewrites "%20" to "+" in the hash, so compare the decoded search text.
  const normHash = (h) => {
    try {
      return decodeURIComponent((h || "").replace(/\+/g, " ")).replace(/\s+/g, " ").trim();
    } catch {
      return (h || "").trim();
    }
  };

  function collect(expectHash) {
    const rows = [];
    for (const tr of document.querySelectorAll("tr.zA")) {
      const idEl = tr.querySelector("[data-legacy-thread-id]") || tr.querySelector("[data-thread-id]");
      const threadId = idEl?.getAttribute("data-legacy-thread-id") || (idEl?.getAttribute("data-thread-id") || "").replace(/^#thread-f:/, "") || tr.id || "";
      const subjEl = tr.querySelector("span.bog") || tr.querySelector("[data-legacy-thread-id]") || tr.querySelector(".y6 span");
      const subject = (subjEl?.textContent || "").trim();
      const fromEl = tr.querySelector("span[email]");
      const from = (fromEl?.getAttribute("name") || fromEl?.textContent || "").trim();
      const fromEmail = (fromEl?.getAttribute("email") || "").trim();
      const snippet = (tr.querySelector(".y2")?.textContent || "").replace(/^\s*[-–]\s*/, "").trim();
      const dateEl = tr.querySelector("td.xW span[title]") || tr.querySelector(".xW span");
      const dateText = dateEl?.getAttribute("title") || (dateEl?.textContent || "").trim();
      const dateTs = Date.parse(dateText) || null;
      if (!subject && !from) continue;
      rows.push({
        threadId, subject, from, fromEmail, snippet, dateText, dateTs,
        unread: tr.classList.contains("zE"),
        url: threadId && /^[0-9a-f]{10,}$/i.test(threadId) ? `https://mail.google.com/mail/u/${accountIndex()}/#all/${threadId}` : "",
      });
    }
    const empty = rows.length === 0 && [...document.querySelectorAll("td.TC, div.TC, .adx")].some((e) => /no (?:messages|conversations)/i.test(e.textContent || ""));
    const spinner = document.querySelector(".vX");
    const loading = !!spinner && spinner.offsetParent !== null && !!spinner.innerText.trim();
    return { ready: !expectHash || normHash(location.hash) === normHash(expectHash), hash: location.hash, rows, empty, loading };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "GMAIL_COLLECT") return;
    try {
      sendResponse(collect(msg.expectHash));
    } catch (e) {
      sendResponse({ ready: true, rows: [], error: e.message });
    }
  });
})();
