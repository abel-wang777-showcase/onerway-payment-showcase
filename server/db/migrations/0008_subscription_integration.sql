ALTER TABLE subscription_contracts
ADD COLUMN IF NOT EXISTS initial_integration text NOT NULL DEFAULT 'web-js-sdk'
CHECK (initial_integration IN ('web-js-sdk', 'checkout'));

INSERT INTO payment_schema_migrations (version)
VALUES ('0008_subscription_integration')
ON CONFLICT (version) DO NOTHING;
