// Run: npx tsx scripts/test-sqlguard.ts
// Covers the AST guard (primary) and pins the legacy keyword guard's
// behavior (fallback path when the WASM parser cannot load).
import { checkSql, checkSqlKeyword, wrapForExecution, type SqlCatalog } from "../lib/sqlGuard";

const CATALOG: SqlCatalog = {
  tables: {
    orders: ["order_id", "region_id", "amount", "order_date", "updated_at"],
    products: ["product_id", "product_name"],
    customer: ["customer_id", "updated_at"],
    Invoice: ["CustomerId", "Total"],
    Customer: ["CustomerId", "FirstName", "LastName"],
    AuditLog: ["Update"],
  },
};

interface Case {
  name: string;
  input: string;
  expectOk: boolean;
  /** substring match on the rejection reason */
  expectReason?: string;
  catalog?: SqlCatalog | null;
}

const cases: Case[] = [
  // ---- valid queries the old guard also accepted ----
  {
    name: "simple aggregate",
    input: "SELECT region_id, SUM(amount) AS total_revenue FROM orders GROUP BY region_id",
    expectOk: true,
  },
  {
    name: "comment + CTE + trailing semicolon",
    input:
      "-- monthly revenue\nWITH monthly AS (\n  SELECT date_trunc('month', order_date) AS month, amount FROM orders\n)\nSELECT month, SUM(amount) AS total_revenue FROM monthly GROUP BY month ORDER BY month;",
    expectOk: true,
  },
  {
    name: "updated_at no false positive",
    input: "SELECT customer_id, updated_at FROM customer",
    expectOk: true,
  },
  {
    name: "quoted CamelCase identifiers pass",
    input:
      'SELECT c."FirstName" || \' \' || c."LastName" AS customer_name, SUM(i."Total") AS total_spent FROM "Invoice" AS i JOIN "Customer" AS c ON c."CustomerId" = i."CustomerId" GROUP BY c."CustomerId", c."FirstName", c."LastName" ORDER BY total_spent DESC LIMIT 5',
    expectOk: true,
  },
  // ---- old-guard false positives the AST guard now accepts ----
  {
    name: "keyword inside string literal now passes ('Drop zone A')",
    input: "SELECT product_name FROM products WHERE product_name = 'Drop zone A'",
    expectOk: true,
  },
  {
    name: "quoted identifier colliding with keyword now passes",
    input: 'SELECT "Update" FROM "AuditLog"',
    expectOk: true,
  },
  {
    name: "semicolon inside string literal now passes",
    input: "SELECT product_name FROM products WHERE product_name = 'a;b'",
    expectOk: true,
  },
  // ---- rejections: everything the denylist caught, now structural ----
  {
    name: "multiple statements",
    input: "SELECT * FROM orders; DROP TABLE orders;",
    expectOk: false,
    expectReason: "multiple SQL statements",
  },
  {
    name: "DELETE",
    input: "DELETE FROM orders WHERE order_id = 1",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  {
    name: "INSERT",
    input: "INSERT INTO orders (order_id) VALUES (1)",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  {
    name: "SET",
    input: "SET statement_timeout = 0",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  {
    name: "BEGIN",
    input: "BEGIN",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  {
    name: "COPY",
    input: "COPY orders TO '/tmp/x'",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  {
    name: "SELECT INTO",
    input: "SELECT * INTO backup_orders FROM orders",
    expectOk: false,
    expectReason: "SELECT ... INTO",
  },
  {
    name: "CREATE TABLE AS",
    input: "CREATE TABLE t AS SELECT 1",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  // ---- rejections the old guard could NOT catch ----
  {
    name: "data-modifying CTE",
    input: "WITH x AS (DELETE FROM orders RETURNING order_id) SELECT order_id FROM x",
    expectOk: false,
    expectReason: "forbidden statement type",
  },
  {
    name: "FOR UPDATE locking",
    input: "SELECT order_id FROM orders FOR UPDATE",
    expectOk: false,
    expectReason: "row locking",
  },
  {
    name: "pg_sleep",
    input: "SELECT pg_sleep(10)",
    expectOk: false,
    expectReason: "forbidden function: pg_sleep",
  },
  {
    name: "schema-qualified forbidden function",
    input: "SELECT pg_catalog.pg_read_file('/etc/passwd')",
    expectOk: false,
    expectReason: "forbidden function: pg_read_file",
  },
  {
    name: "dblink prefix",
    input: "SELECT * FROM dblink_connect('x')",
    expectOk: false,
    expectReason: "forbidden function: dblink_connect",
  },
  {
    name: "advisory lock",
    input: "SELECT pg_advisory_lock(1)",
    expectOk: false,
    expectReason: "forbidden function: pg_advisory_lock",
  },
  {
    name: "query_to_xml smuggling",
    input: "SELECT query_to_xml('select * from secrets', true, true, '')",
    expectOk: false,
    expectReason: "forbidden function: query_to_xml",
  },
  {
    name: "database_to_xml catalog dump",
    input: "SELECT database_to_xml(true, true, '')",
    expectOk: false,
    expectReason: "forbidden function: database_to_xml",
  },
  {
    name: "lo_import file read",
    input: "SELECT lo_import('/etc/passwd')",
    expectOk: false,
    expectReason: "forbidden function: lo_import",
  },
  {
    name: "lo_export file write",
    input: "SELECT lo_export(1234, '/tmp/out')",
    expectOk: false,
    expectReason: "forbidden function: lo_export",
  },
  {
    name: "set_config settings change",
    input: "SELECT set_config('statement_timeout', '0', false)",
    expectOk: false,
    expectReason: "forbidden function: set_config",
  },
  {
    name: "pg_terminate_backend signal",
    input: "SELECT pg_terminate_backend(12345)",
    expectOk: false,
    expectReason: "forbidden function: pg_terminate_backend",
  },
  {
    name: "FOR SHARE locking",
    input: "SELECT order_id FROM orders FOR SHARE",
    expectOk: false,
    expectReason: "row locking",
  },
  {
    name: "not valid SQL",
    input: "SELECTT 1",
    expectOk: false,
    expectReason: "not valid PostgreSQL",
  },
  // ---- identifier binding (needs catalog) ----
  {
    name: "binding: known tables pass",
    input: "SELECT o.amount FROM orders o JOIN customer c ON c.customer_id = o.order_id",
    expectOk: true,
    catalog: CATALOG,
  },
  {
    name: "binding: CTE name is not an unknown table",
    input: "WITH t AS (SELECT amount FROM orders) SELECT amount FROM t",
    expectOk: true,
    catalog: CATALOG,
  },
  {
    name: "binding: hallucinated table rejected",
    input: "SELECT revenue FROM monthly_revenue_summary",
    expectOk: false,
    expectReason: "unknown table",
    catalog: CATALOG,
  },
  {
    name: "binding: pg_catalog blocked",
    input: "SELECT usename FROM pg_catalog.pg_user",
    expectOk: false,
    expectReason: "only the public schema",
    catalog: CATALOG,
  },
  {
    name: "binding: bare pg_user blocked (not in catalog)",
    input: "SELECT usename FROM pg_user",
    expectOk: false,
    expectReason: "unknown table",
    catalog: CATALOG,
  },
  {
    name: "binding: information_schema blocked",
    input: "SELECT table_name FROM information_schema.tables",
    expectOk: false,
    expectReason: "only the public schema",
    catalog: CATALOG,
  },
  {
    name: "binding: case-sensitive — unquoted invoice does not match Invoice",
    input: "SELECT i.total FROM invoice i",
    expectOk: false,
    expectReason: "unknown table",
    catalog: CATALOG,
  },
  {
    name: "binding: explicit public schema on known table passes",
    input: "SELECT amount FROM public.orders",
    expectOk: true,
    catalog: CATALOG,
  },
  // ---- cost guard (A.3): EXPLAIN is issued only by our own code — a model
  // emitting it must be rejected as a distinct statement type ----
  {
    name: "EXPLAIN rejected",
    input: "EXPLAIN SELECT amount FROM orders",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  {
    name: "EXPLAIN ANALYZE rejected",
    input: "EXPLAIN (ANALYZE) SELECT amount FROM orders",
    expectOk: false,
    expectReason: "only SELECT queries are allowed",
  },
  // ---- multi-source dashboards (Phase B): SQL bound against source A's
  // catalog must not reach tables that only exist in source B ----
  {
    name: "cross-source: table from another source rejected as unknown",
    input: "SELECT s.signup_date FROM signups s JOIN orders o ON o.order_id = s.id",
    expectOk: false,
    expectReason: 'unknown table: "signups"',
    catalog: CATALOG, // CATALOG is source A; signups lives only in source B
  },
];

async function main() {
  let failures = 0;

  for (const c of cases) {
    const r = await checkSql(c.input, c.catalog ?? null);
    const okMatch = r.ok === c.expectOk;
    const reasonMatch =
      c.expectReason === undefined || (r.reason !== null && r.reason.includes(c.expectReason));
    if (okMatch && reasonMatch) {
      console.log(`PASS ${c.name}`);
    } else {
      failures++;
      console.error(`FAIL ${c.name}: got ok=${r.ok} reason=${JSON.stringify(r.reason)}`);
    }
  }

  // Sanitization: trailing semicolon stripped so the execution wrap stays valid.
  const c2 = await checkSql("SELECT amount FROM orders;");
  if (c2.ok && c2.sanitizedSql !== null && !c2.sanitizedSql.trimEnd().endsWith(";")) {
    console.log("PASS sanitizedSql strips trailing semicolon");
  } else {
    failures++;
    console.error("FAIL sanitizedSql:", JSON.stringify(c2));
  }

  // Row-cap wrap: default and per-connection values fetch cap+1 rows so the
  // executor can distinguish "exactly cap" from "truncated".
  if (wrapForExecution("SELECT 1").includes("LIMIT 5001") && wrapForExecution("SELECT 1", 200).includes("LIMIT 201")) {
    console.log("PASS wrapForExecution applies the row cap");
  } else {
    failures++;
    console.error("FAIL wrapForExecution row cap");
  }

  // Legacy fallback guard still behaves as before (spot checks).
  const legacyChecks: Array<[string, boolean]> = [
    ["SELECT region_id FROM orders", true],
    ["DELETE FROM orders", false],
    ["SELECT * FROM orders; DROP TABLE orders;", false],
    ["SELECT * INTO b FROM orders", false],
  ];
  for (const [sql, expectOk] of legacyChecks) {
    const r = checkSqlKeyword(sql);
    if (r.ok === expectOk) {
      console.log(`PASS legacy: ${sql.slice(0, 40)}`);
    } else {
      failures++;
      console.error(`FAIL legacy: ${sql} got ok=${r.ok}`);
    }
  }

  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
