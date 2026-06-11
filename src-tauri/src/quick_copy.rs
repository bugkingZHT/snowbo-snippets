//! Quick-copy 浮动面板：独立于主窗口的生命周期与展示逻辑。
//! macOS 上通过 NSPanel + non-activating 样式，避免唤出面板时连带激活主窗口（参考 Maccy）。

use crate::{
    cell_label,
    clipboard_history::{clipboard_history_entries, history_label, write_clipboard_text_with_history},
    load_all_notes_sync, split_content_by_dash_separator, split_segment_markers, Cell,
    system_notification, LegacyNoteView,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::command;
use tauri::{Emitter, Manager, Position, Size, WebviewUrl, WebviewWindowBuilder};

const QUICK_COPY_WINDOW_LABEL: &str = "quick-copy";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickCopyMenuItemDto {
    id: String,
    label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    original_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pin_id: Option<String>,
    #[serde(default)]
    pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    note_title: Option<String>,
    source: String,
    /// 片段完整正文(含 `//` `@@` 行)。
    content: String,
    /// 复制用正文(已去掉 `//` `@@` 行)。
    body: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    prompts: Vec<String>,
    #[serde(default)]
    has_args_placeholder: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuickCopyNoteGroupDto {
    note_id: String,
    title: String,
    items: Vec<QuickCopyMenuItemDto>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuickCopyMenuPayload {
    pinned: Vec<QuickCopyMenuItemDto>,
    notes: Vec<QuickCopyNoteGroupDto>,
    recent: Vec<QuickCopyMenuItemDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    empty_message: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuickCopyOpenEvent {
    menu: QuickCopyMenuPayload,
    default_selected_id: Option<String>,
}

/// 缓存最近一次弹出的快捷复制菜单项 ID -> 待拷贝内容。
#[derive(Default)]
pub struct QuickCopyClipboard(pub(crate) Mutex<HashMap<String, String>>);

#[derive(Default)]
pub struct QuickCopyHostState {
    ready: Mutex<bool>,
    pending: Mutex<Option<QuickCopyOpenEvent>>,
    /// 打开 quick-copy 前主窗口是否可见;关闭时决定是否保持主窗口隐藏。
    main_was_visible_before_open: Mutex<bool>,
    is_presented: Mutex<bool>,
    #[cfg(target_os = "macos")]
    panel_configured: Mutex<bool>,
}

fn quick_copy_pins_path() -> Result<PathBuf, String> {
    let app_dir = dirs::home_dir()
        .ok_or("Cannot find home directory")?
        .join(".snowbo-notebook");
    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }
    Ok(app_dir.join("quick-copy-pins.json"))
}

fn load_quick_copy_pins() -> Result<Vec<QuickCopyMenuItemDto>, String> {
    let path = quick_copy_pins_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    match serde_json::from_str::<Vec<QuickCopyMenuItemDto>>(&raw) {
        Ok(items) => Ok(items),
        Err(e) => {
            eprintln!("[QuickCopy] quick-copy-pins.json is corrupt, ignoring: {e}");
            Ok(Vec::new())
        }
    }
}

fn save_quick_copy_pins(items: &[QuickCopyMenuItemDto]) -> Result<(), String> {
    let path = quick_copy_pins_path()?;
    let json = serde_json::to_string_pretty(items).map_err(|e| e.to_string())?;
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())
}

fn quick_copy_pin_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}")
}

fn normalize_pinned_item(mut item: QuickCopyMenuItemDto, pin_id: String) -> QuickCopyMenuItemDto {
    item.id = format!("copy::pinned::{pin_id}");
    item.pin_id = Some(pin_id);
    item.pinned = true;
    item.source = "pinned".to_string();
    item
}

pub fn is_presented(app: &tauri::AppHandle) -> bool {
    app.try_state::<QuickCopyHostState>()
        .and_then(|host| host.is_presented.lock().ok().map(|guard| *guard))
        .unwrap_or(false)
}

fn set_presented(app: &tauri::AppHandle, presented: bool) {
    if let Some(host) = app.try_state::<QuickCopyHostState>() {
        if let Ok(mut guard) = host.is_presented.lock() {
            *guard = presented;
        }
    }
}

fn get_global_mouse_physical() -> (i32, i32) {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSEvent, NSScreen};
        use objc2_foundation::MainThreadMarker;

        let Some(mtm) = MainThreadMarker::new() else {
            return (0, 0);
        };
        let point = NSEvent::mouseLocation();
        let screen_height = NSScreen::mainScreen(mtm)
            .map(|screen| screen.frame().size.height)
            .unwrap_or(0.0) as i32;
        (
            point.x.round() as i32,
            (screen_height as f64 - point.y).round() as i32,
        )
    }
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        struct POINT {
            x: i32,
            y: i32,
        }
        #[link(name = "user32")]
        extern "system" {
            fn GetCursorPos(lpPoint: *mut POINT) -> i32;
        }
        let mut pt = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut pt);
        }
        (pt.x, pt.y)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        (0, 0)
    }
}

fn note_title_or_default(title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

fn push_split_cell_items(
    clipboard: &QuickCopyClipboard,
    items: &mut Vec<QuickCopyMenuItemDto>,
    note_id: &str,
    note_title: &str,
    cell: &Cell,
) -> Result<(), String> {
    let segments = split_content_by_dash_separator(&cell.content);
    for (idx, segment) in segments.into_iter().enumerate() {
        let markers = split_segment_markers(&segment);
        if markers.body.trim().is_empty()
            && markers.tags.is_empty()
            && markers.prompts.is_empty()
            && !markers.has_args_placeholder
        {
            continue;
        }
        let id = format!("copy::{note_id}::{}::{idx}", cell.id);
        {
            let mut map = clipboard.0.lock().map_err(|e| e.to_string())?;
            map.insert(id.clone(), markers.body.clone());
        }
        items.push(QuickCopyMenuItemDto {
            original_id: Some(id.clone()),
            id,
            label: markers
                .title
                .clone()
                .unwrap_or_else(|| cell_label(&markers.body)),
            pin_id: None,
            pinned: false,
            note_title: Some(note_title.to_string()),
            source: "note".to_string(),
            content: segment,
            body: markers.body,
            tags: markers.tags,
            prompts: markers.prompts,
            has_args_placeholder: markers.has_args_placeholder,
        });
    }
    Ok(())
}

fn build_quick_copy_menu(app: &tauri::AppHandle) -> Result<QuickCopyMenuPayload, String> {
    let all_notes: Vec<LegacyNoteView> = load_all_notes_sync()?
        .into_iter()
        .filter(|n| n.deleted != Some(true) && n.archived != Some(true))
        .collect();

    let note_entries: Vec<(&LegacyNoteView, Vec<&Cell>)> = all_notes
        .iter()
        .map(|n| {
            let cells: Vec<&Cell> = n
                .cells
                .iter()
                .filter(|c| !c.content.trim().is_empty())
                .collect();
            (n, cells)
        })
        .filter(|(_, cells)| !cells.is_empty())
        .collect();

    let history_entries = app
        .try_state::<crate::clipboard_history::ClipboardHistoryState>()
        .map(|history| clipboard_history_entries(history.inner()))
        .unwrap_or_default();

    let state = app.state::<QuickCopyClipboard>();
    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        map.clear();
    }

    let mut pinned = load_quick_copy_pins()?;
    {
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        for item in pinned.iter_mut() {
            if let Some(pin_id) = item.pin_id.clone() {
                item.id = format!("copy::pinned::{pin_id}");
            }
            item.pinned = true;
            item.source = "pinned".to_string();
            map.insert(item.id.clone(), item.body.clone());
        }
    }

    let mut notes = Vec::new();
    for (note, cells) in note_entries.iter() {
        let mut items = Vec::new();
        for cell in cells.iter() {
            push_split_cell_items(
                &state,
                &mut items,
                &note.id,
                &note_title_or_default(&note.title),
                cell,
            )?;
        }
        if items.is_empty() {
            continue;
        }
        notes.push(QuickCopyNoteGroupDto {
            note_id: note.id.clone(),
            title: note_title_or_default(&note.title),
            items,
        });
    }

    let mut recent = Vec::new();
    for (index, text) in history_entries.iter().enumerate() {
        let id = format!("copy::history::{index}");
        let label = history_label(text);
        {
            let mut map = state.0.lock().map_err(|e| e.to_string())?;
            map.insert(id.clone(), text.clone());
        }
        recent.push(QuickCopyMenuItemDto {
            original_id: Some(id.clone()),
            id,
            label,
            pin_id: None,
            pinned: false,
            note_title: None,
            source: "history".to_string(),
            content: text.clone(),
            body: text.clone(),
            tags: vec![],
            prompts: vec![],
            has_args_placeholder: false,
        });
    }

    let is_empty = pinned.is_empty() && note_entries.is_empty() && history_entries.is_empty();

    Ok(QuickCopyMenuPayload {
        pinned,
        notes,
        recent,
        empty_message: if is_empty {
            Some("没有可用片段".to_string())
        } else {
            None
        },
    })
}

fn quick_copy_webview_url(app: &tauri::AppHandle) -> WebviewUrl {
    if cfg!(debug_assertions) {
        let dev_url = app.config().build.dev_url.clone().unwrap_or_else(|| {
            "http://localhost:3000"
                .parse()
                .expect("invalid default dev url")
        });
        WebviewUrl::External(
            format!("{}/quick-copy", dev_url)
                .parse()
                .expect("invalid quick-copy dev url"),
        )
    } else {
        WebviewUrl::App("/quick-copy".into())
    }
}

#[cfg(target_os = "macos")]
fn configure_quick_copy_panel(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    use tauri_nspanel::{cocoa::appkit::NSWindowCollectionBehavior, WebviewWindowExt};

    let host = app.state::<QuickCopyHostState>();
    {
        let configured = host
            .panel_configured
            .lock()
            .map_err(|e| e.to_string())?;
        if *configured {
            return Ok(());
        }
    }

    let panel = window.to_panel().map_err(|e| format!("{e:?}"))?;

    #[allow(non_upper_case_globals)]
    const NSFloatWindowLevel: i32 = 4;
    #[allow(non_upper_case_globals)]
    const NSWindowStyleMaskNonActivatingPanel: i32 = 1 << 7;

    panel.set_level(NSFloatWindowLevel);
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);
    panel.set_collection_behaviour(
        NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehavior::NSWindowCollectionBehaviorStationary,
    );

    // 关闭逻辑由前端 pointer/Escape 与 Rust hide 命令处理。
    // resign_key 回调里再 order_out 会与 hide 重入，导致闪退。

    *host
        .panel_configured
        .lock()
        .map_err(|e| e.to_string())? = true;
    Ok(())
}

pub fn ensure_quick_copy_window(app: &tauri::AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(QUICK_COPY_WINDOW_LABEL) {
        return Ok(window);
    }

    let window = WebviewWindowBuilder::new(app, QUICK_COPY_WINDOW_LABEL, quick_copy_webview_url(app))
        .title("Quick Copy")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .resizable(false)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    configure_quick_copy_panel(app, &window)?;

    Ok(window)
}

fn hide_quick_copy_surface(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(QUICK_COPY_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

fn show_quick_copy_surface(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_nspanel::ManagerExt;
        let panel = app
            .get_webview_panel(QUICK_COPY_WINDOW_LABEL)
            .map_err(|e| format!("{e:?}"))?;
        panel.show();
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let window = app
            .get_webview_window(QUICK_COPY_WINDOW_LABEL)
            .ok_or("quick-copy window not found")?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn dismiss_quick_copy_ui(app: &tauri::AppHandle) {
    if !is_presented(app) {
        return;
    }
    set_presented(app, false);

    if let Some(host) = app.try_state::<QuickCopyHostState>() {
        if let Ok(mut pending) = host.pending.lock() {
            *pending = None;
        }
    }

    hide_quick_copy_surface(app);
    let _ = app.emit_to(QUICK_COPY_WINDOW_LABEL, "quick-copy-close", ());
}

pub fn hide_quick_copy_window(app: &tauri::AppHandle, dismiss_app: bool) {
    if !is_presented(app) {
        return;
    }

    let main_was_visible = if let Some(host) = app.try_state::<QuickCopyHostState>() {
        host.main_was_visible_before_open
            .lock()
            .map(|guard| *guard)
            .unwrap_or(true)
    } else {
        true
    };

    dismiss_quick_copy_ui(app);

    if !main_was_visible {
        ensure_main_window_hidden(app);
        if dismiss_app {
            #[cfg(target_os = "macos")]
            {
                // 须在 IPC 返回后再 hide app，否则 quick-copy webview 可能在响应前被销毁。
                let app_for_thread = app.clone();
                let app_for_hide = app.clone();
                let _ = app_for_thread.run_on_main_thread(move || {
                    let _ = app_for_hide.hide();
                });
            }
        }
    }
}

fn main_window_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

fn ensure_main_window_hidden(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
}

fn present_quick_copy_menu(
    app: &tauri::AppHandle,
    event: QuickCopyOpenEvent,
) -> Result<(), String> {
    let main_was_visible = main_window_visible(app);
    if let Ok(mut guard) = app
        .state::<QuickCopyHostState>()
        .main_was_visible_before_open
        .lock()
    {
        *guard = main_was_visible;
    }

    let (cursor_x, cursor_y) = get_global_mouse_physical();
    let window = ensure_quick_copy_window(app)?;

    let monitor = window
        .monitor_from_point(cursor_x as f64, cursor_y as f64)
        .map_err(|e| e.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or("no monitor found")?;

    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    window
        .set_size(Size::Physical(*mon_size))
        .map_err(|e| e.to_string())?;
    window
        .set_position(Position::Physical(*mon_pos))
        .map_err(|e| e.to_string())?;

    show_quick_copy_surface(app)?;
    set_presented(app, true);

    app.emit_to(QUICK_COPY_WINDOW_LABEL, "quick-copy-open", event)
        .map_err(|e| e.to_string())
}

pub fn open_quick_copy_menu(app: &tauri::AppHandle) -> Result<(), String> {
    if is_presented(app) {
        hide_quick_copy_window(app, false);
        return Ok(());
    }

    let menu = build_quick_copy_menu(app)?;
    let event = QuickCopyOpenEvent {
        menu,
        default_selected_id: None,
    };

    let host = app.state::<QuickCopyHostState>();
    let ready = *host.ready.lock().map_err(|e| e.to_string())?;

    if ready {
        present_quick_copy_menu(app, event)
    } else {
        *host.pending.lock().map_err(|e| e.to_string())? = Some(event);
        let _ = ensure_quick_copy_window(app)?;
        Ok(())
    }
}

#[command]
pub fn quick_copy_host_ready(
    app: tauri::AppHandle,
    host: tauri::State<'_, QuickCopyHostState>,
) -> Result<(), String> {
    *host.ready.lock().map_err(|e| e.to_string())? = true;
    if let Some(event) = host.pending.lock().map_err(|e| e.to_string())?.take() {
        present_quick_copy_menu(&app, event)?;
    }
    Ok(())
}

#[command]
pub(crate) async fn quick_copy_pin_item(
    app_handle: tauri::AppHandle,
    item: QuickCopyMenuItemDto,
) -> Result<QuickCopyMenuItemDto, String> {
    let original_id = item.original_id.clone().unwrap_or_else(|| item.id.clone());
    let mut pins = load_quick_copy_pins()?;
    if let Some(existing) = pins
        .iter()
        .find(|pin| pin.original_id.as_deref() == Some(original_id.as_str()))
        .cloned()
    {
        let state = app_handle.state::<QuickCopyClipboard>();
        let mut map = state.0.lock().map_err(|e| e.to_string())?;
        map.insert(existing.id.clone(), existing.body.clone());
        return Ok(existing);
    }

    let pin_id = quick_copy_pin_id();
    let mut pinned = item;
    pinned.original_id = Some(original_id);
    pinned = normalize_pinned_item(pinned, pin_id);
    pins.insert(0, pinned.clone());
    save_quick_copy_pins(&pins)?;
    let state = app_handle.state::<QuickCopyClipboard>();
    let mut map = state.0.lock().map_err(|e| e.to_string())?;
    map.insert(pinned.id.clone(), pinned.body.clone());
    Ok(pinned)
}

#[command]
pub(crate) async fn quick_copy_unpin_item(pin_id: String) -> Result<(), String> {
    let mut pins = load_quick_copy_pins()?;
    pins.retain(|item| item.pin_id.as_deref() != Some(pin_id.as_str()));
    save_quick_copy_pins(&pins)
}

#[command]
pub async fn hide_quick_copy_menu(app_handle: tauri::AppHandle) -> Result<(), String> {
    hide_quick_copy_window(&app_handle, false);
    Ok(())
}

pub fn activate_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or("main window not found")?;

    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    let _ = app.emit("main-window-opened", ());
    Ok(())
}

#[command]
pub async fn show_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    dismiss_quick_copy_ui(&app_handle);
    activate_main_window(&app_handle)?;
    Ok(())
}

#[command]
pub async fn show_main_window_for_note(
    app_handle: tauri::AppHandle,
    note_id: String,
) -> Result<(), String> {
    dismiss_quick_copy_ui(&app_handle);
    activate_main_window(&app_handle)?;
    app_handle
        .emit("open-note-requested", note_id)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[command]
pub async fn quick_copy_select(
    app_handle: tauri::AppHandle,
    id: String,
) -> Result<(), String> {
    let state = app_handle.state::<QuickCopyClipboard>();
    let map = state.0.lock().map_err(|e| e.to_string())?;
    let text = map
        .get(&id)
        .cloned()
        .ok_or_else(|| "quick copy item not found".to_string())?;

    write_clipboard_text_with_history(&app_handle, &text)?;
    hide_quick_copy_window(&app_handle, true);
    if let Err(e) = system_notification::notify_clipboard_copied(&text) {
        eprintln!("[notification] failed to show clipboard notification: {e}");
    }
    Ok(())
}
