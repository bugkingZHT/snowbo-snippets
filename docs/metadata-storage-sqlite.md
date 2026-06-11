# Metadata Storage SQLite Design

This document describes the metadata storage design used by Snowbo Snippets.
It is intended for future maintainers and coding agents that need to change the
storage schema without breaking existing user data.

## Goals

- Store notebook metadata and app configuration in SQLite instead of frequently
  rewriting JSON files.
- Keep all app data inside the original app storage directory.
- Automatically import older file-based metadata on first run.
- Support future schema upgrades with explicit versioned migrations.
- Preserve the current frontend and Tauri command API shape.

## Storage Layout

The app storage directory is still:

```text
~/.snowbo-notebook/
```

The SQLite metadata database is:

```text
~/.snowbo-notebook/snowbo.sqlite3
```

Notebook body text is not stored in SQLite. It remains as plain text files:

```text
~/.snowbo-notebook/notes/<note-id>.txt
```

This keeps large user-authored text readable and recoverable, while moving the
frequently updated metadata/config state into a database with locking and
transactions.

SQLite may also create sidecar files next to the database when WAL mode is
enabled:

```text
~/.snowbo-notebook/snowbo.sqlite3-wal
~/.snowbo-notebook/snowbo.sqlite3-shm
```

These files are part of the database and must stay in the same directory.

## Current Schema

The current schema version is stored in SQLite with:

```sql
PRAGMA user_version;
```

The Rust constant is:

```rust
const DB_SCHEMA_VERSION: u32 = 1;
```

### `notes`

Stores notebook metadata only. Body content is loaded from `notes/<id>.txt`.

```sql
CREATE TABLE notes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    modified_at TEXT NOT NULL,
    pinned INTEGER,
    archived INTEGER,
    archived_at TEXT,
    deleted INTEGER,
    deleted_at TEXT,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_notes_deleted_position
    ON notes(deleted, position);
```

Column notes:

- `id`: stable note identifier, also used as the text filename.
- `title`: display title.
- `created_at`, `modified_at`: RFC3339 timestamps.
- `pinned`, `archived`, `deleted`: nullable booleans stored as `0` or `1`.
- `archived_at`, `deleted_at`: nullable RFC3339 timestamps.
- `position`: persisted note ordering used by the UI.

### `app_state`

Stores small structured app state values as JSON by key.

```sql
CREATE TABLE app_state (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
```

Current keys:

- `scratchSession`: serialized `ScratchSessionStore`.
- `shortcuts`: serialized `ShortcutConfig`.
- `ai`: serialized `AiConfig`.
- `app`: serialized `AppConfig`.

Using a key-value JSON table here keeps low-churn configuration backwards
compatible with existing serde defaults and aliases. If a config object becomes
large or needs querying, migrate that key into first-class relational tables in a
future schema version.

## Runtime Behavior

All normal metadata reads and writes go through:

- `load_app_data_sync()`
- `save_app_data_sync()`

These now delegate to SQLite-backed helpers in `src-tauri/src/main.rs`.

When opening the DB, the app configures:

- `busy_timeout = 5s`
- `foreign_keys = true`
- `journal_mode = WAL`

The busy timeout reduces transient lock failures across OSes. WAL mode improves
concurrent read/write behavior compared with repeatedly rewriting JSON.

## Compatibility Logging

Any compatibility operation must emit a storage log with the `[storage]` prefix.
The current implementation uses `storage_log(...)`, which writes to stderr.

Required log points:

- When a new SQLite schema is initialized.
- When an older SQLite schema is upgraded to the app-supported schema.
- When the DB schema is newer than the app supports and the app refuses to open
  it.
- When the metadata DB is empty and legacy import checks begin.
- When each legacy source file is detected.
- When each legacy source file is successfully imported, skipped, unreadable, or
  unparsable.
- When legacy data is committed into SQLite.
- When a legacy file is archived to `.bak`.

Future migrations should include the old version, new version, and a short
description of the migration. Example:

```rust
storage_log("migrating metadata database schema v1 -> v2: adding notes.summary");
```

## Forward Compatibility

Forward compatibility means an older app version must not silently corrupt a
newer database.

On every DB open, `migrate_db_schema` reads `PRAGMA user_version`.

If the database version is greater than the app's `DB_SCHEMA_VERSION`, the app
returns an error instead of trying to read or write unknown structures:

```text
metadata database schema vN is newer than this app supports (vM)
```

This path must also log the mismatch before returning the error.

This is intentional. It protects users who downgrade the app after opening their
data with a newer version.

## Backward Compatibility

Backward compatibility means a newer app can open older user data.

The app handles two categories:

1. Older SQLite schema versions.
2. Legacy JSON/file-based metadata formats.

### SQLite Schema Upgrades

Use additive, versioned migrations in `migrate_db_schema`.

Example upgrade from v1 to v2:

```rust
const DB_SCHEMA_VERSION: u32 = 2;

fn migrate_db_schema(conn: &Connection) -> Result<(), String> {
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if version > DB_SCHEMA_VERSION {
        return Err(format!(
            "metadata database schema v{version} is newer than this app supports (v{DB_SCHEMA_VERSION})"
        ));
    }

    if version == 0 {
        // Create latest schema for new databases.
    }

    if version < 2 {
        storage_log("migrating metadata database schema v1 -> v2: adding notes.summary");
        conn.execute_batch(
            "
            BEGIN;
            ALTER TABLE notes ADD COLUMN summary TEXT;
            PRAGMA user_version = 2;
            COMMIT;
            ",
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}
```

Rules for future migrations:

- Always increase `DB_SCHEMA_VERSION`.
- Always update `PRAGMA user_version` inside the same migration transaction.
- Prefer additive changes such as `ADD COLUMN`, new indexes, or new tables.
- If a destructive rewrite is unavoidable, create a new table, copy data, verify
  row counts or required invariants, then swap tables in the transaction.
- Keep migrations idempotent across app launches by checking the old version
  before applying each step.
- Never rely on JSON fallback after a SQLite database has real data.

### Legacy JSON Import

On first run with an empty SQLite database, the app imports legacy files from the
same app storage directory.

Legacy unified JSON:

```text
~/.snowbo-notebook/data.json
```

Older fragmented JSON files:

```text
~/.snowbo-notebook/notes-index.json
~/.snowbo-notebook/scratch-session.json
~/.snowbo-notebook/config.json
~/.snowbo-notebook/ai-config.json
~/.snowbo-notebook/app-config.json
```

Old single-file notebook format:

```text
~/.snowbo-notebook/notes.json
```

Import order:

1. Open/create `snowbo.sqlite3`.
2. If the DB is empty, import `data.json` when present.
3. If `data.json` is missing, import fragmented JSON files.
4. Import old `notes.json` if present, converting each legacy cell list into a
   plain text note file.
5. Archive imported legacy JSON files as `.bak`.

The importer deliberately only runs when the SQLite database is empty. Once the
DB has data, it is the source of truth.

## Source of Truth

After migration:

- SQLite is the source of truth for metadata/config/scratch state.
- `notes/<id>.txt` is the source of truth for note body content.
- Legacy JSON files are archival only.

Do not add new writes to `data.json` or the old fragmented JSON files.

## Adding a New Metadata Field

For a note metadata field that must be queried, sorted, or updated often:

1. Add a nullable or defaulted column to `notes` in a new schema migration.
2. Increment `DB_SCHEMA_VERSION`.
3. Update `NoteMeta`, `note_to_meta`, and SQL load/save statements.
4. Provide serde defaults if the field is also exposed through existing command
   payloads.
5. Confirm `cargo check` passes.

For small app settings that do not need SQL querying:

1. Add the field to the relevant config struct with `#[serde(default)]` or a
   default function.
2. Keep storing that config object under its existing `app_state` key.
3. No DB schema version bump is required unless the table layout changes.

## Operational Notes

- Do not move `snowbo.sqlite3` outside `~/.snowbo-notebook`.
- Do not delete SQLite WAL/SHM sidecar files while the app is running.
- If a DB is corrupt, prefer adding a controlled recovery path that exports or
  archives the DB before creating a fresh one.
- If an app build changes schema, test upgrades from:
  - no existing storage,
  - legacy fragmented JSON,
  - legacy `data.json`,
  - old `notes.json`,
  - the previous SQLite schema version.
