SET statement_timeout = 0;

-- Dashboard-serving indexes not shipped by pagila, plus fresh planner stats.
-- No index on payment.payment_date: it's the partition key, pruning handles it.

CREATE INDEX IF NOT EXISTS idx_rental_rental_date ON public.rental (rental_date);
CREATE INDEX IF NOT EXISTS idx_rental_customer_id ON public.rental (customer_id);
CREATE INDEX IF NOT EXISTS idx_inventory_film_id   ON public.inventory (film_id);
CREATE INDEX IF NOT EXISTS idx_inventory_store_id  ON public.inventory (store_id);
CREATE INDEX IF NOT EXISTS idx_customer_store_id   ON public.customer (store_id);

ANALYZE public.customer;
ANALYZE public.inventory;
ANALYZE public.rental;
ANALYZE public.payment;
ANALYZE public.film;
ANALYZE public.store;
