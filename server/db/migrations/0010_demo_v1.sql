-- Directed reuse of the uncommitted mobile worktree's 0010_native_sdk.sql
-- (codex/native-demo-api at fa7c4a8); its original files remain untouched.
ALTER TABLE payment_attempts DROP CONSTRAINT IF EXISTS payment_attempts_integration_check;
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_integration_check
  CHECK (integration IN ('web-js-sdk', 'checkout', 'direct-api', 'native-sdk'));

-- Claims deliberately have no owner/resource foreign key: minimal hashes survive
-- session and detail retention, so an old key can never create another payment.
CREATE TABLE IF NOT EXISTS demo_claims (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  owner_hash text NOT NULL CHECK (owner_hash ~ '^[0-9a-f]{64}$'),
  intent_hash text NOT NULL CHECK (intent_hash ~ '^[0-9a-f]{64}$'),
  type text NOT NULL CHECK (type IN ('payment_create', 'subscription_create', 'checkout_session', 'capture', 'void', 'subscription_change', 'subscription_cancel', 'subscription_renewal', 'customer_create')),
  created_at timestamptz NOT NULL,
  expired boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS demo_sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  platform text NOT NULL CHECK (platform IN ('ANDROID', 'IOS', 'WEB')),
  current_customer_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS demo_sessions_expiry_idx ON demo_sessions (expires_at);

CREATE TABLE IF NOT EXISTS demo_customers (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES demo_sessions(id),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 40),
  merchant_cust_id text NOT NULL UNIQUE CHECK (merchant_cust_id ~ '^[A-Za-z0-9_-]{1,63}$'),
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, id)
);
CREATE INDEX IF NOT EXISTS demo_customers_session_idx ON demo_customers (session_id, created_at, id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'demo_sessions'::regclass AND conname = 'demo_sessions_current_customer_fk'
  ) THEN
    ALTER TABLE demo_sessions ADD CONSTRAINT demo_sessions_current_customer_fk
      FOREIGN KEY (id, current_customer_id) REFERENCES demo_customers(session_id, id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS demo_operations (
  key_hash text PRIMARY KEY REFERENCES demo_claims(key_hash),
  session_id text NOT NULL REFERENCES demo_sessions(id),
  id uuid NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('payment_create', 'subscription_create', 'checkout_session', 'capture', 'void', 'subscription_change', 'subscription_cancel', 'subscription_renewal', 'customer_create')),
  execution text NOT NULL CHECK (execution IN ('accepted', 'unknown', 'completed')),
  outcome text CHECK (outcome IN ('scheduled', 'effective', 'rejected')),
  resource_kind text CHECK (resource_kind IN ('payment', 'subscription', 'checkout_session', 'customer')),
  resource_id text,
  lease_state text CHECK (lease_state IN ('active', 'released', 'expired', 'superseded')),
  error jsonb CHECK (error IS NULL OR jsonb_typeof(error) = 'object'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (session_id, id),
  CHECK ((execution = 'completed' AND outcome IS NOT NULL) OR (execution IN ('accepted', 'unknown') AND outcome IS NULL)),
  CHECK ((resource_kind IS NULL) = (resource_id IS NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS demo_operations_expiry_idx ON demo_operations (expires_at);

CREATE TABLE IF NOT EXISTS demo_payments (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES demo_sessions(id),
  request_id uuid NOT NULL UNIQUE,
  order_id text NOT NULL,
  attempt_id text NOT NULL,
  merchant_txn_id text NOT NULL UNIQUE CHECK (merchant_txn_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  customer_id text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ANDROID', 'IOS')),
  amount_minor bigint NOT NULL CHECK (amount_minor BETWEEN 1 AND 1000000),
  currency text NOT NULL CHECK (currency = 'USD'),
  return_url text NOT NULL CHECK (char_length(return_url) <= 4096),
  merchant_no text NOT NULL,
  config_revision text NOT NULL,
  creation_state text NOT NULL CHECK (creation_state IN ('pending', 'ready', 'unknown', 'rejected')),
  payment_id text UNIQUE CHECK (payment_id IS NULL OR payment_id ~ '^[0-9]{1,20}$'),
  transaction_id text CHECK (transaction_id IS NULL OR transaction_id ~ '^[0-9]{1,20}$'),
  raw_payment_status text CHECK (raw_payment_status IN ('I', 'U', 'P', 'A', 'O', 'R', 'N', 'S')),
  raw_transaction_status text CHECK (char_length(raw_transaction_status) BETWEEN 1 AND 32),
  normalized text NOT NULL CHECK (normalized IN ('created', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'unknown')),
  status_source text NOT NULL CHECK (status_source IN ('server', 'query', 'webhook')),
  verified boolean NOT NULL DEFAULT false,
  observed_at timestamptz,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz,
  continue_until timestamptz,
  UNIQUE (session_id, id),
  FOREIGN KEY (session_id, customer_id) REFERENCES demo_customers(session_id, id),
  FOREIGN KEY (session_id, request_id) REFERENCES demo_operations(session_id, id),
  CHECK (expires_at > created_at),
  CHECK ((sent_at IS NULL AND continue_until IS NULL) OR (sent_at IS NOT NULL AND continue_until IS NOT NULL AND continue_until > sent_at)),
  CHECK (creation_state <> 'ready' OR payment_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS demo_payments_session_idx ON demo_payments (session_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS demo_payments_expiry_idx ON demo_payments (expires_at);

CREATE TABLE IF NOT EXISTS demo_leases (
  id text PRIMARY KEY,
  payment_id text NOT NULL,
  session_id text NOT NULL,
  operation_id uuid NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'released', 'expired', 'superseded')),
  FOREIGN KEY (session_id, payment_id) REFERENCES demo_payments(session_id, id),
  FOREIGN KEY (session_id, operation_id) REFERENCES demo_operations(session_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS demo_leases_active_idx ON demo_leases (payment_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS demo_leases_expiry_idx ON demo_leases (expires_at) WHERE state = 'active';

CREATE TABLE IF NOT EXISTS demo_jobs (
  payment_id text PRIMARY KEY REFERENCES demo_payments(id),
  due_at timestamptz NOT NULL,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code text CHECK (char_length(last_error_code) BETWEEN 1 AND 128),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  claimed_revision bigint CHECK (claimed_revision >= 1 AND claimed_revision <= revision),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'running', 'completed', 'unresolved')),
  deadline_at timestamptz NOT NULL,
  last_attempt_at timestamptz
);
CREATE INDEX IF NOT EXISTS demo_jobs_due_idx ON demo_jobs (due_at, payment_id) WHERE state IN ('pending', 'running');

CREATE TABLE IF NOT EXISTS demo_events (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES demo_payments(id),
  source text NOT NULL CHECK (source IN ('server', 'query', 'webhook')),
  kind text NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 64 AND kind ~ '^[a-z_]+$'),
  raw_status text CHECK (char_length(raw_status) BETWEEN 1 AND 32 AND raw_status ~ '^[A-Za-z0-9_:>-]+$'),
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS demo_events_payment_idx ON demo_events (payment_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS demo_limits (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  reset_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS demo_limits_reset_idx ON demo_limits (reset_at);

-- Bounded tombstones distinguish known-expired resources from inaccessible IDs
-- without extending the retention of payment details or lease launch material.
CREATE TABLE IF NOT EXISTS demo_resource_tombstones (
  resource_hash text PRIMARY KEY CHECK (resource_hash ~ '^[0-9a-f]{64}$'),
  owner_hash text NOT NULL CHECK (owner_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  type text NOT NULL CHECK (type IN ('payment', 'checkout_session'))
);
CREATE INDEX IF NOT EXISTS demo_resource_tombstones_expiry_idx ON demo_resource_tombstones (expires_at);

INSERT INTO payment_schema_migrations (version)
VALUES ('0010_demo_v1') ON CONFLICT (version) DO NOTHING;
