import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env";

// Credential encryption + cookie signing keys.
//
// Key material comes from APP_SECRET (env) when set; otherwise a random
// 32-byte secret is generated once and persisted at .data/secret.key (0600).
// Two independent keys are derived from it via scrypt with distinct salts so
// the encryption key and the cookie-signing key are never the same bytes.
//
// Ciphertext layout: [12-byte IV][16-byte GCM tag][ciphertext] (AES-256-GCM).

const DATA_DIR = path.join(process.cwd(), ".data");
const KEY_FILE = path.join(DATA_DIR, "secret.key");

let secretMaterial: Buffer | null = null;

function getSecretMaterial(): Buffer {
  if (secretMaterial) return secretMaterial;
  if (env.APP_SECRET) {
    if (Buffer.byteLength(env.APP_SECRET, "utf8") < 16) {
      throw new Error(
        "APP_SECRET must be at least 16 characters — it protects stored database credentials. " +
          "Generate one with: openssl rand -base64 32"
      );
    }
    secretMaterial = Buffer.from(env.APP_SECRET, "utf8");
    return secretMaterial;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    secretMaterial = fs.readFileSync(KEY_FILE);
  } catch {
    secretMaterial = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, secretMaterial, { mode: 0o600 });
  }
  return secretMaterial;
}

const derived = new Map<string, Buffer>();

function deriveKey(salt: string): Buffer {
  let key = derived.get(salt);
  if (!key) {
    key = crypto.scryptSync(getSecretMaterial(), salt, 32);
    derived.set(salt, key);
  }
  return key;
}

export function encryptString(plaintext: string): Buffer {
  const key = deriveKey("ptd:credentials:v1");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptString(blob: Buffer): string {
  const key = deriveKey("ptd:credentials:v1");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function signValue(value: string): string {
  const key = deriveKey("ptd:cookie:v1");
  return crypto.createHmac("sha256", key).update(value).digest("base64url");
}

export function verifySignedValue(value: string, signature: string): boolean {
  const expected = signValue(value);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
