interface Env {
  /** Optional legacy "built-in" connection; the app also runs with none and
   *  only user-onboarded connections. */
  DATABASE_URL_READONLY: string | null;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
  /** Optional key material for credential encryption + cookie signing;
   *  when unset, a key is generated and persisted under .data/. */
  APP_SECRET: string | null;
}

const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

function readEnv(): Env {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

  if (!OPENAI_API_KEY) {
    throw new Error(
      [
        "",
        "=".repeat(72),
        "Missing required environment variable: OPENAI_API_KEY",
        "",
        "Set it in .env.local (development), then restart the server.",
        "  Create one at https://platform.openai.com/api-keys",
        "  (requires an OpenAI account with billing enabled).",
        "=".repeat(72),
        "",
      ].join("\n")
    );
  }

  return {
    DATABASE_URL_READONLY: process.env.DATABASE_URL_READONLY?.trim() || null,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    APP_SECRET: process.env.APP_SECRET?.trim() || null,
  };
}

export const env = readEnv();
