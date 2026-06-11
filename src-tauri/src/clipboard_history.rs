//! 系统剪切板历史：后台轮询、MRU 去重、按配置条数截断。
//! 仅保存纯文本，不保存图片或其他文件内容。
//! 持久化在独立文件 `clipboard-history.json`，避免与 `data.json` 笔记元数据互相覆盖。

use crate::load_app_config_sync;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const CLIPBOARD_HISTORY_FILE_NAME: &str = "clipboard-history.json";
const DEFAULT_CLIPBOARD_HISTORY_LIMIT: usize = 20;
const CLIPBOARD_POLL_INTERVAL_MS: u64 = 500;

#[derive(Serialize, Deserialize, Clone, Default)]
struct ClipboardHistoryFile {
    #[serde(default)]
    entries: Vec<String>,
}

/// 运行时剪切板历史；`skip_next` 用于忽略应用自身写入触发的变更。
pub struct ClipboardHistoryState {
    entries: Mutex<Vec<String>>,
    skip_next: Mutex<Option<String>>,
    limit: Mutex<usize>,
}

impl ClipboardHistoryState {
    pub fn new(limit: usize, entries: Vec<String>) -> Self {
        let mut entries = entries;
        entries.truncate(limit);
        Self {
            entries: Mutex::new(entries),
            skip_next: Mutex::new(None),
            limit: Mutex::new(limit),
        }
    }
}

pub(crate) fn default_clipboard_history_limit() -> u32 {
    20
}

pub(crate) const CLIPBOARD_HISTORY_LIMIT_MIN: u32 = 1;
pub(crate) const CLIPBOARD_HISTORY_LIMIT_MAX: u32 = 100;

pub(crate) fn clamp_clipboard_history_limit(limit: u32) -> u32 {
    limit.clamp(CLIPBOARD_HISTORY_LIMIT_MIN, CLIPBOARD_HISTORY_LIMIT_MAX)
}

fn clipboard_history_path() -> Result<PathBuf, String> {
  Ok(
    dirs::home_dir()
      .ok_or("Cannot find home directory")?
      .join(".snowbo-notebook")
      .join(CLIPBOARD_HISTORY_FILE_NAME),
  )
}

fn load_clipboard_history_from_disk() -> Vec<String> {
    let path = match clipboard_history_path() {
        Ok(path) => path,
        Err(e) => {
            eprintln!("[clipboard] failed to resolve history path: {e}");
            return Vec::new();
        }
    };
    if !path.exists() {
        return Vec::new();
    }
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) => {
            eprintln!("[clipboard] failed to read history file: {e}");
            return Vec::new();
        }
    };
    match serde_json::from_str::<ClipboardHistoryFile>(&raw) {
        Ok(file) => file.entries,
        Err(e) => {
            eprintln!("[clipboard] failed to parse history file: {e}");
            Vec::new()
        }
    }
}

fn persist_clipboard_history_entries(entries: &[String]) {
    let path = match clipboard_history_path() {
        Ok(path) => path,
        Err(e) => {
            eprintln!("[clipboard] failed to resolve history path: {e}");
            return;
        }
    };
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            eprintln!("[clipboard] failed to create history dir: {e}");
            return;
        }
    }
    let file = ClipboardHistoryFile {
        entries: entries.to_vec(),
    };
    let json = match serde_json::to_string_pretty(&file) {
        Ok(json) => json,
        Err(e) => {
            eprintln!("[clipboard] failed to serialize history: {e}");
            return;
        }
    };
    let tmp = path.with_extension("json.tmp");
    if let Err(e) = fs::write(&tmp, json) {
        eprintln!("[clipboard] failed to write history tmp: {e}");
        return;
    }
    if let Err(e) = fs::rename(&tmp, &path) {
        eprintln!("[clipboard] failed to finalize history file: {e}");
    }
}

fn clipboard_history_limit(state: &ClipboardHistoryState) -> usize {
    state
        .limit
        .lock()
        .map(|guard| *guard)
        .unwrap_or(DEFAULT_CLIPBOARD_HISTORY_LIMIT)
}

pub(crate) fn set_clipboard_history_limit(state: &ClipboardHistoryState, limit: usize) {
    if let Ok(mut guard) = state.limit.lock() {
        *guard = limit;
    }
    let snapshot = if let Ok(mut entries) = state.entries.lock() {
        entries.truncate(limit);
        entries.clone()
    } else {
        return;
    };
    persist_clipboard_history_entries(&snapshot);
}

fn should_record_entry(text: &str) -> bool {
    !text.trim().is_empty()
}

pub(crate) fn push_clipboard_history(state: &ClipboardHistoryState, text: String) -> bool {
    if !should_record_entry(&text) {
        return false;
    }

    let snapshot = {
        let mut entries = match state.entries.lock() {
            Ok(guard) => guard,
            Err(_) => return false,
        };
        entries.retain(|e| e != &text);
        entries.insert(0, text);
        entries.truncate(clipboard_history_limit(state));
        entries.clone()
    };

    persist_clipboard_history_entries(&snapshot);
    true
}

pub(crate) fn mark_clipboard_write_from_app(state: &ClipboardHistoryState, text: &str) {
    if let Ok(mut skip) = state.skip_next.lock() {
        *skip = Some(text.to_string());
    }
}

pub(crate) fn clipboard_history_entries(state: &ClipboardHistoryState) -> Vec<String> {
    state
        .entries
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

pub(crate) fn history_label(text: &str) -> String {
    crate::cell_label(text)
}

fn read_clipboard_text<R: tauri::Runtime>(
    clipboard: &tauri_plugin_clipboard_manager::Clipboard<R>,
) -> Option<String> {
    if let Ok(text) = clipboard.read_text() {
        if !text.trim().is_empty() {
            return Some(text);
        }
    }
    None
}

pub(crate) fn start_clipboard_watcher(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        use tauri_plugin_clipboard_manager::ClipboardExt;

        let mut last_seen: Option<String> = read_clipboard_text(app.clipboard());
        loop {
            std::thread::sleep(Duration::from_millis(CLIPBOARD_POLL_INTERVAL_MS));

            let current = match read_clipboard_text(app.clipboard()) {
                Some(c) => c,
                None => continue,
            };

            if last_seen.as_ref() == Some(&current) {
                continue;
            }
            last_seen = Some(current.clone());

            let Some(history) = app.try_state::<ClipboardHistoryState>() else {
                continue;
            };

            if let Ok(mut skip) = history.skip_next.lock() {
                if skip.as_ref() == Some(&current) {
                    *skip = None;
                    continue;
                }
            }

            push_clipboard_history(history.inner(), current);
        }
    });
}

pub(crate) fn init_clipboard_history(app: &tauri::AppHandle) {
    let config = load_app_config_sync();
    let limit = clamp_clipboard_history_limit(config.clipboard_history_limit) as usize;
    let entries = load_clipboard_history_from_disk();
    app.manage(ClipboardHistoryState::new(limit, entries));
    start_clipboard_watcher(app.clone());
}

pub(crate) fn apply_clipboard_history_limit_from_config<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    limit: u32,
) {
    let limit = clamp_clipboard_history_limit(limit) as usize;
    if let Some(history) = app.try_state::<ClipboardHistoryState>() {
        set_clipboard_history_limit(history.inner(), limit);
    }
}

pub(crate) fn record_app_clipboard_write<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    text: String,
) {
    if let Some(history) = app.try_state::<ClipboardHistoryState>() {
        mark_clipboard_write_from_app(history.inner(), &text);
        push_clipboard_history(history.inner(), text);
    }
}

pub(crate) fn write_clipboard_text_with_history<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    text: &str,
) -> Result<(), String> {
    record_app_clipboard_write(app, text.to_string());
    crate::write_clipboard_text(app, text)
}
