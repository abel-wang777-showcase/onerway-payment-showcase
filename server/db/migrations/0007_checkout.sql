ALTER TABLE payment_attempts
DROP CONSTRAINT IF EXISTS payment_attempts_method_check;

ALTER TABLE payment_attempts
ADD CONSTRAINT payment_attempts_method_check
CHECK (method IN ('card', 'apm', 'google-pay', 'apple-pay', 'all'));

ALTER TABLE payment_events
DROP CONSTRAINT IF EXISTS payment_events_transaction_status_check;

ALTER TABLE payment_events
ADD CONSTRAINT payment_events_transaction_status_check
CHECK (transaction_status IS NULL OR transaction_status IN ('S', 'F', 'N', 'I', 'U', 'P', 'R'));

INSERT INTO payment_schema_migrations (version)
VALUES ('0007_checkout')
ON CONFLICT (version) DO NOTHING;
