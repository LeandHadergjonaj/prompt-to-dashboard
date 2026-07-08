import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { env } from "./env";
import {
  DashboardSpecSchema,
  RepairSqlSchema,
  type DashboardSpec,
  type PanelSpec,
} from "./types";

const FALLBACK_MODEL = "gpt-5.6-luna";
const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export class LlmError extends Error {
  readonly code = "llm_error" as const;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "LlmError";
  }
}

function isRetriableError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    return err.status === 429 || (err.status !== undefined && err.status >= 500);
  }
  return true; // network errors, aborts
}

async function callWithFallback<T>(fn: (model: string) => Promise<T>): Promise<T> {
  try {
    return await fn(env.OPENAI_MODEL);
  } catch (err) {
    if (!isRetriableError(err)) {
      throw new LlmError(
        `OpenAI call failed (non-retriable): ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }
    try {
      return await fn(FALLBACK_MODEL);
    } catch (fallbackErr) {
      throw new LlmError(
        `OpenAI call failed on primary and fallback model: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
        fallbackErr
      );
    }
  }
}

export interface GenerateDashboardParams {
  question: string;
  currentDate: string;   // 'YYYY-MM-DD'
  schemaContext: string; // contents of db/schema-context.md
}

export async function generateDashboardSpec(params: GenerateDashboardParams): Promise<DashboardSpec> {
  const systemPrompt = buildDashboardSystemPrompt(params);
  return callWithFallback(async (model) => {
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: params.question },
      ],
      reasoning: { effort: "medium" },
      text: { verbosity: "low", format: zodTextFormat(DashboardSpecSchema, "dashboard_spec") },
      max_output_tokens: 4000,
    });
    if (!response.output_parsed) throw new LlmError("model returned no parseable dashboard spec", response);
    return response.output_parsed;
  });
}

export interface RepairSqlParams {
  question: string;
  panel: PanelSpec;
  sql: string;
  errorMessage: string;
  schemaContext: string;
}

export async function repairSql(params: RepairSqlParams): Promise<string> {
  const systemPrompt = buildRepairSystemPrompt(params.schemaContext);
  const userPrompt = buildRepairUserPrompt(params);
  return callWithFallback(async (model) => {
    const response = await client.responses.parse({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      reasoning: { effort: "low" },
      text: { verbosity: "low", format: zodTextFormat(RepairSqlSchema, "sql_repair") },
      max_output_tokens: 600,
    });
    if (!response.output_parsed) throw new LlmError("model returned no parseable repair", response);
    return response.output_parsed.sql;
  });
}

// Prompt-cache note: schema context + current date live in the SYSTEM message;
// per-call content (question / failing SQL) in the USER message.

function buildDashboardSystemPrompt(params: {
  currentDate: string;
  schemaContext: string;
}): string {
  const { currentDate, schemaContext } = params;
  return `You are a senior data analyst embedded in a business intelligence tool for a UK commercial-property intelligence platform (PostgreSQL database). The data covers: distressed-company opportunity signals (opportunities, company_watchlist, enrichment_queue), HM Land Registry company-owned property titles (land_registry_ownership, ~2M rows), and VOA commercial property ratings (voa_properties, ~1.6M rows). Non-technical staff type plain-English questions and you turn each question into a small dashboard specification. You never talk to the user directly — you only produce a single structured JSON object that exactly matches the provided output schema. Do not include any prose, explanation, or markdown outside the JSON.

## Today's date
Today's date is ${currentDate} (YYYY-MM-DD). Each date column's actual coverage is listed in the schema context below — check it before applying a date filter, and skip the filter when it would exclude all data. When the user uses a relative time phrase:
- "last year" / "past year" / "trailing year" -> the 365 days ending today, i.e. WHERE payment_date >= (DATE '${currentDate}' - INTERVAL '1 year')
- "this year" / "year to date" / "YTD" -> WHERE payment_date >= date_trunc('year', DATE '${currentDate}')
- "last month" -> the calendar month immediately before the current calendar month
- "this month" -> the current calendar month to date
- "last quarter" -> the calendar quarter immediately before the current one
- "last N days/weeks/months" -> the trailing N days/weeks/months ending today
- If no time period is mentioned, do not add a date filter.
Always compute relative dates using the literal date '${currentDate}' in the SQL itself (e.g. DATE '${currentDate}' - INTERVAL '1 year') rather than CURRENT_DATE, so results are reproducible.

## Database schema
You may ONLY reference tables and columns that appear below. If a question cannot be answered exactly with this schema, do the closest reasonable thing with the data available rather than inventing columns or tables.

<schema>
${schemaContext}
</schema>

