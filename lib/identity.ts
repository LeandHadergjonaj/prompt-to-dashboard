import { cookies } from "next/headers";
import { getAppStore, newId } from "./appStore";
import { signValue, verifySignedValue } from "./secrets";

// Anonymous per-browser identity: an httpOnly cookie holding
// "<uuid>.<hmac>", verified against the app secret. Every API route scopes
// its data by this id. Swapping in real auth later only changes this module.

const COOKIE_NAME = "ptd_uid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 730; // 2 years

export async function getCurrentUserId(): Promise<string> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (raw) {
    const dot = raw.lastIndexOf(".");
    if (dot > 0) {
      const id = raw.slice(0, dot);
      const sig = raw.slice(dot + 1);
      if (verifySignedValue(id, sig)) {
        // The cookie can outlive the store (e.g. a wiped .data dir).
        getAppStore().prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").run(id);
        return id;
      }
    }
  }

  const id = newId();
  getAppStore().prepare("INSERT INTO users (id) VALUES (?)").run(id);
  store.set(COOKIE_NAME, `${id}.${signValue(id)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return id;
}
