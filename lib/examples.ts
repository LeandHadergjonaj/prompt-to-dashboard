import { getAppStore, newId } from "./appStore";
import { embedTexts, type FewShotExample } from "./openai";

// The accepted-query flywheel (vanna / Dataherald "golden SQL", DAIL-SQL):
// saving a dashboard persists its panels' (NL description -> SQL) pairs, and
// later questions against the same connection retrieve the most similar
// pairs as few-shot examples. Scoped by (user, connection) so one user's
// questions and SQL never inform another user's generations.

const MAX_EXAMPLES_PER_SCOPE = 200;
const RETRIEVE_TOP_K = 4;
const MIN_SIMILARITY = 0.3;

function toBlob(vector: number[]): Buffer {
  return Buffer.from(new Float32Array(vector).buffer);
}

function fromBlob(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Persist accepted (question -> SQL) pairs. Embedding failures degrade to
 * rows with a NULL embedding (excluded from retrieval, upgraded next save
 * if the same pair is saved again). Never throws for embedding reasons.
 */
export async function saveExamples(
  userId: string,
  connectionKey: string,
  pairs: FewShotExample[]
): Promise<void> {
  if (pairs.length === 0) return;

  let embeddings: (number[] | null)[];
  try {
    embeddings = await embedTexts(pairs.map((p) => p.question));
  } catch {
    embeddings = pairs.map(() => null);
  }

  const store = getAppStore();
  const insert = store.prepare(
    `INSERT INTO examples (id, user_id, connection_id, question, sql, embedding)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, connection_id, question, sql)
     DO UPDATE SET embedding = COALESCE(excluded.embedding, examples.embedding)`
  );
  const prune = store.prepare(
    `DELETE FROM examples WHERE user_id = ? AND connection_id = ? AND id NOT IN (
       SELECT id FROM examples WHERE user_id = ? AND connection_id = ?
       ORDER BY created_at DESC LIMIT ?
     )`
  );
  const tx = store.transaction(() => {
    pairs.forEach((pair, i) => {
      const vector = embeddings[i];
      insert.run(newId(), userId, connectionKey, pair.question, pair.sql, vector ? toBlob(vector) : null);
    });
    prune.run(userId, connectionKey, userId, connectionKey, MAX_EXAMPLES_PER_SCOPE);
  });
  tx();
}

/**
 * Retrieve the most similar accepted pairs for a new question. Returns []
 * whenever anything is missing or fails — retrieval must never block or
 * fail a generation request.
 */
export async function retrieveExamples(
  userId: string,
  connectionKey: string,
  question: string
): Promise<FewShotExample[]> {
  const rows = getAppStore()
    .prepare(
      `SELECT question, sql, embedding FROM examples
       WHERE user_id = ? AND connection_id = ? AND embedding IS NOT NULL`
    )
    .all(userId, connectionKey) as { question: string; sql: string; embedding: Buffer }[];
  if (rows.length === 0) return [];

  let queryVector: Float32Array;
  try {
    const [embedded] = await embedTexts([question]);
    queryVector = new Float32Array(embedded);
  } catch {
    return [];
  }

  return rows
    .map((row) => ({
      question: row.question,
      sql: row.sql,
      similarity: cosine(queryVector, fromBlob(row.embedding)),
    }))
    .filter((r) => r.similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, RETRIEVE_TOP_K)
    .map(({ question: q, sql }) => ({ question: q, sql }));
}
