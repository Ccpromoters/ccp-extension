// CCP Cloud client: the candidate signs in with email + password (InsForge auth) and the
// extension calls CCP's edge functions with that session. No AI key ever lives in the extension.

import { get, set } from "./storage.js";

export const CLOUD_DEFAULT_URL = "https://5im48ej9.us-east.insforge.app";

export class CloudError extends Error {
  constructor(message, extra = {}) {
    super(message);
    Object.assign(this, extra);
  }
}

async function state() {
  return get("cloud", {});
}

async function save(patch) {
  const cur = await state();
  const next = { ...cur, ...patch };
  await set({ cloud: next });
  return next;
}

export async function cloudUrl() {
  const s = await state();
  return (s.url || CLOUD_DEFAULT_URL).replace(/\/+$/, "");
}

async function authCall(path, body) {
  const url = `${await cloudUrl()}${path}`;
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok) throw new CloudError(data.error || data.message || `Sign-in failed (${res.status})`, { status: res.status });
  return data;
}

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function storeSession(data) {
  return save({
    accessToken: data.accessToken || "",
    refreshToken: data.refreshToken || "",
    expiresAt: data.accessToken ? tokenExpiry(data.accessToken) : 0,
    user: data.user ? { id: data.user.id, email: data.user.email, name: data.user.name } : null,
    requireEmailVerification: !!data.requireEmailVerification,
    signedInAt: Date.now(),
  });
}

export async function cloudSignUp(email, password, name) {
  const data = await authCall("/api/auth/users?client_type=desktop", { email, password, name });
  await storeSession(data);
  return data;
}

export async function cloudSignIn(email, password) {
  const data = await authCall("/api/auth/sessions?client_type=desktop", { method: "password", email, password });
  await storeSession(data);
  return data;
}

/** Email verification with the 6-digit code InsForge mails after sign-up. Returns a session when the server issues one. */
export async function cloudVerifyEmail(email, otp) {
  const data = await authCall("/api/auth/email/verify?client_type=desktop", { email, otp: String(otp).trim() });
  if (data.accessToken) await storeSession(data);
  return data;
}

export async function cloudResendCode(email) {
  return authCall("/api/auth/email/send-verification", { email });
}

export async function cloudSignOut() {
  const s = await state();
  try {
    if (s.accessToken) await fetch(`${await cloudUrl()}/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${s.accessToken}` } });
  } catch {}
  await set({ cloud: { url: s.url } });
}

async function refreshSession() {
  const s = await state();
  if (!s.refreshToken) throw new CloudError("Session expired. Sign in again in Settings.", { code: "signed_out" });
  const data = await authCall("/api/auth/refresh?client_type=desktop", { refreshToken: s.refreshToken });
  await storeSession({ ...data, user: data.user || s.user });
  return data.accessToken;
}

async function accessToken() {
  const s = await state();
  if (!s.accessToken) throw new CloudError("Not signed in to CCP Cloud. Open Settings to sign in.", { code: "signed_out" });
  if (s.expiresAt && s.expiresAt - Date.now() < 60_000) return refreshSession();
  return s.accessToken;
}

/** Call a CCP edge function. Retries once after refreshing an expired session. */
export async function invoke(slug, body = null, { method = "POST", query = "" } = {}) {
  const base = await cloudUrl();
  const call = async (token) => fetch(`${base}/functions/${slug}${query}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: method === "GET" ? undefined : JSON.stringify(body || {}),
  });
  let res = await call(await accessToken());
  if (res.status === 401) res = await call(await refreshSession());
  let data = {};
  try {
    data = await res.json();
  } catch {}
  if (!res.ok || data.error) throw new CloudError(data.error || `CCP Cloud error ${res.status}`, { status: res.status });
  return data;
}

export async function cloudStatus() {
  const s = await state();
  return { signedIn: !!s.accessToken, email: s.user?.email || "", user: s.user || null, accessOk: !!s.accessOk, profile: s.profile || null, lastSync: s.lastSync || 0, url: s.url || CLOUD_DEFAULT_URL };
}

/** Push the candidate's memory to the cloud (and unlock AI with the access code). */
export async function syncProfile(profile, accessCode = "") {
  const r = await invoke("ccp-profile", { profile, accessCode });
  await save({ profile: r.profile, accessOk: !!r.accessOk, lastSync: Date.now() });
  return r;
}

export async function fetchProfile() {
  const r = await invoke("ccp-profile", null, { method: "GET" });
  await save({ profile: r.profile, accessOk: !!r.profile?.access_ok, lastSync: Date.now() });
  return r.profile;
}

export async function setCloudUrl(url) {
  await save({ url: (url || "").trim() });
}
