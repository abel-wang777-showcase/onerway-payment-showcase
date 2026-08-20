ALTER TABLE payment_orders
ADD COLUMN IF NOT EXISTS customer_environment text,
ADD COLUMN IF NOT EXISTS customer_merchant_no text,
ADD COLUMN IF NOT EXISTS customer_app_id text,
ADD COLUMN IF NOT EXISTS merchant_cust_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_orders_customer_complete_check'
      AND conrelid = 'payment_orders'::regclass
  ) THEN
    ALTER TABLE payment_orders
    ADD CONSTRAINT payment_orders_customer_complete_check CHECK (
      (customer_environment IS NULL AND customer_merchant_no IS NULL
        AND customer_app_id IS NULL AND merchant_cust_id IS NULL)
      OR
      (customer_environment IS NOT NULL AND customer_merchant_no IS NOT NULL
        AND customer_app_id IS NOT NULL AND merchant_cust_id IS NOT NULL)
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_orders_customer_value_check'
      AND conrelid = 'payment_orders'::regclass
  ) THEN
    ALTER TABLE payment_orders
    ADD CONSTRAINT payment_orders_customer_value_check CHECK (
      merchant_cust_id IS NULL
      OR (customer_environment IN ('sandbox', 'production')
        AND length(customer_merchant_no) > 0
        AND length(customer_app_id) > 0
        AND merchant_cust_id ~ '^[A-Za-z0-9_-]{1,63}$')
    );
  END IF;
END $$;

INSERT INTO payment_schema_migrations (version)
VALUES ('0003_customer')
ON CONFLICT (version) DO NOTHING;
