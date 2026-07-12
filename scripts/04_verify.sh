#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?export DATABASE_URL first}"
: "${DATABASE_URL_READONLY:?export DATABASE_URL_READONLY first}"

echo "== Database size (must be > 1 GB) =="
psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size(current_database()));"

echo "== Row counts =="
psql "$DATABASE_URL" -c "
  SELECT 'customer'  t, count(*) FROM customer
  UNION ALL SELECT 'inventory', count(*) FROM inventory
  UNION ALL SELECT 'rental',    count(*) FROM rental
  UNION ALL SELECT 'payment',   count(*) FROM payment
  UNION ALL SELECT 'film',      count(*) FROM film
  ORDER BY 1;
"

echo "== Date ranges =="
psql "$DATABASE_URL" -c "SELECT min(rental_date), max(rental_date) FROM rental;"
psql "$DATABASE_URL" -c "SELECT min(payment_date), max(payment_date) FROM payment;"

fail=0
check_fails() {
  local label="$1"
  local sql="$2"
  # "permission denied" (DML/CREATE), "must be owner" (DROP), "read-only transaction" all count as correctly blocked
  if psql "$DATABASE_URL_READONLY" -c "$sql" 2>&1 | grep -qiE "permission denied|must be owner|read-only transaction"; then
    echo "PASS: $label correctly rejected"
  else
    echo "FAIL: $label was NOT rejected"
    fail=1
  fi
}

echo "== dashboard_reader negative checks (each MUST fail) =="
check_fails "INSERT"       "INSERT INTO customer (store_id, first_name, last_name, address_id) VALUES (1,'x','y',1);"
check_fails "UPDATE"       "UPDATE customer SET first_name = 'x' WHERE customer_id = 1;"
check_fails "DELETE"       "DELETE FROM customer WHERE customer_id = 1;"
check_fails "CREATE TABLE" "CREATE TABLE t_should_fail (id int);"
check_fails "DROP TABLE"   "DROP TABLE film;"

echo "== dashboard_reader positive check (MUST succeed) =="
psql "$DATABASE_URL_READONLY" -c "SELECT count(*) FROM film;"

exit $fail
