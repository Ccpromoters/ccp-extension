// ccp-log: the extension's write path for job status changes and application records
// (prepared / submitted / failed), plus a GET that returns the candidate's recent records.
import { createClient } from "npm:@insforge/sdk";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const client = createClient({ baseUrl: Deno.env.get("INSFORGE_BASE_URL")!, accessToken: token });
  const { data: u } = await client.auth.getCurrentUser();
  const user = u?.user;
  if (!user?.id) return json({ error: "Session expired. Sign in again." }, 401);

  if (req.method === "GET") {
    const [jobs, apps] = await Promise.all([
      client.database.from("jobs").select("id, company, title, location, url, apply_url, ats, status, score, years_required, found_at, applied_at").eq("candidate_id", user.id).order("found_at", { ascending: false }).limit(200),
      client.database.from("applications").select("id, job_id, job_url, company, title, ats, resume_file_name, status, submitted_at, created_at, notes").eq("candidate_id", user.id).order("created_at", { ascending: false }).limit(200),
    ]);
    return json({ jobs: jobs.data || [], applications: apps.data || [] });
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad JSON body" }, 400); }

  if (body.job_status && body.job_id) {
    const patch: any = { status: String(body.job_status) };
    if (body.job_status === "applied") patch.applied_at = new Date().toISOString();
    const { error } = await client.database.from("jobs").update(patch).eq("id", body.job_id).eq("candidate_id", user.id);
    if (error) return json({ error: error.message }, 500);
  }

  if (body.application) {
    const a = body.application;
    const rec: any = {
      candidate_id: user.id, job_id: a.job_id || null, job_url: a.job_url || "", company: a.company || "", title: a.title || "", ats: a.ats || "",
      resume_file_name: a.resume_file_name || "", answers: a.answers || {}, changes: a.changes || [], status: a.status || "prepared",
      submitted_at: a.status === "submitted" ? new Date().toISOString() : null, notes: a.notes || "",
    };
    let result;
    if (a.id) result = await client.database.from("applications").update(rec).eq("id", a.id).eq("candidate_id", user.id).select();
    else result = await client.database.from("applications").insert([rec]).select();
    if (result.error) return json({ error: result.error.message }, 500);
    return json({ application: result.data?.[0] || null });
  }
  return json({ ok: true });
}
