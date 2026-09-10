// Расшифровка снимка Coros в браузере по PIN.
// Параметры KDF и шифра синхронизированы с scripts/encrypt_data.mjs.

const ITERATIONS = 200000;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveKey(pin, salt) {
  const base = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
}

// Возвращает распакованный объект {latest, history} или бросает при неверном PIN.
export async function decryptBundle(enc, pin) {
  const salt = b64ToBytes(enc.salt);
  const iv = b64ToBytes(enc.iv);
  const ct = b64ToBytes(enc.ct);
  const key = await deriveKey(pin, salt);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(plain));
}
