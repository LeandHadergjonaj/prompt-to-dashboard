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

