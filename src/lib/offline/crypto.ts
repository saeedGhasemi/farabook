// Per-record AES-GCM encryption for the web OfflineStore.
// On native, SQLCipher handles page-level encryption; we still derive a
// matching per-(user,book,device) key for any blobs that may travel outside
// the DB (assets cache, exported snapshots — currently none).
//
// Key derivation: HKDF-SHA256 over (device_salt || server_pepper || user_id || book_id).
// `device_salt` is generated client-side, persisted in Keychain/IndexedDB,
// never sent to the server. `server_pepper` comes from issue-book-key and is
// bound to (user, book, device). Result: the encrypted DB cannot be opened
// on another device, even if both files and the user's password are copied.

import { getDeviceId } from "./deviceId";
import { supabase } from "@/integrations/supabase/client";

const DEVICE_SALT_META_KEY = "farabook.device_salt";
const SUBTLE = globalThis.crypto?.subtle;

function b64(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function ensureDeviceSalt(): Promise<Uint8Array> {
  const existing = localStorage.getItem(DEVICE_SALT_META_KEY);
  if (existing) return fromB64(existing);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(DEVICE_SALT_META_KEY, b64(salt));
  return salt;
}

/** Fetch (or refresh) a server pepper for (user, book, device) via Edge Function. */
export async function fetchBookPepper(bookId: string): Promise<string> {
  const deviceId = await getDeviceId();
  const { data, error } = await supabase.functions.invoke("issue-book-key", {
    body: {
      book_id: bookId,
      device_id: deviceId,
      device_label: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null,
      platform: "web",
    },
  });
  if (error) throw error;
  const pepper = (data as { pepper?: string } | null)?.pepper;
  if (!pepper) throw new Error("no_pepper");
  return pepper;
}

const keyCache = new Map<string, CryptoKey>();

export async function deriveBookKey(userId: string, bookId: string, pepper: string): Promise<CryptoKey> {
  const cacheKey = `${userId}:${bookId}`;
  const hit = keyCache.get(cacheKey);
  if (hit) return hit;
  if (!SUBTLE) throw new Error("WebCrypto unavailable");

  const salt = await ensureDeviceSalt();
  const enc = new TextEncoder();
  const ikm = new Uint8Array(salt.length + pepper.length + userId.length + bookId.length);
  ikm.set(salt, 0);
  ikm.set(enc.encode(pepper), salt.length);
  ikm.set(enc.encode(userId), salt.length + pepper.length);
  ikm.set(enc.encode(bookId), salt.length + pepper.length + userId.length);

  const baseKey = await SUBTLE.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  const key = await SUBTLE.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: enc.encode(`farabook/v1/${bookId}`),
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  keyCache.set(cacheKey, key);
  return key;
}

export function invalidateBookKey(userId: string, bookId: string) {
  keyCache.delete(`${userId}:${bookId}`);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<{ data: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await SUBTLE.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource);
  return { data: new Uint8Array(cipher), iv };
}

export async function decryptJson<T>(key: CryptoKey, data: Uint8Array, iv: Uint8Array): Promise<T> {
  const plain = await SUBTLE.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export async function encryptBytes(key: CryptoKey, bytes: Uint8Array): Promise<{ data: Uint8Array; iv: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await SUBTLE.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, bytes as BufferSource);
  return { data: new Uint8Array(cipher), iv };
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array, iv: Uint8Array): Promise<Uint8Array> {
  const plain = await SUBTLE.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource);
  return new Uint8Array(plain);
}

