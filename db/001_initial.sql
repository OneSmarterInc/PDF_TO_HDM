CREATE TABLE roles (name text PRIMARY KEY CHECK (name IN ('admin','user')));
INSERT INTO roles VALUES ('admin'),('user');
CREATE TABLE users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE CHECK(username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
 full_name text NOT NULL CHECK(length(full_name) BETWEEN 1 AND 120), email text NOT NULL DEFAULT '',
 role text NOT NULL REFERENCES roles(name), active boolean NOT NULL DEFAULT true,
 password_hash text NOT NULL, must_change_password boolean NOT NULL DEFAULT true,
 password_changed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_status_role ON users(active,role,created_at DESC);
CREATE TABLE sessions (
 token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_limits (
 key text PRIMARY KEY, attempts integer NOT NULL CHECK(attempts>=0), window_started timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE documents (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 sha256 text NOT NULL CHECK(length(sha256)=64), status text NOT NULL CHECK(status IN ('queued','processing','complete','error','cancelled')),
 result jsonb NOT NULL DEFAULT '{}'::jsonb, version integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL
);
CREATE INDEX documents_owner_created ON documents(owner_id,created_at DESC);
CREATE INDEX documents_expiry ON documents(expires_at);
CREATE TABLE document_assets (
 document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(name='input.pdf' OR name ~ '^page-[0-9]+\.png$'), data bytea NOT NULL,
 PRIMARY KEY(document_id,name)
);
CREATE TABLE saved_reviews (sha256 text PRIMARY KEY, data jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id uuid REFERENCES users(id),
 actor_username text, actor_role text, action text NOT NULL, module text NOT NULL, record_id text,
 created_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 request_id uuid, ip_address inet
);
CREATE INDEX audit_time ON audit_logs(created_at DESC,id DESC);
CREATE INDEX audit_actor_time ON audit_logs(actor_id,created_at DESC);
CREATE INDEX audit_action_time ON audit_logs(action,created_at DESC);
CREATE INDEX audit_module_time ON audit_logs(module,created_at DESC);
CREATE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Audit history is append-only'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_mutation();
