ALTER TABLE payment_attempts
ADD COLUMN IF NOT EXISTS actual_wallet text,
ADD COLUMN IF NOT EXISTS funding_network text,
ADD COLUMN IF NOT EXISTS attribution_transaction_id text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_attempts_actual_wallet_check'
      AND conrelid = 'payment_attempts'::regclass
  ) THEN
    ALTER TABLE payment_attempts
    ADD CONSTRAINT payment_attempts_actual_wallet_check
    CHECK (actual_wallet IS NULL OR actual_wallet IN ('google-pay', 'apple-pay'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_attempts_funding_network_check'
      AND conrelid = 'payment_attempts'::regclass
  ) THEN
    ALTER TABLE payment_attempts
    ADD CONSTRAINT payment_attempts_funding_network_check
    CHECK (funding_network IS NULL OR funding_network ~ '^[A-Z0-9][A-Z0-9 _-]{0,31}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_attempts_attribution_complete_check'
      AND conrelid = 'payment_attempts'::regclass
  ) THEN
    ALTER TABLE payment_attempts
    ADD CONSTRAINT payment_attempts_attribution_complete_check
    CHECK (
      (actual_wallet IS NULL AND funding_network IS NULL AND attribution_transaction_id IS NULL)
      OR (
        transaction_id IS NOT NULL
        AND attribution_transaction_id = transaction_id
        AND (actual_wallet IS NOT NULL OR funding_network IS NOT NULL)
      )
    );
  END IF;
END $$;

INSERT INTO payment_schema_migrations (version)
VALUES ('0006_payment_method_attribution')
ON CONFLICT (version) DO NOTHING;
