// Шифрует снимок Coros ключом из PIN и кладет результат в public/coros.enc.json.
//
// Собирает latest + всю историю недель в один пакет, шифрует AES-256-GCM,
// ключ выводит из PIN через PBKDF2-HMAC-SHA256. Использует встроенный модуль
// node:crypto, установка зависимостей не нужна.
//
// Параметры KDF и шифра ниже, это единственный источник правды. Клиентский
// src/crypto.js обязан использовать ровно те же значения.
//
// Только зашифрованный файл попадает в публичный репозиторий и на Pages.
// Открытый data/ остается локально (в .gitignore). PIN из env COROS_PIN.
import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");
const OUT = join(ROOT, "public", "coros.enc.json");

// крипто-контракт, синхронизирован с src/crypto.js
const ITERATIONS = 200000;
const KEY_LEN = 32; // AES-256
const SALT_LEN = 16;
const IV_LEN = 12; // GCM nonce

const pin = process.env.COROS_PIN || "4832";

const latest = JSON.parse(readFileSync(join(DATA, "latest.json"), "utf-8"));
const history = [];
const histDir = join(DATA, "history");
if (existsSync(histDir)) {
  for (const f of readdirSync(histDir).filter((n) => /^week-.*\.json$/.test(n)).sort()) {
    history.push(JSON.parse(readFileSync(join(histDir, f), "utf-8")));
  }
}

const plaintext = Buffer.from(JSON.stringify({ latest, history }), "utf-8");
const salt = randomBytes(SALT_LEN);
const iv = randomBytes(IV_LEN);
const key = pbkdf2Sync(pin, salt, ITERATIONS, KEY_LEN, "sha256");

const cipher = createCipheriv("aes-256-gcm", key, iv);
const enc = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
// WebCrypto ждет ct||tag единым буфером
const ct = Buffer.concat([enc, tag]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify(
    {
      v: 1,
      kdf: "PBKDF2-HMAC-SHA256",
      iterations: ITERATIONS,
      cipher: "AES-256-GCM",
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      ct: ct.toString("base64"),
      generated_at: latest.generated_at,
    },
    null,
    2,
  ),
);

console.log(
  `OK: encrypted ${plaintext.length} bytes -> public/coros.enc.json (${history.length} history weeks)`,
);
