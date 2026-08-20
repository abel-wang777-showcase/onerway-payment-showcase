SELECT pg_advisory_xact_lock(hashtextextended('onerway-payment-showcase:migrations', 0));

CREATE TABLE IF NOT EXISTS payment_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id text PRIMARY KEY,
  scene text NOT NULL,
  item_sku text NOT NULL,
  item_name text NOT NULL,
  item_variant text NOT NULL,
  item_quantity integer NOT NULL CHECK (item_quantity > 0),
  item_unit_minor bigint NOT NULL CHECK (item_unit_minor >= 0),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  fulfillment text NOT NULL CHECK (fulfillment IN ('pending', 'fulfilled', 'cancelled')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_orders_retention_idx
  ON payment_orders (created_at);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id text PRIMARY KEY,
  order_id text NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  integration text NOT NULL CHECK (integration IN ('web-js-sdk', 'checkout', 'direct-api')),
  method text NOT NULL CHECK (method IN ('card', 'apm', 'google-pay', 'apple-pay')),
  status text NOT NULL CHECK (status IN ('created', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled')),
  status_source text CHECK (status_source IN ('simulation', 'server', 'client', 'return', 'query', 'webhook')),
  retry_of text REFERENCES payment_attempts(id) ON DELETE SET NULL,
  merchant_txn_id text NOT NULL UNIQUE CHECK (length(merchant_txn_id) BETWEEN 1 AND 64),
  payment_id text UNIQUE CHECK (payment_id IS NULL OR payment_id ~ '^\d{1,20}$'),
  transaction_id text CHECK (transaction_id IS NULL OR transaction_id ~ '^\d{1,20}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS payment_attempts_transaction_idx
  ON payment_attempts (transaction_id);

CREATE TABLE IF NOT EXISTS payment_events (
  id text PRIMARY KEY,
  attempt_id text NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('simulation', 'server', 'client', 'return', 'query', 'webhook')),
  source_key text NOT NULL CHECK (length(source_key) BETWEEN 1 AND 256),
  status text NOT NULL CHECK (status IN ('created', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled')),
  raw_status text CHECK (raw_status IS NULL OR length(raw_status) <= 16),
  transaction_id text CHECK (transaction_id IS NULL OR transaction_id ~ '^\d{1,20}$'),
  transaction_status text CHECK (transaction_status IS NULL OR transaction_status IN ('S', 'F', 'N')),
  payment_status text CHECK (payment_status IS NULL OR payment_status IN ('I', 'U', 'P', 'R', 'A', 'O', 'S', 'N')),
  conflict boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_key)
);

CREATE INDEX IF NOT EXISTS payment_events_attempt_timeline_idx
  ON payment_events (attempt_id, occurred_at, id);

CREATE INDEX IF NOT EXISTS payment_events_transaction_idx
  ON payment_events (transaction_id);

INSERT INTO payment_schema_migrations (version)
VALUES ('0001_payment')
ON CONFLICT (version) DO NOTHING;
