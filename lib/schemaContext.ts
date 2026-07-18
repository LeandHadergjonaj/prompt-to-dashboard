import fs from "node:fs";
import path from "node:path";

export class SchemaContextMissingError extends Error {
  constructor() {
    super(
      "No schema context found at db/schema-context.md. Run `npm run introspect` " +
        "with a database connection string to generate it."
    );
    this.name = "SchemaContextMissingError";
  }
}

let cached: string | null = null;

// Lazy (not module-level) so the app builds and boots without a generated
// schema context; routes surface SchemaContextMissingError as a friendly error.
export function getSchemaContext(): string {
  if (cached !== null) return cached;
  try {
    cached = fs.readFileSync(path.join(process.cwd(), "db", "schema-context.md"), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new SchemaContextMissingError();
    }
    throw err;
  }
  return cached;
}
