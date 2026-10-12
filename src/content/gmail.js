// Content script for Gmail: reads the thread list that is currently on screen (sender, subject,
// snippet, date) when the extension asks for it. Message bodies are never opened or read.
(() => {
  if (window.__ccpGmail) return;
  window.__ccpGmail = true;

  const accountIndex = () => {
    const m = location.pathname.match(/\/mail\/u\/(\d+)/);
    return m ? m[1] : "0";
  };

  function collect(expectHash) {
    const rows = [];
    for (const tr of document.querySelectorAll("tr.zA")) {
      const subjEl = tr.querySelector("span.bog") || tr.querySelector(".y6 span");
      const subject = (subjEl?.textContent || "").trim();
      const threadId = subjEl?.getAttribute("data-legacy-thread-id") || tr.getAttribute("data-legacy-thread-id") || (subjEl?.getAttribute("data-thread-id") || "").replace(/^#thread-f:/, "");
      const fromEl = tr.querySelector("span[email]");
      const from = (fromEl?.getAttribute("name") || fromEl?.textContent || "").trim();
      const fromEmail = (fromEl?.getAttribute("email") || "").trim();
      const snippet = (tr.querySelector(".y2")?.textContent || "").replace(/^\s*[-–]\s*/, "").trim();
      const dateEl = tr.querySelector("td.xW span[title]") || tr.querySelector(".xW span");
      const dateText = dateEl?.getAttribute("title") || (dateEl?.textContent || "").trim();
      const dateTs = Date.parse(dateText) || null;
      rows.push({
        threadId, subject, from, fromEmail, snippet, dateText, dateTs,
        unread: tr.classList.contains("zE"),
        url: threadId ? `https://mail.google.com/mail/u/${accountIndex()}/#all/${threadId}` : "",
      });
    }
    const empty = rows.length === 0 && [...document.querySelectorAll("td.TC, div.TC, .adx")].some((e) => /no (?:messages|conversations)/i.test(e.textContent || ""));
    const loading = !!document.querySelector(".vX .vh, [role='progressbar']:not([aria-hidden='true'])");
    return { ready: !expectHash || location.hash === expectHash, hash: location.hash, rows, empty, loading };
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
