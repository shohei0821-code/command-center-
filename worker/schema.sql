CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY CHECK (id = 'main'),
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO app_state (id, payload, revision, updated_at)
VALUES ('main', '{"tasks":[],"events":[],"theme":"dark"}', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
