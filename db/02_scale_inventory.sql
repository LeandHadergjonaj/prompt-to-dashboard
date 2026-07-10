-- Scales inventory to ~300,000 rows. film stays fixed at 1000 rows;
-- film_id/store_id drawn from the actual tables. Idempotent.

DO $$
DECLARE
  target_total  int := 300000;
  current_total int;
  to_add        int;
BEGIN
  SELECT count(*) INTO current_total FROM public.inventory;
  to_add := target_total - current_total;
  IF to_add <= 0 THEN
    RAISE NOTICE 'inventory already at % rows, skipping', current_total;
    RETURN;
  END IF;

  INSERT INTO public.inventory (film_id, store_id, last_update)
  SELECT
    film.ids[1 + floor(random() * film.n)::int],
    store.ids[1 + floor(random() * store.n)::int],
    now()
  FROM generate_series(1, to_add)
  CROSS JOIN (SELECT array_agg(film_id) AS ids, count(*)::int AS n FROM public.film) AS film
  CROSS JOIN (SELECT array_agg(store_id) AS ids, count(*)::int AS n FROM public.store) AS store;
END $$;
