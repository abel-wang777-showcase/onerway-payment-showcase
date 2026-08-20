CREATE TABLE IF NOT EXISTS subscription_contracts (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('sandbox', 'production')),
  merchant_no text NOT NULL CHECK (length(merchant_no) > 0),
  app_id text NOT NULL CHECK (length(app_id) > 0),
  merchant_cust_id text NOT NULL CHECK (merchant_cust_id ~ '^[A-Za-z0-9_-]{1,63}$'),
  plan_id text NOT NULL CHECK (length(plan_id) BETWEEN 1 AND 128),
  plan_version integer NOT NULL CHECK (plan_version > 0),
  product_name text NOT NULL CHECK (length(product_name) BETWEEN 1 AND 128),
  initial_amount_minor bigint NOT NULL CHECK (initial_amount_minor >= 0),
  currency text NOT NULL CHECK (currency = 'USD'),
  frequency_type text NOT NULL CHECK (frequency_type IN ('D', 'M', 'Y')),
  frequency_point integer NOT NULL CHECK (frequency_point > 0),
  expire_date date NOT NULL,
  initial_order_id text NOT NULL CHECK (length(initial_order_id) BETWEEN 1 AND 128),
  initial_attempt_id text NOT NULL UNIQUE CHECK (length(initial_attempt_id) BETWEEN 1 AND 128),
  merchant_txn_id text NOT NULL UNIQUE CHECK (merchant_txn_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  payment_id text UNIQUE CHECK (payment_id IS NULL OR payment_id ~ '^\d{1,20}$'),
  initial_webhook_transaction_id text UNIQUE CHECK (
    initial_webhook_transaction_id IS NULL OR initial_webhook_transaction_id ~ '^\d{1,20}$'
  ),
  establishment_state text NOT NULL CHECK (establishment_state IN ('pending', 'active', 'needs_attention', 'terminal')),
  status_source text NOT NULL CHECK (status_source IN ('placeholder', 'query')),
  status_observed_at timestamptz NOT NULL,
  data_status text NOT NULL CHECK (data_status IN ('0', '1', '2', '3')),
  subscription_status text NOT NULL CHECK (subscription_status IN ('trialing', 'paymentdue', 'active', 'pastdue', 'paused', 'canceled', 'ended')),
  contract_id text UNIQUE CHECK (
    contract_id IS NULL
    OR (length(contract_id) BETWEEN 1 AND 128 AND contract_id ~ '^[A-Za-z0-9_-]+$')
  ),
  token_id text CHECK (
    token_id IS NULL
    OR (octet_length(token_id) BETWEEN 1 AND 512 AND token_id !~ '[[:cntrl:]]')
  ),
  terminal_at timestamptz,
  cleanup_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CHECK ((terminal_at IS NULL AND cleanup_at IS NULL) OR (terminal_at IS NOT NULL AND cleanup_at IS NOT NULL)),
  CHECK ((establishment_state = 'terminal') = (terminal_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS subscription_contracts_active_scope_plan_idx
  ON subscription_contracts (environment, merchant_no, app_id, merchant_cust_id, plan_id)
  WHERE terminal_at IS NULL;

CREATE INDEX IF NOT EXISTS subscription_contracts_contract_lookup_idx
  ON subscription_contracts (contract_id)
  WHERE contract_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscription_contracts_cleanup_idx
  ON subscription_contracts (cleanup_at)
  WHERE cleanup_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscription_contracts_scope_plan_idx
  ON subscription_contracts (environment, merchant_no, app_id, merchant_cust_id, plan_id);

INSERT INTO payment_schema_migrations (version)
VALUES ('0004_subscription')
ON CONFLICT (version) DO NOTHING;
