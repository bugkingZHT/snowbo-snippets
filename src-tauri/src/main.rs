// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::command;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;
use uuid::Uuid;

mod clipboard_history;
mod quick_copy;
mod system_notification;

use clipboard_history::{
    apply_clipboard_history_limit_from_config, clamp_clipboard_history_limit,
    default_clipboard_history_limit, init_clipboard_history, record_app_clipboard_write,
};
use quick_copy::{
    activate_main_window, ensure_quick_copy_window, hide_quick_copy_menu, is_presented,
    open_quick_copy_menu, quick_copy_host_ready, quick_copy_pin_item, quick_copy_select,
    quick_copy_unpin_item, show_main_window, show_main_window_for_note, QuickCopyClipboard,
    QuickCopyHostState,
};

pub(crate) const SCRATCH_SESSION_NOTE_ID: &str = "__scratch_session__";
pub(crate) const SCRATCH_SESSION_TITLE: &str = "Temporary chat";

/// quick-copy 弹窗仍按 cell 粒度消费内容;主窗口已改为单文件纯文本。
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Cell {
    id: String,
    #[serde(alias = "language")]
    mode: String,
    content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    wrap: Option<bool>,
}

/// 主窗口 API：笔记正文在磁盘上的 .txt 文件里,此处只带内存中的 content。
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct Note {
    id: String,
    title: String,
    content: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "modifiedAt")]
    modified_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pinned: Option<bool>,
    #[serde(default)]
    archived: Option<bool>,
    #[serde(rename = "archivedAt", default)]
    archived_at: Option<String>,
    #[serde(default)]
    deleted: Option<bool>,
    #[serde(rename = "deletedAt", default)]
    deleted_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct NoteMeta {
    id: String,
    title: String,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "modifiedAt")]
    modified_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pinned: Option<bool>,
    #[serde(default)]
    archived: Option<bool>,
    #[serde(rename = "archivedAt", default)]
    archived_at: Option<String>,
    #[serde(default)]
    deleted: Option<bool>,
    #[serde(rename = "deletedAt", default)]
    deleted_at: Option<String>,
}

const DATA_FILE_NAME: &str = "data.json";
const DB_FILE_NAME: &str = "snowbo.sqlite3";
const DATA_VERSION: u32 = 1;
const DB_SCHEMA_VERSION: u32 = 1;

/// 统一持久化：笔记元数据、临时会话、快捷键、AI、应用配置。
#[derive(Serialize, Deserialize, Clone)]
struct AppData {
    #[serde(default = "default_data_version")]
    version: u32,
    #[serde(default)]
    notes: Vec<NoteMeta>,
    #[serde(
        rename = "scratchSession",
        default,
        skip_serializing_if = "ScratchSessionStore::is_empty"
    )]
    scratch_session: ScratchSessionStore,
    #[serde(default)]
    shortcuts: ShortcutConfig,
    #[serde(default)]
    ai: AiConfig,
    #[serde(default)]
    app: AppConfig,
}

fn default_data_version() -> u32 {
    DATA_VERSION
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            version: DATA_VERSION,
            notes: Vec::new(),
            scratch_session: ScratchSessionStore::default(),
            shortcuts: ShortcutConfig::default(),
            ai: AiConfig::default(),
            app: AppConfig::default(),
        }
    }
}

/// 旧版 notes-index.json,仅用于迁移。
#[derive(Serialize, Deserialize, Clone, Default)]
struct NotesIndex {
    notes: Vec<NoteMeta>,
}

/// 旧版 notes.json 单文件结构,仅用于一次性迁移。
#[derive(Serialize, Deserialize, Clone)]
struct LegacyNote {
    id: String,
    title: String,
    cells: Vec<Cell>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "modifiedAt")]
    modified_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pinned: Option<bool>,
    #[serde(default)]
    archived: Option<bool>,
    #[serde(rename = "archivedAt", default)]
    archived_at: Option<String>,
    #[serde(default)]
    deleted: Option<bool>,
    #[serde(rename = "deletedAt", default)]
    deleted_at: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct ScratchSessionStore {
    cells: Vec<Cell>,
}

impl ScratchSessionStore {
    fn is_empty(&self) -> bool {
        self.cells.is_empty()
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct ShortcutConfig {
    #[serde(rename = "quickCopy", default = "default_quick_copy_shortcut")]
    quick_copy: String,
}

fn default_quick_copy_shortcut() -> String {
    "CmdOrCtrl+Shift+B".to_string()
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            quick_copy: default_quick_copy_shortcut(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct AiConfig {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "apiKey")]
    api_key: String,
    model: String,
    #[serde(rename = "systemPrompt")]
    system_prompt: String,
    // 最近使用过的 AI 指令(MRU,最多 5 条)。
    // 老配置文件可能写的是 instructionPresets(原 AI workshop 维护的预设),
    // alias 兼容读入,落盘时统一改写为 recentInstructions。
    #[serde(rename = "recentInstructions", alias = "instructionPresets", default)]
    recent_instructions: Vec<String>,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            system_prompt: default_ai_system_prompt(),
            recent_instructions: Vec::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct AppConfig {
    #[serde(rename = "editorFontSize", default = "default_editor_font_size")]
    editor_font_size: u8,
    #[serde(
        rename = "temporaryChatDisplayLimit",
        default = "default_temporary_chat_display_limit"
    )]
    temporary_chat_display_limit: u32,
    #[serde(
        rename = "clipboardHistoryLimit",
        default = "default_clipboard_history_limit"
    )]
    clipboard_history_limit: u32,
    #[serde(rename = "editorLineNumbers", default = "default_editor_line_numbers")]
    editor_line_numbers: bool,
    #[serde(
        rename = "quickCopyAnimations",
        default = "default_quick_copy_animations"
    )]
    quick_copy_animations: bool,
}

fn default_editor_line_numbers() -> bool {
    false
}

fn default_quick_copy_animations() -> bool {
    true
}

fn default_editor_font_size() -> u8 {
    12
}

fn default_temporary_chat_display_limit() -> u32 {
    20
}

const TEMPORARY_CHAT_DISPLAY_LIMIT_MIN: u32 = 0;
const TEMPORARY_CHAT_DISPLAY_LIMIT_MAX: u32 = 100;

fn clamp_temporary_chat_display_limit(limit: u32) -> u32 {
    limit.clamp(
        TEMPORARY_CHAT_DISPLAY_LIMIT_MIN,
        TEMPORARY_CHAT_DISPLAY_LIMIT_MAX,
    )
}

const DELETED_NOTES_RETENTION_LIMIT: usize = 5;

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            editor_font_size: default_editor_font_size(),
            temporary_chat_display_limit: default_temporary_chat_display_limit(),
            clipboard_history_limit: default_clipboard_history_limit(),
            editor_line_numbers: default_editor_line_numbers(),
            quick_copy_animations: default_quick_copy_animations(),
        }
    }
}

fn default_ai_system_prompt() -> String {
    // 关键约束:模型只输出"处理结果"本身,不要任何解释/前缀/markdown 代码块。
    // 这样回填到 cell 中的内容才是即开即用的。
    [
        "You are a precise text-processing assistant embedded inside a note cell.",
        "The user's cell content is a mix of data + an instruction. Detect the instruction (often the last natural-language sentence/line in Chinese or English) and apply it to the rest of the content.",
        "Output ONLY the processed result. Do not explain, do not apologize, do not greet, do not restate the task.",
        "Do not wrap the result in markdown code fences (```), quotes, or any prefix/suffix unless the user explicitly asks for them.",
        "If the result is a single value, output just that value with no surrounding whitespace or newline trailing.",
        "If the instruction is missing or you cannot perform it confidently, output the original content unchanged.",
    ]
    .join(" ")
}

// 复制文本到剪切板
#[command]
async fn copy_to_clipboard(
    app_handle: tauri::AppHandle,
    text: String,
    source: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;

    app_handle
        .clipboard()
        .write_text(text.clone())
        .map_err(|e| e.to_string())?;
    record_app_clipboard_write(&app_handle, text.clone());
    if source.as_deref() == Some("quick-copy") {
        if let Err(e) = system_notification::notify_clipboard_copied(&text) {
            eprintln!("[notification] failed to show clipboard notification: {e}");
        }
    }
    Ok(())
}

pub(crate) fn write_clipboard_text<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    text: &str,
) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(text.to_string())
        .map_err(|e| e.to_string())
}

fn get_app_dir() -> Result<PathBuf, String> {
    let app_dir = dirs::home_dir()
        .ok_or("Cannot find home directory")?
        .join(".snowbo-notebook");

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    Ok(app_dir)
}

fn get_data_path() -> Result<PathBuf, String> {
    Ok(get_app_dir()?.join(DATA_FILE_NAME))
}

fn get_db_path() -> Result<PathBuf, String> {
    Ok(get_app_dir()?.join(DB_FILE_NAME))
}

fn get_notes_dir() -> Result<PathBuf, String> {
    let dir = get_app_dir()?.join("notes");
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

fn get_legacy_notes_path() -> Result<PathBuf, String> {
    Ok(get_app_dir()?.join("notes.json"))
}

fn note_txt_path(id: &str) -> Result<PathBuf, String> {
    Ok(get_notes_dir()?.join(format!("{id}.txt")))
}

fn read_note_content(id: &str) -> Result<String, String> {
    let path = note_txt_path(id)?;
    if !path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn write_note_content(id: &str, content: &str) -> Result<(), String> {
    let path = note_txt_path(id)?;
    fs::write(path, content).map_err(|e| e.to_string())
}

fn normalize_ai_config(config: &mut AiConfig) {
    if config.system_prompt.trim().is_empty() {
        config.system_prompt = default_ai_system_prompt();
    }
    if config.base_url.trim().is_empty() {
        config.base_url = "https://api.openai.com/v1".to_string();
    }
}

fn normalize_app_config(config: &mut AppConfig) {
    config.editor_font_size = config.editor_font_size.clamp(10, 24);
    config.temporary_chat_display_limit =
        clamp_temporary_chat_display_limit(config.temporary_chat_display_limit);
    config.clipboard_history_limit = clamp_clipboard_history_limit(config.clipboard_history_limit);
}

fn normalize_shortcut_config(config: &mut ShortcutConfig) {
    config.quick_copy = config.quick_copy.trim().to_string();
}

fn normalize_app_data(data: &mut AppData) {
    data.version = DATA_VERSION;
    normalize_ai_config(&mut data.ai);
    normalize_app_config(&mut data.app);
    normalize_shortcut_config(&mut data.shortcuts);
}

fn archive_legacy_json(path: &PathBuf) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let backup = path.with_extension("json.bak");
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    storage_log(format!(
        "archiving legacy metadata file {} -> {}",
        path.display(),
        backup.display()
    ));
    fs::rename(path, backup).map_err(|e| e.to_string())
}

fn storage_log(message: impl AsRef<str>) {
    eprintln!("[storage] {}", message.as_ref());
}

fn open_metadata_db() -> Result<Connection, String> {
    let path = get_db_path()?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    migrate_db_schema(&conn)?;
    Ok(conn)
}

fn migrate_db_schema(conn: &Connection) -> Result<(), String> {
    let version: u32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|e| e.to_string())?;

    if version > DB_SCHEMA_VERSION {
        storage_log(format!(
            "metadata database schema v{version} is newer than this app supports (v{DB_SCHEMA_VERSION}); refusing to open for forward compatibility"
        ));
        return Err(format!(
            "metadata database schema v{version} is newer than this app supports (v{DB_SCHEMA_VERSION})"
        ));
    }

    if version == 0 {
        storage_log(format!(
            "initializing metadata database schema v{DB_SCHEMA_VERSION}"
        ));
        conn.execute_batch(
            "
            BEGIN;
            CREATE TABLE IF NOT EXISTS notes (
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
            CREATE INDEX IF NOT EXISTS idx_notes_deleted_position
                ON notes(deleted, position);
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );
            PRAGMA user_version = 1;
            COMMIT;
            ",
        )
        .map_err(|e| e.to_string())?;
        storage_log(format!(
            "metadata database schema initialized at v{DB_SCHEMA_VERSION}"
        ));
    } else if version < DB_SCHEMA_VERSION {
        storage_log(format!(
            "metadata database schema v{version} is older than app schema v{DB_SCHEMA_VERSION}; no migration step is defined for this version"
        ));
    }

    Ok(())
}

fn opt_bool_to_i64(value: Option<bool>) -> Option<i64> {
    value.map(|v| if v { 1 } else { 0 })
}

fn opt_i64_to_bool(value: Option<i64>) -> Option<bool> {
    value.map(|v| v != 0)
}

fn parse_state_json<T>(states: &HashMap<String, String>, key: &str) -> T
where
    T: for<'de> Deserialize<'de> + Default,
{
    states
        .get(key)
        .and_then(|raw| serde_json::from_str::<T>(raw).ok())
        .unwrap_or_default()
}

fn load_app_data_from_db() -> Result<AppData, String> {
    ensure_unified_data_migrated()?;
    let conn = open_metadata_db()?;
    load_app_data_from_db_without_migration(&conn)
}

fn load_app_data_from_db_without_migration(conn: &Connection) -> Result<AppData, String> {
    let mut notes_stmt = conn
        .prepare(
            "
            SELECT id, title, created_at, modified_at, pinned, archived, archived_at, deleted, deleted_at
            FROM notes
            ORDER BY position ASC, id ASC
            ",
        )
        .map_err(|e| e.to_string())?;
    let notes = notes_stmt
        .query_map([], |row| {
            Ok(NoteMeta {
                id: row.get(0)?,
                title: row.get(1)?,
                created_at: row.get(2)?,
                modified_at: row.get(3)?,
                pinned: opt_i64_to_bool(row.get(4)?),
                archived: opt_i64_to_bool(row.get(5)?),
                archived_at: row.get(6)?,
                deleted: opt_i64_to_bool(row.get(7)?),
                deleted_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut state_stmt = conn
        .prepare("SELECT key, value FROM app_state")
        .map_err(|e| e.to_string())?;
    let states = state_stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| e.to_string())?;

    let mut data = AppData {
        version: DATA_VERSION,
        notes,
        scratch_session: parse_state_json(&states, "scratchSession"),
        shortcuts: parse_state_json(&states, "shortcuts"),
        ai: parse_state_json(&states, "ai"),
        app: parse_state_json(&states, "app"),
    };
    normalize_app_data(&mut data);
    Ok(data)
}

fn save_app_data_to_db(data: &AppData) -> Result<(), String> {
    ensure_unified_data_migrated()?;
    let mut data = data.clone();
    normalize_app_data(&mut data);

    let mut conn = open_metadata_db()?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM notes", [])
        .map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "
                INSERT INTO notes (
                    id, title, created_at, modified_at, pinned, archived, archived_at, deleted, deleted_at, position
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ",
            )
            .map_err(|e| e.to_string())?;
        for (position, note) in data.notes.iter().enumerate() {
            stmt.execute(params![
                note.id,
                note.title,
                note.created_at,
                note.modified_at,
                opt_bool_to_i64(note.pinned),
                opt_bool_to_i64(note.archived),
                note.archived_at,
                opt_bool_to_i64(note.deleted),
                note.deleted_at,
                position as i64,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    let states = [
        (
            "scratchSession",
            serde_json::to_string(&data.scratch_session).map_err(|e| e.to_string())?,
        ),
        (
            "shortcuts",
            serde_json::to_string(&data.shortcuts).map_err(|e| e.to_string())?,
        ),
        (
            "ai",
            serde_json::to_string(&data.ai).map_err(|e| e.to_string())?,
        ),
        (
            "app",
            serde_json::to_string(&data.app).map_err(|e| e.to_string())?,
        ),
    ];
    for (key, value) in states {
        tx.execute(
            "INSERT INTO app_state(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())
}

fn is_metadata_db_empty(conn: &Connection) -> Result<bool, String> {
    let note_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let state_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM app_state", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    Ok(note_count == 0 && state_count == 0)
}

fn load_app_data_from_legacy_json() -> Result<Option<AppData>, String> {
    let path = get_data_path()?;
    if !path.exists() {
        return Ok(None);
    }
    storage_log(format!(
        "legacy unified metadata detected at {}; importing into SQLite",
        path.display()
    ));
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        storage_log("data.json is empty; archiving and importing default metadata");
        let _ = archive_legacy_json(&path);
        return Ok(Some(AppData::default()));
    }
    match serde_json::from_str::<AppData>(&raw) {
        Ok(mut data) => {
            normalize_app_data(&mut data);
            storage_log(format!(
                "imported data.json into SQLite candidate state: {} notes",
                data.notes.len()
            ));
            Ok(Some(data))
        }
        Err(e) => {
            storage_log(format!(
                "data.json is corrupt ({e}); archiving and importing default metadata"
            ));
            let _ = archive_legacy_json(&path);
            Ok(Some(AppData::default()))
        }
    }
}

fn load_app_data_sync() -> Result<AppData, String> {
    load_app_data_from_db()
}

fn save_app_data_sync(data: &AppData) -> Result<(), String> {
    save_app_data_to_db(data)
}

fn legacy_cells_to_content(cells: &[Cell]) -> String {
    cells
        .iter()
        .map(|c| c.content.as_str())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn ensure_unified_data_migrated() -> Result<(), String> {
    let conn = open_metadata_db()?;
    if is_metadata_db_empty(&conn)? {
        storage_log("metadata database is empty; checking legacy metadata sources");
        let mut data = if let Some(data) = load_app_data_from_legacy_json()? {
            data
        } else {
            migrate_fragment_json_to_unified_data()?
        };
        normalize_app_data(&mut data);
        save_app_data_to_db_without_migration(&conn, &data)?;
        storage_log(format!(
            "legacy metadata import committed to SQLite: {} notes",
            data.notes.len()
        ));

        let data_path = get_data_path()?;
        if data_path.exists() {
            archive_legacy_json(&data_path)?;
        }
    }
    drop(conn);
    migrate_legacy_notes_json_if_needed()?;
    Ok(())
}

fn save_app_data_to_db_without_migration(
    conn: &Connection,
    data: &AppData,
) -> Result<(), String> {
    let mut data = data.clone();
    normalize_app_data(&mut data);

    conn.execute("DELETE FROM notes", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM app_state", [])
        .map_err(|e| e.to_string())?;

    {
        let mut stmt = conn
            .prepare(
                "
                INSERT INTO notes (
                    id, title, created_at, modified_at, pinned, archived, archived_at, deleted, deleted_at, position
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                ",
            )
            .map_err(|e| e.to_string())?;
        for (position, note) in data.notes.iter().enumerate() {
            stmt.execute(params![
                &note.id,
                &note.title,
                &note.created_at,
                &note.modified_at,
                opt_bool_to_i64(note.pinned),
                opt_bool_to_i64(note.archived),
                &note.archived_at,
                opt_bool_to_i64(note.deleted),
                &note.deleted_at,
                position as i64,
            ])
            .map_err(|e| e.to_string())?;
        }
    }

    let states = [
        (
            "scratchSession",
            serde_json::to_string(&data.scratch_session).map_err(|e| e.to_string())?,
        ),
        (
            "shortcuts",
            serde_json::to_string(&data.shortcuts).map_err(|e| e.to_string())?,
        ),
        (
            "ai",
            serde_json::to_string(&data.ai).map_err(|e| e.to_string())?,
        ),
        (
            "app",
            serde_json::to_string(&data.app).map_err(|e| e.to_string())?,
        ),
    ];
    for (key, value) in states {
        conn.execute(
            "INSERT INTO app_state(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn migrate_fragment_json_to_unified_data() -> Result<AppData, String> {
    let app_dir = get_app_dir()?;
    let mut data = AppData::default();
    let mut imported_files: Vec<String> = Vec::new();

    let index_path = app_dir.join("notes-index.json");
    if index_path.exists() {
        storage_log(format!(
            "legacy notes index detected at {}; importing",
            index_path.display()
        ));
        if let Ok(raw) = fs::read_to_string(&index_path) {
            if let Ok(index) = serde_json::from_str::<NotesIndex>(&raw) {
                data.notes = index.notes;
                storage_log(format!(
                    "imported notes-index.json: {} note metadata entries",
                    data.notes.len()
                ));
            } else {
                storage_log("failed to parse notes-index.json; continuing with defaults");
            }
        } else {
            storage_log("failed to read notes-index.json; continuing with defaults");
        }
        imported_files.push(index_path.display().to_string());
        archive_legacy_json(&index_path)?;
    }

    let scratch_path = app_dir.join("scratch-session.json");
    if scratch_path.exists() {
        storage_log(format!(
            "legacy scratch session detected at {}; importing",
            scratch_path.display()
        ));
        if let Ok(raw) = fs::read_to_string(&scratch_path) {
            if let Ok(store) = serde_json::from_str::<ScratchSessionStore>(&raw) {
                let cell_count = store.cells.len();
                data.scratch_session = store;
                storage_log(format!(
                    "imported scratch-session.json: {cell_count} cells"
                ));
            } else {
                storage_log("failed to parse scratch-session.json; continuing with defaults");
            }
        } else {
            storage_log("failed to read scratch-session.json; continuing with defaults");
        }
        imported_files.push(scratch_path.display().to_string());
        archive_legacy_json(&scratch_path)?;
    }

    let shortcuts_path = app_dir.join("config.json");
    if shortcuts_path.exists() {
        storage_log(format!(
            "legacy shortcut config detected at {}; importing",
            shortcuts_path.display()
        ));
        if let Ok(raw) = fs::read_to_string(&shortcuts_path) {
            if let Ok(shortcuts) = serde_json::from_str::<ShortcutConfig>(&raw) {
                data.shortcuts = shortcuts;
                storage_log("imported config.json");
            } else {
                storage_log("failed to parse config.json; continuing with defaults");
            }
        } else {
            storage_log("failed to read config.json; continuing with defaults");
        }
        imported_files.push(shortcuts_path.display().to_string());
        archive_legacy_json(&shortcuts_path)?;
    }

    let ai_path = app_dir.join("ai-config.json");
    if ai_path.exists() {
        storage_log(format!(
            "legacy AI config detected at {}; importing",
            ai_path.display()
        ));
        if let Ok(raw) = fs::read_to_string(&ai_path) {
            if let Ok(ai) = serde_json::from_str::<AiConfig>(&raw) {
                data.ai = ai;
                storage_log("imported ai-config.json");
            } else {
                storage_log("failed to parse ai-config.json; continuing with defaults");
            }
        } else {
            storage_log("failed to read ai-config.json; continuing with defaults");
        }
        imported_files.push(ai_path.display().to_string());
        archive_legacy_json(&ai_path)?;
    }

    let app_config_path = app_dir.join("app-config.json");
    if app_config_path.exists() {
        storage_log(format!(
            "legacy app config detected at {}; importing",
            app_config_path.display()
        ));
        if let Ok(raw) = fs::read_to_string(&app_config_path) {
            if let Ok(app_cfg) = serde_json::from_str::<AppConfig>(&raw) {
                data.app = app_cfg;
                storage_log("imported app-config.json");
            } else {
                storage_log("failed to parse app-config.json; continuing with defaults");
            }
        } else {
            storage_log("failed to read app-config.json; continuing with defaults");
        }
        imported_files.push(app_config_path.display().to_string());
        archive_legacy_json(&app_config_path)?;
    }

    if imported_files.is_empty() {
        storage_log("no legacy fragmented metadata files found; using default metadata state");
    } else {
        storage_log(format!(
            "legacy fragmented metadata import completed from {} files",
            imported_files.len()
        ));
    }

    Ok(data)
}

fn migrate_legacy_notes_json_if_needed() -> Result<(), String> {
    let legacy_path = get_legacy_notes_path()?;
    if !legacy_path.exists() {
        return Ok(());
    }

    storage_log(format!(
        "legacy notes.json detected at {}; importing into SQLite metadata and note text files",
        legacy_path.display()
    ));
    let raw = fs::read_to_string(&legacy_path).map_err(|e| e.to_string())?;
    let legacy_notes: Vec<LegacyNote> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;

    let conn = open_metadata_db()?;
    let mut data = load_app_data_from_db_without_migration(&conn)?;
    let mut scratch_cells: Vec<Cell> = Vec::new();
    let mut imported_notes = 0usize;
    let mut skipped_notes = 0usize;

    for legacy in legacy_notes {
        if legacy.id == SCRATCH_SESSION_NOTE_ID {
            if data.scratch_session.cells.is_empty() {
                scratch_cells = legacy.cells;
            } else {
                skipped_notes += 1;
            }
            continue;
        }
        if legacy.id == "__raw_editor__" {
            skipped_notes += 1;
            continue;
        }
        if data.notes.iter().any(|m| m.id == legacy.id) {
            skipped_notes += 1;
            continue;
        }

        let content = legacy_cells_to_content(&legacy.cells);
        write_note_content(&legacy.id, &content)?;

        data.notes.push(NoteMeta {
            id: legacy.id,
            title: legacy.title,
            created_at: legacy.created_at,
            modified_at: legacy.modified_at,
            pinned: legacy.pinned,
            archived: legacy.archived,
            archived_at: legacy.archived_at,
            deleted: legacy.deleted,
            deleted_at: legacy.deleted_at,
        });
        imported_notes += 1;
    }

    if !scratch_cells.is_empty() && data.scratch_session.cells.is_empty() {
        storage_log(format!(
            "imported scratch session from notes.json: {} cells",
            scratch_cells.len()
        ));
        data.scratch_session.cells = scratch_cells;
    }

    save_app_data_to_db_without_migration(&conn, &data)?;
    storage_log(format!(
        "legacy notes.json import committed: {imported_notes} notes imported, {skipped_notes} entries skipped"
    ));

    let backup = get_app_dir()?.join("notes.json.bak");
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    storage_log(format!(
        "archiving legacy notes file {} -> {}",
        legacy_path.display(),
        backup.display()
    ));
    fs::rename(&legacy_path, backup).map_err(|e| e.to_string())?;
    Ok(())
}

fn meta_to_note(meta: &NoteMeta) -> Result<Note, String> {
    let content = read_note_content(&meta.id)?;
    Ok(Note {
        id: meta.id.clone(),
        title: meta.title.clone(),
        content,
        created_at: meta.created_at.clone(),
        modified_at: meta.modified_at.clone(),
        pinned: meta.pinned,
        archived: meta.archived,
        archived_at: meta.archived_at.clone(),
        deleted: meta.deleted,
        deleted_at: meta.deleted_at.clone(),
    })
}

fn note_to_meta(note: &Note) -> NoteMeta {
    NoteMeta {
        id: note.id.clone(),
        title: note.title.clone(),
        created_at: note.created_at.clone(),
        modified_at: note.modified_at.clone(),
        pinned: note.pinned,
        archived: note.archived,
        archived_at: note.archived_at.clone(),
        deleted: note.deleted,
        deleted_at: note.deleted_at.clone(),
    }
}

pub(crate) fn load_app_config_sync() -> AppConfig {
    load_app_data_sync()
        .map(|data| data.app)
        .unwrap_or_default()
}

/// quick-copy 弹窗用的「虚拟笔记」视图:把 txt 笔记合成单 cell,临时会话单独挂载。
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct LegacyNoteView {
    id: String,
    title: String,
    cells: Vec<Cell>,
    #[serde(rename = "createdAt")]
    created_at: String,
    #[serde(rename = "modifiedAt")]
    modified_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pinned: Option<bool>,
    #[serde(default)]
    pub(crate) archived: Option<bool>,
    #[serde(rename = "archivedAt", default)]
    archived_at: Option<String>,
    #[serde(default)]
    deleted: Option<bool>,
    #[serde(rename = "deletedAt", default)]
    deleted_at: Option<String>,
}

pub(crate) fn load_all_notes_sync() -> Result<Vec<LegacyNoteView>, String> {
    let data = load_app_data_sync()?;

    let views: Vec<LegacyNoteView> = data
        .notes
        .iter()
        .filter(|m| m.deleted != Some(true))
        .map(|meta| {
            let content = read_note_content(&meta.id).unwrap_or_default();
            let cell = Cell {
                id: format!("{}-cell", meta.id),
                mode: "text".to_string(),
                content,
                wrap: None,
            };
            LegacyNoteView {
                id: meta.id.clone(),
                title: meta.title.clone(),
                cells: vec![cell],
                created_at: meta.created_at.clone(),
                modified_at: meta.modified_at.clone(),
                pinned: meta.pinned,
                archived: meta.archived,
                archived_at: meta.archived_at.clone(),
                deleted: meta.deleted,
                deleted_at: meta.deleted_at.clone(),
            }
        })
        .collect();

    Ok(views)
}

/// 按前端传入的 active 笔记顺序重写 `data.notes`，已删除条目保留在末尾。
fn reorder_notes_meta(data: &mut AppData, active_notes: &[Note]) {
    let active_order: Vec<String> = active_notes
        .iter()
        .filter(|n| n.deleted != Some(true))
        .map(|n| n.id.clone())
        .collect();

    let deleted: Vec<NoteMeta> = data
        .notes
        .iter()
        .filter(|m| m.deleted == Some(true))
        .cloned()
        .collect();

    let mut by_id: HashMap<String, NoteMeta> =
        data.notes.drain(..).map(|m| (m.id.clone(), m)).collect();

    let mut reordered = Vec::with_capacity(by_id.len());
    for id in active_order {
        if let Some(meta) = by_id.remove(&id) {
            reordered.push(meta);
        }
    }
    for (_, meta) in by_id.drain().filter(|(_, m)| m.deleted != Some(true)) {
        reordered.push(meta);
    }
    reordered.extend(deleted);
    data.notes = reordered;
}

async fn save_all_notes(notes: Vec<Note>) -> Result<(), String> {
    let mut data = load_app_data_sync()?;

    for note in &notes {
        if note.deleted == Some(true) {
            if let Some(meta) = data.notes.iter_mut().find(|m| m.id == note.id) {
                meta.deleted = Some(true);
                meta.deleted_at = note.deleted_at.clone();
                meta.modified_at = note.modified_at.clone();
            } else {
                data.notes.push(note_to_meta(note));
            }
            continue;
        }

        write_note_content(&note.id, &note.content)?;
        if let Some(meta) = data.notes.iter_mut().find(|m| m.id == note.id) {
            *meta = note_to_meta(note);
        } else {
            data.notes.push(note_to_meta(note));
        }
    }

    reorder_notes_meta(&mut data, &notes);
    save_app_data_sync(&data)
}

#[command]
async fn load_notes() -> Result<Vec<Note>, String> {
    let data = load_app_data_sync()?;
    let active: Vec<Note> = data
        .notes
        .iter()
        .filter(|m| m.deleted != Some(true))
        .map(meta_to_note)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(active)
}

#[command]
async fn save_notes(notes: Vec<Note>) -> Result<(), String> {
    save_all_notes(notes).await
}

#[command]
async fn create_note(title: String, content: Option<String>) -> Result<Note, String> {
    let now = Utc::now().to_rfc3339();
    let id = Uuid::new_v4().to_string();
    let body = content.unwrap_or_default();
    write_note_content(&id, &body)?;

    let note = Note {
        id: id.clone(),
        title,
        content: body,
        created_at: now.clone(),
        modified_at: now,
        pinned: None,
        archived: None,
        archived_at: None,
        deleted: None,
        deleted_at: None,
    };

    let mut data = load_app_data_sync()?;
    data.notes.push(note_to_meta(&note));
    save_app_data_sync(&data)?;

    Ok(note)
}

#[command]
async fn update_note(note: Note) -> Result<(), String> {
    save_all_notes(vec![note]).await
}

#[command]
async fn delete_note(id: String) -> Result<(), String> {
    if id == SCRATCH_SESSION_NOTE_ID {
        return Err("cannot delete system notebook".to_string());
    }
    let mut data = load_app_data_sync()?;

    let now = Utc::now().to_rfc3339();
    let Some(meta) = data.notes.iter_mut().find(|m| m.id == id) else {
        return Err("Note not found".to_string());
    };

    meta.deleted = Some(true);
    meta.deleted_at = Some(now.clone());
    meta.modified_at = now;

    prune_excess_deleted_notes(&mut data.notes);
    save_app_data_sync(&data)
}

/// 软删除最多保留 DELETED_NOTES_RETENTION_LIMIT 条;超出时按 deletedAt 永久删除最旧的。
fn prune_excess_deleted_notes(notes: &mut Vec<NoteMeta>) {
    let mut deleted: Vec<(String, String)> = notes
        .iter()
        .filter(|n| n.deleted == Some(true))
        .map(|n| (n.id.clone(), n.deleted_at.clone().unwrap_or_default()))
        .collect();

    if deleted.len() <= DELETED_NOTES_RETENTION_LIMIT {
        return;
    }

    deleted.sort_by(|a, b| a.1.cmp(&b.1));

    let excess = deleted.len() - DELETED_NOTES_RETENTION_LIMIT;
    let ids_to_remove: std::collections::HashSet<String> =
        deleted.into_iter().take(excess).map(|(id, _)| id).collect();

    notes.retain(|n| !ids_to_remove.contains(&n.id));
    for id in ids_to_remove {
        if let Ok(path) = note_txt_path(&id) {
            let _ = fs::remove_file(path);
        }
    }
}

#[command]
async fn get_storage_path() -> Result<String, String> {
    let path = get_app_dir()?;
    Ok(path.to_string_lossy().to_string())
}

#[command]
async fn get_note_file_path(id: String) -> Result<String, String> {
    let path = note_txt_path(&id)?;
    Ok(path.to_string_lossy().to_string())
}

#[command]
async fn reveal_note_file(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = note_txt_path(&id)?;
    if !path.exists() {
        return Err(format!("笔记文件不存在: {}", path.display()));
    }
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}

#[command]
async fn reveal_path_in_dir(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("文件不存在: {path}"));
    }
    app.opener()
        .reveal_item_in_dir(path_buf)
        .map_err(|e| e.to_string())
}

#[command]
async fn get_deleted_notes() -> Result<Vec<Note>, String> {
    let data = load_app_data_sync()?;

    let mut deleted_notes: Vec<Note> = data
        .notes
        .iter()
        .filter(|m| m.deleted == Some(true))
        .map(meta_to_note)
        .collect::<Result<Vec<_>, _>>()?;

    deleted_notes.sort_by(|a, b| match (&a.deleted_at, &b.deleted_at) {
        (Some(a_time), Some(b_time)) => b_time.cmp(a_time),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    Ok(deleted_notes)
}

#[command]
async fn restore_note(id: String) -> Result<(), String> {
    let mut data = load_app_data_sync()?;

    let Some(meta) = data
        .notes
        .iter_mut()
        .find(|m| m.id == id && m.deleted == Some(true))
    else {
        return Err("Note not found or not deleted".to_string());
    };

    meta.deleted = None;
    meta.deleted_at = None;
    meta.archived = None;
    meta.archived_at = None;
    meta.modified_at = Utc::now().to_rfc3339();
    save_app_data_sync(&data)
}

// 加载快捷键配置
#[command]
async fn load_shortcut_config() -> Result<ShortcutConfig, String> {
    Ok(load_app_data_sync()?.shortcuts)
}

// 保存快捷键配置
#[command]
async fn save_shortcut_config(config: ShortcutConfig) -> Result<(), String> {
    let mut data = load_app_data_sync()?;
    data.shortcuts = config;
    save_app_data_sync(&data)
}

// 加载 AI 配置
#[command]
async fn load_ai_config() -> Result<AiConfig, String> {
    Ok(load_app_data_sync()?.ai)
}

// 保存 AI 配置
#[command]
async fn save_ai_config(config: AiConfig) -> Result<(), String> {
    let mut data = load_app_data_sync()?;
    data.ai = config;
    save_app_data_sync(&data)
}

// 加载应用配置(编辑器字号等)
#[command]
async fn load_app_config() -> Result<AppConfig, String> {
    Ok(load_app_data_sync()?.app)
}

// 保存应用配置
#[command]
async fn save_app_config(app_handle: tauri::AppHandle, config: AppConfig) -> Result<(), String> {
    let mut config = config;
    normalize_app_config(&mut config);
    apply_clipboard_history_limit_from_config(&app_handle, config.clipboard_history_limit);

    let mut data = load_app_data_sync()?;
    data.app = config;
    save_app_data_sync(&data)
}

#[command]
async fn set_window_always_on_top(
    app_handle: tauri::AppHandle,
    always_on_top: bool,
) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("main") {
        window
            .set_always_on_top(always_on_top)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 片段行首标记：`//` 为 metadata / alias / tag，`@@` 为 AI 指令，均不进入复制正文；正文内 `$$` 为快捷替换占位符。
pub(crate) struct SegmentMarkers {
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub prompts: Vec<String>,
    pub has_args_placeholder: bool,
    pub body: String,
}

pub(crate) fn split_segment_markers(content: &str) -> SegmentMarkers {
    let mut title: Option<String> = None;
    let mut tags: Vec<String> = Vec::new();
    let mut prompts: Vec<String> = Vec::new();
    let mut body_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        let trimmed_start = line.trim_start();
        if trimmed_start.starts_with("//") {
            let meta = trimmed_start[2..].trim_start();
            let lower = meta.to_ascii_lowercase();
            if lower.starts_with("title:") || lower.starts_with("name:") {
                if let Some((_, value)) = meta.split_once(':') {
                    let value = value.trim();
                    if !value.is_empty() {
                        title = Some(value.to_string());
                    }
                }
            } else if lower.starts_with("tag:") || lower.starts_with("tags:") {
                if let Some((_, value)) = meta.split_once(':') {
                    for tag in value.split(|c: char| c == ',' || c.is_whitespace()) {
                        let tag = tag.trim();
                        if !tag.is_empty() {
                            tags.push(tag.to_string());
                        }
                    }
                }
            } else if !meta.is_empty() {
                tags.push(meta.to_string());
            }
        } else if trimmed_start.starts_with("@@") {
            let prompt = trimmed_start[2..].trim_start();
            if !prompt.is_empty() {
                prompts.push(prompt.to_string());
            }
        } else {
            body_lines.push(line);
        }
    }

    let body = body_lines.join("\n");
    let has_args_placeholder = body.contains("$$");

    SegmentMarkers {
        title,
        tags,
        prompts,
        has_args_placeholder,
        body,
    }
}

/// 行首(允许前导空白)为 `//` 的视为 metadata / alias / tag，不进入复制正文。
pub(crate) fn split_segment_comments(content: &str) -> (Vec<String>, String) {
    let markers = split_segment_markers(content);
    (markers.tags, markers.body)
}

/// 按独立成行且仅含 `--` 的分隔线切分笔记正文(quick-copy 弹窗用)。
pub(crate) fn split_content_by_dash_separator(content: &str) -> Vec<String> {
    let mut segments: Vec<String> = Vec::new();
    let mut chunk: Vec<&str> = Vec::new();

    for line in content.lines() {
        if line.trim() == "--" {
            let segment = chunk.join("\n");
            if !segment.trim().is_empty() {
                segments.push(segment);
            }
            chunk.clear();
        } else {
            chunk.push(line);
        }
    }

    let segment = chunk.join("\n");
    if !segment.trim().is_empty() {
        segments.push(segment);
    }

    segments
}

/// 取片段正文首行作为菜单项标签;超长由前端渐变遮罩处理。
pub(crate) fn cell_label(content: &str) -> String {
    let first_line = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    let trimmed = first_line.trim();
    if trimmed.is_empty() {
        return "(空)".to_string();
    }
    trimmed.replace('\t', " ")
}

/// 单条快捷键注册结果，回传给前端用于在 UI 里提示用户改键。
/// `ok=false` 时 `error` 描述具体冲突原因。
#[derive(Serialize, Deserialize, Clone)]
struct ShortcutRegistration {
    name: String,        // "quickCopy"
    accelerator: String, // 用户配置的加速键字符串
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// 注册全局快捷键
#[command]
async fn register_global_shortcuts(
    app_handle: tauri::AppHandle,
) -> Result<Vec<ShortcutRegistration>, String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

    // 重新注册前确保旧的快捷键被清掉,否则同一进程内多次调用会失败
    let _ = app_handle.global_shortcut().unregister_all();

    let config = load_shortcut_config().await?;
    let mut results: Vec<ShortcutRegistration> = Vec::with_capacity(1);
    let quick_copy_accelerator = config.quick_copy.trim().to_string();

    if quick_copy_accelerator.is_empty() {
        results.push(ShortcutRegistration {
            name: "quickCopy".into(),
            accelerator: String::new(),
            ok: true,
            error: None,
        });
        return Ok(results);
    }

    match quick_copy_accelerator.parse::<Shortcut>() {
        Ok(copy_shortcut) => {
            let r = app_handle.global_shortcut().on_shortcut(
                copy_shortcut,
                move |app, _shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if let Err(e) = open_quick_copy_menu(app) {
                        eprintln!("[QuickCopy] failed to open menu: {}", e);
                    }
                },
            );
            match r {
                Ok(_) => results.push(ShortcutRegistration {
                    name: "quickCopy".into(),
                    accelerator: quick_copy_accelerator.clone(),
                    ok: true,
                    error: None,
                }),
                Err(e) => {
                    eprintln!("[Shortcut] quickCopy registration failed: {}", e);
                    results.push(ShortcutRegistration {
                        name: "quickCopy".into(),
                        accelerator: quick_copy_accelerator.clone(),
                        ok: false,
                        error: Some(e.to_string()),
                    });
                }
            }
        }
        Err(e) => results.push(ShortcutRegistration {
            name: "quickCopy".into(),
            accelerator: quick_copy_accelerator,
            ok: false,
            error: Some(format!("Invalid copy shortcut: {}", e)),
        }),
    }

    Ok(results)
}

// 注销全局快捷键
#[command]
async fn unregister_global_shortcuts(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    app_handle
        .global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    let builder = {
        #[cfg(target_os = "macos")]
        {
            tauri::Builder::default().plugin(tauri_nspanel::init())
        }
        #[cfg(not(target_os = "macos"))]
        {
            tauri::Builder::default()
        }
    };

    builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(QuickCopyClipboard::default())
        .manage(QuickCopyHostState::default())
        .setup(|app| {
            init_clipboard_history(app.handle());
            // 启动时预创建 quick-copy 窗口(隐藏),让 webview 提前加载,缩短首次唤出等待。
            if let Err(e) = ensure_quick_copy_window(app.handle()) {
                eprintln!("[QuickCopy] failed to pre-create window: {}", e);
            }

            // 创建系统托盘菜单
            let show_item = tauri::menu::MenuItemBuilder::with_id("show_main", "显示主窗口").build(app)?;
            let quit_item = tauri::menu::MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = tauri::menu::MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = tauri::tray::TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .tooltip("Snowbo Snippets")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show_main" => {
                            let _ = activate_main_window(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::DoubleClick { .. } = event {
                        let app = tray.app_handle().clone();
                        let _ = activate_main_window(&app);
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                {
                    let _ = window.app_handle().hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_notes,
            save_notes,
            create_note,
            update_note,
            delete_note,
            get_storage_path,
            get_note_file_path,
            reveal_note_file,
            reveal_path_in_dir,
            get_deleted_notes,
            restore_note,
            set_window_always_on_top,
            load_shortcut_config,
            save_shortcut_config,
            load_ai_config,
            save_ai_config,
            load_app_config,
            save_app_config,
            register_global_shortcuts,
            unregister_global_shortcuts,
            copy_to_clipboard,
            quick_copy_host_ready,
            quick_copy_select,
            quick_copy_pin_item,
            quick_copy_unpin_item,
            hide_quick_copy_menu,
            show_main_window,
            show_main_window_for_note
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows && !is_presented(&app_handle) {
                    let _ = activate_main_window(&app_handle);
                }
            }
        });
}
