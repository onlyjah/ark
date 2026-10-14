BEGIN;
CREATE SCHEMA IF NOT EXISTS ark_kash;
CREATE TABLE IF NOT EXISTS ark_kash.accounts (
  user_id uuid PRIMARY KEY REFERENCES neon_auth."user"(id),
  handle text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ark_kash.purchases (
  id uuid PRIMARY KEY,
  claim_hash text NOT NULL UNIQUE,
  checkout_id text UNIQUE,
  customer_id text,
  subscription_id text UNIQUE,
  payment_email text,
  user_id uuid REFERENCES ark_kash.accounts(user_id),
  status text NOT NULL DEFAULT 'pending',
  entitled_until bigint NOT NULL DEFAULT 0,
  observed_at bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchases_user_idx ON ark_kash.purchases(user_id);
CREATE TABLE IF NOT EXISTS ark_kash.webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ark_kash.key_envelopes (
  user_id uuid PRIMARY KEY REFERENCES ark_kash.accounts(user_id),
  version integer NOT NULL CHECK(version=1),
  encrypted_bundle jsonb NOT NULL,
  encryption_public_key jsonb NOT NULL,
  signing_public_key jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA ark_kash FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ark_kash FROM PUBLIC;
COMMIT;
