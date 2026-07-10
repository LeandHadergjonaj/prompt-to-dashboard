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
                 AS rd,
               (interval '1 hour' + random() * interval '13 days') AS dur
           ) t
    ),
    new_rentals AS (
      INSERT INTO rental (rental_date, inventory_id, customer_id, return_date, staff_id, last_update)
      SELECT
        rd,
        (1 + floor(random() * max_inventory))::int,
        (1 + floor(random() * max_customer))::int,
        CASE
          WHEN rd + dur > timestamptz '$END_TS' THEN NULL
          WHEN rd > (timestamptz '$END_TS' - interval '10 days') AND random() < 0.35 THEN NULL
          ELSE rd + dur
        END,
        (1 + floor(random() * max_staff))::int,
        now()
      FROM gen
      ON CONFLICT (rental_date, inventory_id, customer_id) DO NOTHING
      RETURNING rental_id, rental_date, customer_id, staff_id
    )
    INSERT INTO payment (customer_id, staff_id, rental_id, amount, payment_date)
    SELECT
      customer_id,
      staff_id,
      rental_id,
      round((0.99 + random() * 11.00)::numeric, 2),
      rental_date + (interval '1 hour' * floor(random() * 71))
    FROM new_rentals;
  "
done

echo "Done. Verify with scripts/04_verify.sh"
