ALTER TABLE payment_attempts
ADD COLUMN IF NOT EXISTS authorization_state jsonb;

ALTER TABLE payment_attempts
DROP CONSTRAINT IF EXISTS payment_attempts_authorization_check;

ALTER TABLE payment_attempts
ADD CONSTRAINT payment_attempts_authorization_check CHECK (
  authorization_state IS NULL OR (
    jsonb_typeof(authorization_state) = 'object'
    AND integration = 'checkout' AND method = 'card' AND retry_of IS NULL
    AND authorization_state - ARRAY['paymentId', 'authTransactionId', 'authMerchantTxnId',
      'amountMinor', 'currency', 'fundsStatus', 'operation', 'conflict', 'updatedAt']::text[] = '{}'::jsonb
    AND authorization_state->>'authMerchantTxnId' = merchant_txn_id
    AND authorization_state->>'currency' = 'USD'
    AND authorization_state->>'fundsStatus' IN ('pending', 'authorized', 'captured', 'voided')
    AND jsonb_typeof(authorization_state->'amountMinor') = 'number'
    AND jsonb_typeof(authorization_state->'updatedAt') = 'string'
    AND (authorization_state->>'paymentId' IS NULL OR authorization_state->>'paymentId' = payment_id)
    AND (authorization_state->>'fundsStatus' = 'pending' OR (
      authorization_state->>'paymentId' ~ '^\d{1,20}$'
      AND authorization_state->>'authTransactionId' ~ '^\d{1,20}$'
    ))
  ) IS TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_authorization_operation_idx
  ON payment_attempts ((authorization_state->'operation'->>'merchantTxnId'))
  WHERE authorization_state->'operation'->>'merchantTxnId' IS NOT NULL;

INSERT INTO payment_schema_migrations (version)
VALUES ('0009_authorization')
ON CONFLICT (version) DO NOTHING;
