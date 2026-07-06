// Run: npx tsx scripts/test-sqlguard.ts
import { checkSql } from "../lib/sqlGuard";

const cases: { name: string; input: string; expectOk: boolean; expectReason?: string }[] = [
  {
    name: "1 simple aggregate",
    input: "SELECT store_id, SUM(amount) AS total_revenue FROM payment GROUP BY store_id",
    expectOk: true,
  },
  {
    name: "2 comment + CTE + trailing semicolon",
    input:
      "-- monthly revenue\nWITH monthly AS (\n  SELECT date_trunc('month', payment_date) AS month, amount FROM payment\n)\nSELECT month, SUM(amount) AS total_revenue FROM monthly GROUP BY month ORDER BY month;",
    expectOk: true,
  },
  {
    name: "3 updated_at no false positive",
    input: "SELECT customer_id, updated_at FROM customer",
    expectOk: true,
  },
  {
    name: "4 Dropbox no false positive",
    input: "SELECT title FROM film WHERE title = 'Dropbox Promo Night'",
    expectOk: true,
  },
  {
    name: "5 multiple statements",
    input: "SELECT * FROM payment; DROP TABLE payment;",
    expectOk: false,
    expectReason: "multiple SQL statements are not allowed",
  },
  {
    name: "6 DELETE",
    input: "DELETE FROM payment WHERE payment_id = 1",
    expectOk: false,
    expectReason: "query must start with SELECT or WITH",
  },
  {
    name: "7 SELECT INTO",
    input: "SELECT * INTO backup_payment FROM payment",
