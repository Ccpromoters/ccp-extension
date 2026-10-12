// Content script for job boards: reads the job posting on the page (title, company, location,
// description) on request, and quietly reports postings the user views so the extension can
// build a skills-gap picture. Nothing leaves the browser.
//
// LinkedIn (checked 12 Oct 2026) uses obfuscated class names, so it is read from structure and
// text: the tab title ("Job | Company | LinkedIn"), the "About the job" heading and the text
// segments of the job pane. The other boards use selector lists with a generic fallback.
(() => {
  if (window.__ccpJobPage) return;
  window.__ccpJobPage = true;

  const host = location.hostname;
  const board = /linkedin\.com$/.test(host) ? "linkedin"
    : /indeed\.com$/.test(host) ? "indeed"
    : /ziprecruiter\.com$/.test(host) ? "ziprecruiter"
    : /dice\.com$/.test(host) ? "dice"
    : /monster\.com$/.test(host) ? "monster"
    : /glassdoor\.com$/.test(host) ? "glassdoor" : "web";

  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const text = (el) => (el ? (el.innerText || el.textContent || "").replace(/[ \t]+\n/g, "\n").trim() : "");

  function leaves(root) {
    const out = [];
    if (!root) return out;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentElement && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(n.parentElement.tagName)) continue;
      const t = clean(n.textContent);
      if (t) out.push(t);
    }
    return out;
  }

  const SEL = {
    // Indeed (checked 12 Oct 2026): viewjob pages use vj-* / company-info-* test ids; older ids kept as fallbacks.
    indeed: {
      title: ["[data-testid='vj-job-title']", "h1[data-testid='jobsearch-JobInfoHeader-title']", ".jobsearch-JobInfoHeader-title", "h2[data-testid='jobsearch-JobInfoHeader-title']", "h1"],
      company: ["[data-testid='company-info-title-row'] a", "[data-testid='company-info-title-row']", "[data-testid='inlineHeader-companyName']", "[data-company-name='true']", "[data-testid='jobsearch-CompanyInfoContainer'] a"],
      location: ["[data-testid='company-info-metadata']", "[data-testid='inlineHeader-companyLocation']", "[data-testid='job-location']", "[data-testid='jobsearch-JobInfoHeader-companyLocation']"],
      desc: ["#jobDescriptionText", ".jobsearch-jobDescriptionText", "[data-testid='jobsearch-JobComponent-description']", "[data-testid='vj-job-description-heading'] + *", "[data-testid='viewjob-job-content']"],
    },
    ziprecruiter: {
      title: ["h1.job_title", "h1[class*='job_title']", "h1[class*='JobTitle']", "h1"],
      company: [".hiring_company_text", "a.hiring_company", "[class*='company_name']", "[class*='CompanyName']", "[data-testid='job-card-company']"],
      location: [".location_text", "[class*='Location']", "[class*='location']"],
      desc: [".job_description", "#job-description", "[class*='jobDescription']", "[class*='job_description']", "[class*='JobDescription']"],
    },
    dice: {
      title: ["h1[data-cy='jobTitle']", "[data-testid='jobTitle']", "h1"],
      company: ["[data-cy='companyNameLink']", "[data-testid='companyNameLink']", "a[href*='/company-profile/']", "[data-cy='companyName']"],
      location: ["[data-cy='location']", "li[data-cy='location']", "[data-testid='location']"],
      desc: ["#jobDescription", "[data-testid='jobDescriptionHtml']", "[data-cy='jobDescription']", ".job-description"],
    },
    monster: {
      title: ["[data-testid='jobTitle']", "h1[class*='JobTitle']", "h1"],
      company: ["[data-testid='company']", "[class*='CompanyName']", ".company"],
      location: ["[data-testid='jobDetailLocation']", "[class*='JobLocation']", "[class*='location']"],
      desc: ["[data-testid='svx-description-container-inner']", "#JobDescription", "[class*='descriptionContainer']", ".job-description"],
    },
    glassdoor: {
      title: ["h1[id^='jd-job-title']", "[data-test='job-title']", "h1"],
      company: ["[data-test='employer-name']", "[class*='EmployerProfile_employerName']", "[class*='employerName']"],
      location: ["[data-test='location']", "[class*='JobDetails_location']"],
      desc: ["[class*='JobDetails_jobDescription']", ".jobDescriptionContent", "#JobDescriptionContainer"],
    },
    web: { title: ["h1"], company: [], location: [], desc: [] },
  };

  // First line of the first matching element (header rows often carry extra lines such as ratings).
  const pick = (sels, min = 1, max = 300) => {
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const t = clean((el.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean)[0] || "");
        if (t.length >= min && t.length <= max) return t;
      }
    }
    return "";
  };

  /** Element that holds the heading "About the job" (or similar), if any. */
  function findHeading(rx) {
    return [...document.querySelectorAll("h1,h2,h3,h4,strong,div,span,p")].find((e) => e.children.length <= 1 && rx.test(clean(e.innerText)));
  }

  function largestBlock() {
    let best = null;
    for (const el of document.querySelectorAll("main, article, section, div")) {
      const len = (el.innerText || "").length;
      if (len < 300 || len > 25000) continue;
      const kids = el.querySelectorAll("div,section,article").length;
      if (!best || (len > best.len && kids < 400)) best = { el, len };
    }
    return best ? text(best.el) : text(document.body).slice(0, 20000);
  }

  function extractLinkedIn() {
    const heading = findHeading(/^about the job$/i);
    let section = heading;
    while (section && clean(section.innerText).length < 300) section = section.parentElement;
    let pane = null;
    if (section) {
      let p = section.parentElement;
      while (p && p !== document.body) {
        const L = leaves(p);
        if (L.length < 500 && L.some((t) => /^(easy apply|apply|save|saved)$/i.test(t))) {
          pane = p;
          break;
        }
        p = p.parentElement;
      }
    }
    let title = "";
    let company = "";
    let loc = "";
    const tm = (document.title || "").replace(/^\(\d+\)\s*/, "").match(/^(.*?)\s*\|\s*(.*?)\s*\|\s*LinkedIn$/);
    if (tm && /\/jobs\/view\//.test(location.pathname)) {
      title = tm[1].trim();
      company = tm[2].trim();
    }
    // Button labels that sit between company and title in the job pane.
    const BTN = /^(share|show more options|save|saved|easy apply|apply|dismiss|follow|following|report|more|·|see more|see less|show more|show less)$/i;
    if (title) {
      // Job view page: the top card is the first thing in <main>: company, title, location.
      const M = leaves(document.querySelector("main") || document.body).slice(0, 30);
      const i = M.indexOf(title);
      if (i >= 0) {
        if (!company) company = M[i - 1] || "";
        loc = M[i + 1] || "";
      }
    } else {
      // Search page pane: company, (buttons), title, location.
      const P = leaves(pane || document.querySelector("main") || document.body).filter((t) => !BTN.test(t));
      company = P[0] || "";
      title = P[1] || "";
      loc = P[2] || "";
    }
    if (/^·$|ago$|applicants|^\d/i.test(loc) || loc.length > 80) loc = "";
    const desc = section ? text(section).replace(/^about the job\s*/i, "") : largestBlock();
    return { title, company, location: loc, text: desc };
  }

  function extractGeneric() {
    const s = SEL[board] || SEL.web;
    let title = pick(s.title, 2, 160) || (document.title || "").split(/\s[|\-–]\s/)[0].trim();
    title = title.replace(/^\(\d+\)\s*/, "");
    let desc = "";
    for (const sel of s.desc) {
      const t = text(document.querySelector(sel));
      if (t.length > 200) {
        desc = t;
        break;
      }
    }
    if (!desc) {
      const h = findHeading(/^(about the job|job description|description|about this job|about the role)$/i);
      let sec = h;
      while (sec && clean(sec.innerText).length < 300) sec = sec.parentElement;
      desc = sec ? text(sec) : largestBlock();
    }
    let company = pick(s.company, 2, 100);
    let loc = pick(s.location, 2, 100);
    // Indeed's header metadata block holds "Company\nLocation" on two lines.
    const meta = board === "indeed" && document.querySelector("[data-testid='company-info-metadata']");
    if (meta) {
      const lines = (meta.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean);
      if (lines[0]) company = lines[0];
      loc = lines[1] || "";
    }
    return { title, company, location: loc, text: desc };
  }

  function extract() {
    const r = board === "linkedin" ? extractLinkedIn() : extractGeneric();
    return { url: location.href, pageTitle: document.title, board, ...r, text: (r.text || "").slice(0, 20000) };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== "EXTRACT_JD") return;
    try {
      sendResponse(extract());
    } catch (e) {
      sendResponse({ error: e.message });
    }
  });

  // Passive capture of postings the user opens (for the skills-gap view). Debounced per URL.
  const looksLikeJob = (u) => /\/jobs\/view\/|currentJobId=|viewjob|[?&]jk=|job-detail|\/Job\/|job-openings|job-listing|jobListingId=|\/jobs\/[^/?]+\/[^/?]+/i.test(u);
  let lastUrl = "";
  let timer = null;
  const tick = () => {
    const u = location.href;
    if (u === lastUrl || !looksLikeJob(u) || document.visibilityState !== "visible") return;
    lastUrl = u;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const jd = extract();
        if (jd.text.length > 300 && jd.title) chrome.runtime.sendMessage({ type: "JD_CAPTURED", jd }).catch(() => {});
        else lastUrl = "";
      } catch {}
    }, 3000);
  };
  tick();
  setInterval(tick, 1500);
})();
