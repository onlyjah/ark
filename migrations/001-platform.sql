-- Jah Noah [Q007]: "all my projects are sovereign"
-- Engineering: additive target schema, not applied to the existing SQLite archive or OnlyJah Neon database.
BEGIN;
CREATE TABLE ark_client_sites (id text PRIMARY KEY, origins text[] NOT NULL, schema_version integer NOT NULL CHECK(schema_version>0), schema_definition jsonb NOT NULL DEFAULT '{}', active boolean NOT NULL DEFAULT false);
CREATE TABLE ark_buckets (id uuid PRIMARY KEY, owner_subject text NOT NULL, mode text NOT NULL CHECK(mode IN ('private','top-secret')), key_id text, CHECK(mode <> 'top-secret' OR key_id IS NOT NULL));
CREATE TABLE ark_client_grants (id uuid PRIMARY KEY, owner_subject text NOT NULL, client_id text NOT NULL REFERENCES ark_client_sites(id), bucket_id uuid NOT NULL REFERENCES ark_buckets(id), scopes text[] NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, CHECK(scopes <@ ARRAY['metadata.read','objects.read','objects.write','plaintext.read']::text[]));
CREATE INDEX ark_active_grants ON ark_client_grants(owner_subject,client_id,bucket_id) WHERE revoked_at IS NULL;
CREATE TABLE ark_cipher_objects (id uuid PRIMARY KEY, bucket_id uuid NOT NULL REFERENCES ark_buckets(id), owner_subject text NOT NULL, head uuid, encrypted_metadata jsonb NOT NULL);
CREATE TABLE ark_cipher_revisions (id uuid PRIMARY KEY, object_id uuid NOT NULL REFERENCES ark_cipher_objects(id), parent_id uuid REFERENCES ark_cipher_revisions(id), envelope jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE ark_cipher_objects ADD CONSTRAINT ark_cipher_head_fk FOREIGN KEY(head) REFERENCES ark_cipher_revisions(id);
CREATE TABLE ark_consent_audit (id uuid PRIMARY KEY, owner_subject text NOT NULL, client_id text NOT NULL REFERENCES ark_client_sites(id), grant_id uuid REFERENCES ark_client_grants(id), event text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
-- Restrict application-role access at provisioning. Backend verifies ownership and grant constraints on every request; this schema alone is not authorization.
COMMIT;
