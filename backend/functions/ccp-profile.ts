// ccp-profile: read / upsert the signed-in candidate's memory. Unlocks AI features when the
// CCP access code is supplied (checked server-side against the CCP_ACCESS_CODE secret).
import { createClient, createAdminClient } from "npm:@insforge/sdk";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const PROFILE_FIELDS = [
  "full_name", "first_name", "last_name", "phone", "address_line", "city", "state", "zip", "country", "linkedin_url", "website_url",
  "field", "years_experience", "target_titles", "target_locations", "work_authorization", "needs_sponsorship_now", "needs_sponsorship_future",
  "veteran_status", "gender", "race_ethnicity", "disability_status", "desired_salary", "available_from", "willing_to_relocate",
  "has_drivers_license", "over_18", "education", "employment", "extra_answers", "rules", "blocked_terms",
];

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const base = Deno.env.get("INSFORGE_BASE_URL")!;
  const client = createClient({ baseUrl: base, accessToken: token });
  const { data: u } = await client.auth.getCurrentUser();
  const user = u?.user;
  if (!user?.id) return json({ error: "Session expired. Sign in again." }, 401);

  if (req.method === "GET") {
    const { data, error } = await client.database.from("candidates").select("*").eq("id", user.id).limit(1);
    if (error) return json({ error: error.message }, 500);
    return json({ profile: data?.[0] || null, user: { id: user.id, email: user.email } });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const patch: Record<string, unknown> = {};
  for (const k of PROFILE_FIELDS) if (body.profile && body.profile[k] !== undefined) patch[k] = body.profile[k];

  const { data: existing } = await client.database.from("candidates").select("id, access_ok").eq("id", user.id).limit(1);
  let error;
  if (existing?.length) {
    ({ error } = await client.database.from("candidates").update({ ...patch, email: user.email }).eq("id", user.id));
  } else {
    ({ error } = await client.database.from("candidates").insert([{ id: user.id, email: user.email, ...patch }]));
  }
  if (error) return json({ error: error.message }, 500);

  // Access code unlocks the AI features (set only by the admin client).
  let accessOk = existing?.[0]?.access_ok === true;
  const code = (body.accessCode || "").trim();
  const expected = (Deno.env.get("CCP_ACCESS_CODE") || "").trim();
  let accessMessage = "";
  if (code) {
    if (expected && code === expected) {
      const admin = createAdminClient({ baseUrl: base, apiKey: Deno.env.get("API_KEY")! });
      const r = await admin.database.from("candidates").update({ access_ok: true }).eq("id", user.id);
      if (r.error) return json({ error: r.error.message }, 500);
      accessOk = true;
      accessMessage = "Access code accepted.";
    } else {
      accessMessage = expected ? "Access code not recognised." : "No access code is configured on the server yet.";
    }
  }
  const { data } = await client.database.from("candidates").select("*").eq("id", user.id).limit(1);
  return json({ profile: data?.[0] || null, accessOk, accessMessage, user: { id: user.id, email: user.email } });
}
