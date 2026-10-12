# CCP Extension – Privacy Policy

_Last updated: 12 October 2026_

CCP Extension is a Chrome extension for job seekers and the career-support teams who help them. This policy explains what the extension reads, where that data goes, and what it never does.

## In one sentence

Everything the extension collects stays inside your Chrome profile; the only data that ever leaves your browser is the resume text and job description you choose to send to the AI provider you configured with your own API key.

## What the extension reads

| Data | Why | Where it is stored |
| --- | --- | --- |
| Browser history entries for LinkedIn, Indeed, ZipRecruiter, Dice, Monster and Glassdoor job pages | To list the jobs you viewed and applied to | `chrome.storage.local` in your profile |
| Gmail thread list rows (sender, subject, snippet, date) for the searches the extension runs | To recognise application confirmations, recruiter outreach, interview requests and rejections | `chrome.storage.local` in your profile |
| Job postings you open on the supported boards (title, company, description) | To build the "skills gap" view and to tailor your resume | `chrome.storage.local` in your profile |
| The master resume (.docx) you upload in Settings | To create a tailored copy per job | `chrome.storage.local` in your profile |
| Your settings, including the AI API key you enter | To run the features you turned on | `chrome.storage.local` in your profile |

The extension never opens or reads the body of an email. It reads only what Gmail shows in the thread list.

## What leaves your browser

- **Resume tailoring only.** When you click "Tailor resume", the text of the selected master resume and the job description are sent to the AI provider you configured (Anthropic by default, or an OpenAI-compatible endpoint you choose), using your own API key. By default the candidate's phone number and email address are replaced with placeholders before sending. That provider's privacy terms apply to that request.
- Nothing else is transmitted. The extension has no server of its own, no analytics, no telemetry, no crash reporting and no advertising.

## What the extension never does

- It never sells, shares or uploads your data to the extension's authors or to anyone else.
- It never applies to jobs, sends messages, or changes anything on LinkedIn, Indeed, Gmail or any other site on your behalf.
- It never changes your master resume file; tailored copies are new files saved to your Downloads folder.
- It never invents employers, dates, years of experience or certifications in a resume. Edits are limited to wording in the summary, bullet points and skills rows, and the extension reports every change it made.

## Your control

- Remove the extension and all its data is deleted with it (Chrome removes `chrome.storage.local` for uninstalled extensions).
- Settings → Backup lets you export or import your settings and resumes as a JSON file you control.
- The source code is public: https://github.com/Ccpromoters/ccp-extension

## Using the extension on someone else's accounts

Career-support teams may run the extension inside a Chrome profile that belongs to a candidate they represent. Do this only with that person's knowledge and consent, and treat the data as theirs.

## Contact

Questions about this policy: open an issue at https://github.com/Ccpromoters/ccp-extension/issues or email hr@ccpromoters.com.
