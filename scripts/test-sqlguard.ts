// Run: npx tsx scripts/test-sqlguard.ts
import { checkSql } from "../lib/sqlGuard";

const cases: { name: string; input: string; expectOk: boolean; expectReason?: string }[] = [
  {
    name: "1 simple aggregate",
    input: "SELECT region_id, SUM(amount) AS total_revenue FROM orders GROUP BY region_id",
    expectOk: true,
  },
  {
    name: "2 comment + CTE + trailing semicolon",
    input:
      "-- monthly revenue\nWITH monthly AS (\n  SELECT date_trunc('month', order_date) AS month, amount FROM orders\n)\nSELECT month, SUM(amount) AS total_revenue FROM monthly GROUP BY month ORDER BY month;",
    expectOk: true,
  },
  {
    name: "3 updated_at no false positive",
    input: "SELECT customer_id, updated_at FROM customer",
    expectOk: true,
  },
  {
    name: "4 'Dropdown' no false positive",
    input: "SELECT product_name FROM products WHERE product_name = 'Dropdown menu item'",
    expectOk: true,
  },
  {
    name: "5 multiple statements",
    input: "SELECT * FROM orders; DROP TABLE orders;",
    expectOk: false,
    expectReason: "multiple SQL statements are not allowed",
  },
  {
    name: "6 DELETE",
    input: "DELETE FROM orders WHERE order_id = 1",
    expectOk: false,
    expectReason: "query must start with SELECT or WITH",
  },
  {
    name: "7 SELECT INTO",
    input: "SELECT * INTO backup_orders FROM orders",
    expectOk: false,
    expectReason: "forbidden keyword: INTO",
  },
  {
    name: "8 'Drop zone A' documented accepted false positive",
    input: "SELECT product_name FROM products WHERE product_name = 'Drop zone A'",
    expectOk: false,
    expectReason: "forbidden keyword: DROP",
  },
];

let failures = 0;
for (const c of cases) {
  const r = checkSql(c.input);
  const okMatch = r.ok === c.expectOk;
  const reasonMatch = c.expectReason === undefined || r.reason === c.expectReason;
  if (okMatch && reasonMatch) {
    console.log(`PASS ${c.name}`);
  } else {
    failures++;
    console.error(`FAIL ${c.name}: got ok=${r.ok} reason=${JSON.stringify(r.reason)}`);
  }
}

// Case 2 must also come back sanitized: comment stripped, no trailing semicolon.
const c2 = checkSql(cases[1].input);
if (
  c2.ok &&
  c2.sanitizedSql !== null &&
  !c2.sanitizedSql.includes("--") &&
  !c2.sanitizedSql.trimEnd().endsWith(";")
) {
  console.log("PASS 2b sanitizedSql stripped comment and semicolon");
} else {
  failures++;
  console.error("FAIL 2b sanitizedSql:", JSON.stringify(c2));
}

process.exit(failures ? 1 : 0);
