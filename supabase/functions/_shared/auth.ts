const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function hmac(key: BufferSource, data: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
function same(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Проверка подписи Telegram Mini App (initData). Возвращает пользователя или null. */
export async function verifyInitData(initData: string, botToken: string, maxAgeSec = 86400) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  const sig = hex(await hmac(secret, dcs));
  if (!same(sig, hash)) return null;
  const age = Date.now() / 1000 - Number(params.get("auth_date") ?? 0);
  if (!(age >= -60 && age < maxAgeSec)) return null;
  try { return JSON.parse(params.get("user") ?? "null") as { id: number; first_name?: string; language_code?: string } | null; }
  catch { return null; }
}

/** Подписанное состояние для OAuth (защита от подмены). */
export async function signState(uid: number, secret: string, ttlSec = 600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = hex(await hmac(enc.encode(secret), `${uid}.${exp}`));
  return `${uid}.${exp}.${sig}`;
}
export async function checkState(state: string, secret: string) {
  const [uid, exp, sig] = state.split(".");
  if (!uid || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  const good = hex(await hmac(enc.encode(secret), `${uid}.${exp}`));
  return same(good, sig) ? Number(uid) : null;
}
