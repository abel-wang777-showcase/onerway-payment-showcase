ALTER TABLE payment_attempts
ADD COLUMN IF NOT EXISTS authorization jsonb;

ALTER TABLE payment_attempts
DROP CONSTRAINT IF EXISTS payment_attempts_authorization_check;

ALTER TABLE payment_attempts
ADD CONSTRAINT payment_attempts_authorization_check CHECK (
  authorization IS NULL OR (
    jsonb_typeof(authorization) = 'object'
    AND integration = 'checkout' AND method = 'card' AND retry_of IS NULL
    AND authorization - ARRAY['paymentId', 'authTransactionId', 'authMerchantTxnId',
      'amountMinor', 'currency', 'fundsStatus', 'operation', 'conflict', 'updatedAt']::text[] = '{}'::jsonb
    AND authorization->>'authMerchantTxnId' = merchant_txn_id
    AND authorization->>'currency' = 'USD'
    AND authorization->>'fundsStatus' IN ('pending', 'authorized', 'captured', 'voided')
    AND jsonb_typeof(authorization->'amountMinor') = 'number'
    AND jsonb_typeof(authorization->'updatedAt') = 'string'
    AND (authorization->>'paymentId' IS NULL OR authorization->>'paymentId' = payment_id)
    AND (authorization->>'fundsStatus' = 'pending' OR (
      authorization->>'paymentId' ~ '^\d{1,20}$'
      AND authorization->>'authTransactionId' ~ '^\d{1,20}$'
    ))
  ) IS TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_authorization_operation_idx
  ON payment_attempts ((authorization->'operation'->>'merchantTxnId'))
  WHERE authorization->'operation'->>'merchantTxnId' IS NOT NULL;

INSERT INTO payment_schema_migrations (version)
VALUES ('0009_authorization')
ON CONFLICT (version) DO NOTHING;
