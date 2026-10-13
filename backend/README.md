# CCP Cloud (backend)

The extension's "brain" and memory live in an InsForge project so candidates never need an API key.
Everything here is deployed with the InsForge CLI (`npx -y @insforge/cli`), linked from this folder
(`backend/.insforge/project.json` is git-ignored).

```
migrations/   schema + RLS (candidates, resumes, jobs, applications, companies, market_skills, question_bank, ai_calls)
functions/    edge functions (Deno): ccp-profile, ccp-tailor, ccp-answer, ccp-research-jobs, ccp-log, ccp-market
```

## Deploy

```bash
cd backend
npx -y @insforge/cli db migrations up --all
for f in ccp-profile ccp-tailor ccp-answer ccp-research-jobs ccp-log ccp-market; do
  npx -y @insforge/cli functions deploy $f --file functions/$f.ts --name "$f"
done
```

## Secrets (set once by the CCP admin, never in the extension)

| Secret | Purpose |
| --- | --- |
| `ANTHROPIC_API_KEY` | CCP's Claude key used by `ccp-tailor`, `ccp-answer`, `ccp-market` |
| `CCP_MODEL` | optional, default `claude-opus-5-5` (`claude-sonnet-5-5` is cheaper) |
| `CCP_ANSWER_MODEL` | optional model for form answers |
| `CCP_ACCESS_CODE` | the code candidates type in Settings to unlock AI (gates cost) |
| `CCP_CRON_SECRET` | header value the weekly market-research schedule sends |

```bash
npx -y @insforge/cli secrets add ANTHROPIC_API_KEY sk-ant-...
npx -y @insforge/cli secrets add CCP_ACCESS_CODE "choose-a-code"
npx -y @insforge/cli secrets add CCP_CRON_SECRET "long-random-string"
```

Weekly market research (software in demand per field / experience band):

```bash
npx -y @insforge/cli schedules create --name "CCP market research" --cron "0 6 * * 1" \
  --url "https://5im48ej9.us-east.insforge.app/functions/ccp-market" --method POST \
  --headers '{"X-CCP-Secret": "${{secrets.CCP_CRON_SECRET}}", "Content-Type": "application/json"}' --body '{}'
```

## API (all need `Authorization: Bearer <candidate access token>`)

| Function | Method | Body | Returns |
| --- | --- | --- | --- |
| `ccp-profile` | GET / POST | `{ profile, accessCode? }` | `{ profile, accessOk, accessMessage }` |
| `ccp-tailor` | POST | `{ blocks, jd, job, limits, rules, effort }` | `{ plan, usage, model }` – the extension applies the plan to the .docx locally |
| `ccp-answer` | POST | `{ questions:[{id,label,type,options,required}], job }` | `{ answers:[{id, answer, source, needs_candidate, note}] }` |
| `ccp-research-jobs` | POST | `{ titles?, locations?, field?, limit?, companies?, discover? }` | `{ matched, added, jobs }` |
| `ccp-log` | GET / POST | `{ job_id, job_status }` or `{ application }` | records |
| `ccp-market` | GET `?field=&years=` / POST | `{ field? }` | `{ rows }` / `{ report }` |

Auth is InsForge's: `POST /api/auth/users?client_type=desktop` (sign up), `POST /api/auth/sessions?client_type=desktop` (sign in), `POST /api/auth/refresh?client_type=desktop`.

## Data rules

- Every candidate row is owned by `auth.uid()`; RLS blocks everything else. `access_ok` and `plan` can only be set by the functions.
- EEO answers default to "decline"; sponsorship questions come back as *needs_candidate* unless the profile has a clear yes/no.
- The master resume file stays in the browser; only its text blocks are sent for tailoring.
