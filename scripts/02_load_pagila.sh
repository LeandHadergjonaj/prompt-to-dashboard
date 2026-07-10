#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?export DATABASE_URL first}"

echo "Loading schema..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/vendor/pagila-schema.sql

echo "Loading base data..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/vendor/pagila-data.sql

psql "$DATABASE_URL" -c "
  SELECT 'customer' t, count(*) FROM customer
  UNION ALL SELECT 'inventory', count(*) FROM inventory
  UNION ALL SELECT 'rental', count(*) FROM rental
  UNION ALL SELECT 'payment', count(*) FROM payment
  UNION ALL SELECT 'film', count(*) FROM film;
"
