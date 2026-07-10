#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?export DATABASE_URL first}"

BATCH_SIZE=1000000
NUM_BATCHES=15
START_TS="2022-01-01 00:00:00+00"
END_TS="2026-07-18 23:59:59+00"

for ((i=0; i<NUM_BATCHES; i++)); do
  lo=$(( i * BATCH_SIZE + 1 ))
  hi=$(( (i + 1) * BATCH_SIZE ))
  echo "== Batch $((i+1))/$NUM_BATCHES =="

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
    SET statement_timeout = 0;
    SET work_mem = '64MB';

    WITH bounds AS (
      SELECT
        (SELECT max(customer_id)  FROM customer)  AS max_customer,
        (SELECT max(inventory_id) FROM inventory) AS max_inventory,
        (SELECT max(staff_id)     FROM staff)     AS max_staff
    ),
    gen AS (
      SELECT
        b.max_customer, b.max_inventory, b.max_staff,
        t.rd, t.dur
      FROM bounds b,
           generate_series($lo, $hi) AS s(n),
           LATERAL (
             SELECT
               timestamptz '$START_TS'
                 + (random() * extract(epoch FROM (timestamptz '$END_TS' - timestamptz '$START_TS'))) * interval '1 second'
