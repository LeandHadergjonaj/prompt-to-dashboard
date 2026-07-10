-- Scales customer to ~50,000 rows. Reuses existing address_id values at
-- random; synthetic names/emails. Idempotent: skips if already at target.

DO $$
DECLARE
  target_total  int := 50000;
  current_total int;
  to_add        int;
BEGIN
  SELECT count(*) INTO current_total FROM public.customer;
  to_add := target_total - current_total;
  IF to_add <= 0 THEN
    RAISE NOTICE 'customer already at % rows, skipping', current_total;
    RETURN;
  END IF;

  INSERT INTO public.customer
    (store_id, first_name, last_name, email, address_id, activebool, create_date, last_update, active)
  SELECT
    (1 + (gs % (SELECT count(*)::int FROM public.store))),
    (ARRAY['James','Maria','Robert','Linda','Michael','Patricia','David','Jennifer',
           'John','Elizabeth','William','Susan','Richard','Jessica','Thomas','Karen',
           'Charles','Nancy','Daniel','Lisa'])[1 + (gs % 20)],
    (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
           'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson',
           'Thomas','Taylor','Moore','Jackson','Martin'])[1 + ((gs / 20) % 20)],
    lower(
      (ARRAY['James','Maria','Robert','Linda','Michael','Patricia','David','Jennifer',
             'John','Elizabeth','William','Susan','Richard','Jessica','Thomas','Karen',
             'Charles','Nancy','Daniel','Lisa'])[1 + (gs % 20)]
      || '.' ||
      (ARRAY['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis',
             'Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson',
             'Thomas','Taylor','Moore','Jackson','Martin'])[1 + ((gs / 20) % 20)]
      || gs || '@example.com'
    ),
    addr.ids[1 + floor(random() * addr.n)::int],
    (random() > 0.03),
    (date '2022-01-01' + floor(random() * 1660)::int),
    now(),
    CASE WHEN random() > 0.03 THEN 1 ELSE 0 END
  FROM generate_series(1, to_add) AS gs
  CROSS JOIN (SELECT array_agg(address_id) AS ids, count(*)::int AS n FROM public.address) AS addr;
END $$;
