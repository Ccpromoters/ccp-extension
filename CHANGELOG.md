# Changelog

## 1.1.0 – 2026-10-13

CCP Cloud: the extension now works without any API key.

- Sign in with a CCP account (email + password) and an access code; the AI work (resume tailoring, form answers, job research, market research) runs on CCP's backend (InsForge edge functions + Claude). "My own API key" mode is still available in Settings.
- Setup wizard on first install: account → master resume (.docx or pasted text) → profile questions (contact, work authorization and sponsorship, EEO with "prefer not to answer" defaults, salary, availability, education, employment, rules) → Gmail scan.
- Find jobs: reads employers' own career-site feeds (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Workday) for the candidate's target titles and locations; "Add employers by name" discovers new feeds.
- Prepare & apply: tailors the resume for the job, opens the application page, reads the form, answers from the profile (unknown questions go to the AI with the profile as the only source of truth, or back to you), fills the fields and uploads the resume, then submits only when you press Submit. Multi-page forms: Next page / Scan this page.
- Every application is logged (job link, resume file, answers) in the cloud and in the Jobs tab.
- "Software the market asks for": per field and experience band, refreshed weekly from real postings.
- Engine: typed-glyph bullets and plain tool lists under skills headings are editable; skills are appended without touching the bold label run.
- Live-site readers fixed after testing on a real profile (Gmail thread ids, LinkedIn job tracker and job pages, Indeed job pages and my-jobs).

## 1.0.0 – 2026-10-12

First release.

- Open LinkedIn Jobs, Indeed, ZipRecruiter, Dice, Monster (optionally Glassdoor), Gmail and Chrome history in one click, or automatically when Chrome starts.
- Applications tracker fed by browser history, Gmail confirmations and the boards' own "applied" pages (LinkedIn, Indeed), with CSV export and a printable weekly report.
- Inbox view that sorts recruiter outreach, RTR requests, interview invitations, rejections and application confirmations, tagged by field.
- Resume tailoring: upload a master .docx once; per job, the extension adds the JD's missing skills to the existing skills rows and changes at most a couple of bullet points, keeping the document's layout and every other line identical. Reports gaps, items to confirm with the candidate and any experience-years gap instead of inventing anything.
- Skills-gap view across the job descriptions you viewed.
- No build step, no dependencies, no server. Node test suite for the document engine and classifiers.
