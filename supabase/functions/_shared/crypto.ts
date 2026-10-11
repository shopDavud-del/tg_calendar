// Шифрование токенов Google (AES-256-GCM). Ключ — секрет TOKEN_KEY, в базе его нет.
import { env } from "./env.ts";
const enc = new TextEncoder(), dec = new TextDecoder();
async function key() {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(env("TOKEN_KEY")));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encrypt(text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64(out);
}
export async function decrypt(s: string) {
  const all = unb64(s);
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: all.slice(0, 12) }, await key(), all.slice(12)));
}
