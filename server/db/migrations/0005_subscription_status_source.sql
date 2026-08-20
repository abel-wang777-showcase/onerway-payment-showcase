DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM payment_schema_migrations
    WHERE version = '0005_subscription_status_source'
  ) THEN
    ALTER TABLE subscription_contracts
    DROP CONSTRAINT IF EXISTS subscription_contracts_status_source_check;

    ALTER TABLE subscription_contracts
    ADD CONSTRAINT subscription_contracts_status_source_check
    CHECK (status_source IN ('placeholder', 'query', 'webhook'));
  END IF;
END $$;

INSERT INTO payment_schema_migrations (version)
VALUES ('0005_subscription_status_source')
ON CONFLICT (version) DO NOTHING;
