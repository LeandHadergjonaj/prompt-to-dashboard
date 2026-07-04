interface Env {
  DATABASE_URL_READONLY: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
}

const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";

const HELP_TEXT: Record<string, string> = {
  DATABASE_URL_READONLY:
    "Supabase dashboard -> Project Settings -> Database -> Connection string -> " +
    "Session pooler. Use the credentials for the read-only `dashboard_reader` " +
    "role (NOT the default postgres role). Format: " +
    "postgresql://dashboard_reader.<project-ref>:<password>@<pooler-host>:5432/postgres",
  OPENAI_API_KEY:
    "Create one at https://platform.openai.com/api-keys " +
    "(requires an OpenAI account with billing enabled).",
};

function readEnv(): Env {
  const DATABASE_URL_READONLY = process.env.DATABASE_URL_READONLY;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;

  const missing: string[] = [];
  if (!DATABASE_URL_READONLY) missing.push("DATABASE_URL_READONLY");
  if (!OPENAI_API_KEY) missing.push("OPENAI_API_KEY");

  if (missing.length > 0) {
    const lines = [
      "",
      "=".repeat(72),
      `Missing required environment variable(s): ${missing.join(", ")}`,
      "",
      "Set these in .env.local (development), then restart the server.",
      "",
      ...missing.flatMap((name) => [`  ${name}`, `    ${HELP_TEXT[name]}`, ""]),
      "=".repeat(72),
      "",
    ];
    throw new Error(lines.join("\n"));
  }

  return {
    DATABASE_URL_READONLY: DATABASE_URL_READONLY!,
    OPENAI_API_KEY: OPENAI_API_KEY!,
    OPENAI_MODEL,
  };
}

export const env = readEnv();
