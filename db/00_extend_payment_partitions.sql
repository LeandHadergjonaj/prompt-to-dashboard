-- Extends `payment` range partitions from the 7 pagila ships (2022-01..2022-07)
-- through 2026-12, plus a DEFAULT catch-all partition. Idempotent.

SET timezone = 'UTC';

DO $$
DECLARE
  month_start date;
  month_end   date;
  part_name   text;
BEGIN
  FOR month_start IN
    SELECT d::date
    FROM generate_series('2022-08-01'::date, '2026-12-01'::date, interval '1 month') AS d
  LOOP
    month_end := (month_start + interval '1 month')::date;
    part_name := format('payment_p%s', to_char(month_start, 'YYYY_MM'));
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = part_name
    ) THEN
      EXECUTE format(
        'CREATE TABLE public.%I PARTITION OF public.payment FOR VALUES FROM (%L) TO (%L);',
        part_name, month_start, month_end
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'payment_pdefault'
  ) THEN
    EXECUTE 'CREATE TABLE public.payment_pdefault PARTITION OF public.payment DEFAULT;';
  END IF;
END $$;
