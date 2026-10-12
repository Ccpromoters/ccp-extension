# Publishing CCP Extension on the Chrome Web Store

Checklist and ready-to-paste listing text. The whole process takes about 20 minutes of form filling plus Google's review (usually 1–3 business days, sometimes longer for extensions that use `history` and broad site access).

## Before you start

1. A Google account for the developer dashboard: https://chrome.google.com/webstore/devconsole – use hr@ccpromoters.com so the listing stays with the company.
2. Pay the one-time **$5 developer registration fee** (card payment on the dashboard).
3. Build the zip: `npm run package` → `dist/ccp-extension-v1.0.0.zip` (or download it from the GitHub release).
4. Screenshots: 1280×800 PNG, at least one, up to five – see *Screenshots* below. Promo tile 440×280 PNG (optional but recommended).
5. Privacy policy URL: https://github.com/Ccpromoters/ccp-extension/blob/main/PRIVACY.md (or the GitHub Pages copy).

## Store listing

**Name:** CCP Extension – Job Search Assistant

**Summary (132 characters max):**
Opens your job boards, tracks applications from Gmail & history, sorts recruiter mail, and tailors your resume to any JD — all local.

**Category:** Productivity → Workflow & Planning

**Language:** English

**Description:**

CCP Extension is a free, open-source assistant for job seekers and career-support teams.

OPEN YOUR BOARDS IN ONE CLICK
LinkedIn Jobs, Indeed, ZipRecruiter, Dice, Monster (optionally Glassdoor), Gmail and Chrome history – only the tabs that are not already open. Optionally every time Chrome starts.

TRACK EVERY APPLICATION
The extension reads your own browser history for job pages and apply flows, your Gmail thread list for "your application was sent" confirmations, and the "Applied" pages on LinkedIn and Indeed. Everything is merged into one list with filters, CSV export and a printable weekly report.

SORT RECRUITER MAIL
Recruiter outreach, right-to-represent requests, interview invitations, rejections and confirmations – classified and tagged by field (infrastructure, cloud, cybersecurity, civil engineering, …). One click opens the thread in Gmail.

TAILOR YOUR RESUME, TRUTHFULLY
Upload your final resume (.docx) once. For any job, paste the description or click "Use current tab". Using your own AI API key (Anthropic Claude by default, or any OpenAI-compatible endpoint), the extension proposes the smallest edits that align your wording with the job: missing skills added to your existing skills rows, at most a couple of bullet points changed, optional light rewording of the summary. It edits a copy of your Word file in place – same layout, same fonts, every other line untouched – and gives you the download plus a clear list of what changed, what the job asks for that you do not have, and what to confirm before adding. It never invents employers, dates, years, certifications or numbers.

SKILLS GAP
Job descriptions you open are collected locally so you can see which skills the market keeps asking for that your resume does not mention.

PRIVACY
No server, no account, no analytics. All data stays in your Chrome profile. The only network request is the AI call you trigger yourself, sent directly to the provider you configured with your key (phone and email are redacted first). Source code: github.com/Ccpromoters/ccp-extension

Not affiliated with LinkedIn, Indeed, ZipRecruiter, Dice, Monster, Glassdoor, Google or Anthropic.

## Privacy practices tab

- **Single purpose:** Help job seekers organise their job search: open job boards, record applications from their own history and Gmail, classify recruiter mail, and tailor their resume to a job description.
- **Permission justifications:**
  - `tabs` – open the job boards and Gmail in tabs; find the Gmail tab and the active job posting.
  - `history` – read the user's own history for job posting and application URLs on the supported job boards to build the applications list.
  - `storage` / `unlimitedStorage` – keep settings, the uploaded resume, the applications list and mail list locally.
  - `sidePanel` – the extension's UI is a side panel.
  - `downloads` – save the tailored resume, CSV export and settings backup to the Downloads folder.
  - `contextMenus` – "Open job boards" and "Settings" on the icon; "Tailor resume for this job" on job pages.
  - `scripting` / `activeTab` – read the job posting in the current tab when the user clicks "Use current tab", and inject the Gmail reader into an already-open Gmail tab.
  - Host permissions (job boards, mail.google.com) – content scripts read job postings, the boards' "applied" pages and the Gmail thread list. api.anthropic.com – send the resume text and JD to the AI provider with the user's own key.
- **Remote code:** No, the extension does not use remote code.
- **Data usage:** collects *Personal communications* (Gmail thread list metadata), *Web history* (job board URLs), *Personally identifiable information* (name in the resume), *User activity* (job pages visited). All stored locally. Certify: not sold, not used for unrelated purposes, not used for creditworthiness.

## Screenshots to prepare (1280×800)

1. Home tab with stats and the four action buttons (side panel next to LinkedIn Jobs).
2. Jobs tab with a filtered list and status badges.
3. Inbox tab with recruiter outreach and tags.
4. Resume tab after a tailoring run: experience banner, skills added, bullet diff, gaps.
5. Settings page.

The dev harness (`python -m http.server 4321` → `/src/sidepanel.html`) renders every screen with sample data for clean screenshots.

## After submission

- Review status is shown on the dashboard; email arrives when it is published or if changes are requested.
- Common review feedback: permission justification wording (copy the text above), privacy policy link, "single purpose" description.
- Each later release: bump `version` in `manifest.json` and `package.json`, `npm run package`, upload the new zip, write the changelog entry.
