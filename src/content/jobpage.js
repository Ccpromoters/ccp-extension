// Content script for job boards: reads the job posting on the page (title, company, location,
// description) on request, and quietly reports postings the user views so the extension can
// build a skills-gap picture. Nothing leaves the browser.
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

  const SEL = {
    linkedin: {
      title: [".job-details-jobs-unified-top-card__job-title h1", ".job-details-jobs-unified-top-card__job-title", "h1.t-24", ".jobs-unified-top-card__job-title", "h1.top-card-layout__title", "h1"],
      company: [".job-details-jobs-unified-top-card__company-name a", ".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name a", ".jobs-unified-top-card__company-name", "a.topcard__org-name-link", "[data-tracking-control-name='public_jobs_topcard-org-name']"],
      location: [".job-details-jobs-unified-top-card__tertiary-description-container span", ".job-details-jobs-unified-top-card__bullet", ".jobs-unified-top-card__bullet", ".topcard__flavor--bullet"],
      desc: ["#job-details", ".jobs-description__content", ".jobs-box__html-content", ".description__text", ".show-more-less-html__markup"],
    },
    indeed: {
      title: ["h1[data-testid='jobsearch-JobInfoHeader-title']", ".jobsearch-JobInfoHeader-title", "h1"],
      company: ["[data-testid='inlineHeader-companyName']", "[data-company-name='true']", "[data-testid='jobsearch-CompanyInfoContainer'] a", ".jobsearch-InlineCompanyRating div"],
      location: ["[data-testid='inlineHeader-companyLocation']", "[data-testid='job-location']", "[data-testid='jobsearch-JobInfoHeader-companyLocation']"],
      desc: ["#jobDescriptionText", ".jobsearch-jobDescriptionText", "[data-testid='jobsearch-JobComponent-description']"],
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

  const text = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+\n/g, "\n").trim() : "");
  const pick = (sels, min = 1, max = 300) => {
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const t = text(el);
        if (t.length >= min && t.length <= max) return t;
      }
    }
    return "";
  };

  function description() {
    const s = SEL[board]?.desc || [];
    for (const sel of s) {
      const el = document.querySelector(sel);
      const t = text(el);
      if (t.length > 200) return t;
    }
    // Fallback: the largest description-looking block on the page.
    let best = "";
    for (const el of document.querySelectorAll("main, article, [id*='escription'], [class*='escription'], [class*='job-detail'], [class*='jobDetail'], [class*='JobDetail']")) {
      const t = text(el);
      if (t.length > best.length) best = t;
    }
    if (best.length > 200) return best.slice(0, 20000);
    return text(document.body).slice(0, 20000);
  }

  function extract() {
    const s = SEL[board] || SEL.web;
    let title = pick(s.title, 2, 160) || (document.title || "").split(/\s[|\-–]\s/)[0].trim();
    title = title.replace(/^\(\d+\)\s*/, "").replace(/\s*\n.*$/s, "");
    return {
      url: location.href,
      pageTitle: document.title,
      board,
      title,
      company: pick(s.company, 2, 100),
      location: pick(s.location, 2, 100),
      text: description(),
    };
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
    if (u === lastUrl || !looksLikeJob(u)) return;
    lastUrl = u;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const jd = extract();
        if (jd.text.length > 300 && jd.title) chrome.runtime.sendMessage({ type: "JD_CAPTURED", jd }).catch(() => {});
      } catch {}
    }, 2500);
  };
  tick();
  setInterval(tick, 1500);
})();
