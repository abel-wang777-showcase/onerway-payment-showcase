ALTER TABLE payment_attempts
ADD COLUMN IF NOT EXISTS submission_started_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS payment_attempts_retry_of_unique_idx
  ON payment_attempts (retry_of)
  WHERE retry_of IS NOT NULL;

UPDATE payment_attempts
SET submission_started_at = updated_at
WHERE payment_id IS NOT NULL
  AND submission_started_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM payment_schema_migrations
    WHERE version = '0002_retry'
  );

INSERT INTO payment_schema_migrations (version)
VALUES ('0002_retry')
ON CONFLICT (version) DO NOTHING;
