import { invoke as rawInvoke, isTauri } from '@tauri-apps/api/core'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { save } from '@tauri-apps/plugin-dialog'
import { writeTextFile } from '@tauri-apps/plugin-fs'
import type { AiConfig, AppConfig, Note, ShortcutConfig, QuickCopyMenuItem, QuickCopyOpenEvent } from '@/types/note'

/**
 * 非 Tauri 环境（如 `npm run dev` 直接在浏览器打开）下，window.__TAURI_INTERNALS__ 不存在，
 * 任何 invoke 都会抛 TypeError。这里统一兜底：
 *   - 提示一次开发者使用 `npm run tauri:dev`
 *   - 直接 reject 一个明确的错误，调用方原本的 try/catch 即可降级。
 */
let warnedNonTauri = false
function ensureTauriOrWarn(): boolean {
  if (typeof window === 'undefined') return false
  if (isTauri()) return true
  if (!warnedNonTauri) {
    warnedNonTauri = true
    // 只在浏览器调试时出现一次，避免每个 invoke 都打一长串栈
    console.warn(
      '[snowbo-snippets] 非 Tauri 环境（无 window.__TAURI_INTERNALS__），所有 Rust 命令将被跳过。' +
        '请使用 `npm run tauri:dev` 启动桌面端来测试持久化与全局快捷键。',
    )
  }
  return false
}

async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!ensureTauriOrWarn()) {
    throw new Error(`[snowbo-snippets] invoke("${cmd}") skipped: not running inside Tauri.`)
  }
  return rawInvoke<T>(cmd, args)
}

export async function loadNotes(): Promise<Note[]> {
  try {
    return await invoke<Note[]>('load_notes')
  } catch (error) {
    if (isTauri()) console.error('Failed to load notes:', error)
    return []
  }
}

export async function saveNotes(notes: Note[]): Promise<void> {
  try {
    await invoke('save_notes', { notes })
  } catch (error) {
    if (isTauri()) console.error('Failed to save notes:', error)
  }
}

export async function createNote(title: string, content = ''): Promise<Note> {
  try {
    return await invoke<Note>('create_note', { title, content })
  } catch (error) {
    if (isTauri()) console.error('Failed to create note:', error)
    if (!isTauri()) {
      const now = new Date().toISOString()
      return {
        id: `local-${Math.random().toString(36).slice(2)}-${Date.now()}`,
        title,
        content,
        createdAt: now,
        modifiedAt: now,
      }
    }
    throw error
  }
}

export async function updateNote(note: Note): Promise<void> {
  try {
    await invoke('update_note', { note })
  } catch (error) {
    if (isTauri()) console.error('Failed to update note:', error)
  }
}

export async function deleteNote(id: string): Promise<void> {
  try {
    await invoke('delete_note', { id })
  } catch (error) {
    if (isTauri()) console.error('[API] Failed to delete note:', error)
    if (isTauri()) throw error
  }
}

export async function getStoragePath(): Promise<string> {
  try {
    return await invoke<string>('get_storage_path')
  } catch (error) {
    if (isTauri()) console.error('Failed to get storage path:', error)
    if (isTauri()) throw error
    return '(浏览器环境无持久化路径)'
  }
}

export async function getNoteFilePath(noteId: string): Promise<string> {
  return await invoke<string>('get_note_file_path', { id: noteId })
}

/** 在 Finder / 系统文件管理器中定位并选中笔记文件。 */
export async function revealNoteFileInDir(noteId: string): Promise<void> {
  try {
    await invoke('reveal_note_file', { id: noteId })
  } catch (error) {
    if (isTauri()) console.error('Failed to reveal note file:', error)
    if (isTauri()) throw error
  }
}

/** 在 Finder / 系统文件管理器中定位并选中指定路径的文件。 */
export async function revealPathInDir(path: string): Promise<void> {
  try {
    await invoke('reveal_path_in_dir', { path })
  } catch (error) {
    if (isTauri()) console.error('Failed to reveal path:', error)
    if (isTauri()) throw error
  }
}

export async function getDeletedNotes(): Promise<Note[]> {
  try {
    return await invoke<Note[]>('get_deleted_notes')
  } catch (error) {
    if (isTauri()) console.error('Failed to get deleted notes:', error)
    return []
  }
}

export async function restoreNote(id: string): Promise<void> {
  try {
    await invoke('restore_note', { id })
  } catch (error) {
    if (isTauri()) console.error('Failed to restore note:', error)
    if (isTauri()) throw error
  }
}

export async function setWindowAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  try {
    await invoke('set_window_always_on_top', { alwaysOnTop })
  } catch (error) {
    if (isTauri()) console.error('Failed to set window always on top:', error)
  }
}

export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  quickCopy: 'CmdOrCtrl+Shift+B',
}

export async function loadShortcutConfig(): Promise<ShortcutConfig> {
  try {
    const cfg = await invoke<ShortcutConfig>('load_shortcut_config')
    const merged = { ...DEFAULT_SHORTCUT_CONFIG, ...cfg }
    return {
      quickCopy: merged.quickCopy.trim(),
    }
  } catch (error) {
    if (isTauri()) console.error('Failed to load shortcut config:', error)
    return { ...DEFAULT_SHORTCUT_CONFIG }
  }
}

export async function saveShortcutConfig(config: ShortcutConfig): Promise<void> {
  try {
    await invoke('save_shortcut_config', { config })
  } catch (error) {
    if (isTauri()) console.error('Failed to save shortcut config:', error)
    if (isTauri()) throw error
  }
}

const DEFAULT_AI_SYSTEM_PROMPT =
  "You are a precise text-processing assistant embedded inside a note cell. " +
  "The user's cell content is a mix of data + an instruction. Detect the instruction (often the last natural-language sentence/line in Chinese or English) and apply it to the rest of the content. " +
  "Output ONLY the processed result. Do not explain, do not apologize, do not greet, do not restate the task. " +
  "Do not wrap the result in markdown code fences (```), quotes, or any prefix/suffix unless the user explicitly asks for them. " +
  "If the result is a single value, output just that value with no surrounding whitespace or newline trailing. " +
  "If the instruction is missing or you cannot perform it confidently, output the original content unchanged."

export const DEFAULT_AI_CONFIG: AiConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  systemPrompt: DEFAULT_AI_SYSTEM_PROMPT,
  recentInstructions: [],
}

// 兼容老版本结构:可能存在 instructionPresets 字段
type LegacyAiConfig = AiConfig & { instructionPresets?: unknown }

export async function loadAiConfig(): Promise<AiConfig> {
  try {
    const cfg = (await invoke<LegacyAiConfig>('load_ai_config')) ?? ({} as LegacyAiConfig)
    // 兼容老版后端:缺字段时补默认值,避免下游 .map / .length 报错。
    // 老配置可能用 instructionPresets,迁移时直接当作初始的 recentInstructions。
    const recentRaw = Array.isArray(cfg.recentInstructions)
      ? cfg.recentInstructions
      : Array.isArray(cfg.instructionPresets)
        ? cfg.instructionPresets
        : []
    return {
      ...DEFAULT_AI_CONFIG,
      ...cfg,
      recentInstructions: (recentRaw as string[]).slice(0, 5),
    }
  } catch (error) {
    if (isTauri()) console.error('Failed to load AI config:', error)
    return { ...DEFAULT_AI_CONFIG }
  }
}

export async function saveAiConfig(config: AiConfig): Promise<void> {
  try {
    await invoke('save_ai_config', { config })
  } catch (error) {
    if (isTauri()) console.error('Failed to save AI config:', error)
    if (isTauri()) throw error
  }
}

export const EDITOR_FONT_SIZE_MIN = 10
export const EDITOR_FONT_SIZE_MAX = 24
export const EDITOR_FONT_SIZE_DEFAULT = 12
export const EDITOR_FONT_SIZE_STEP = 1

export const TEMPORARY_CHAT_DISPLAY_LIMIT_MIN = 0
export const TEMPORARY_CHAT_DISPLAY_LIMIT_MAX = 100
export const TEMPORARY_CHAT_DISPLAY_LIMIT_DEFAULT = 20
export const TEMPORARY_CHAT_DISPLAY_LIMIT_STEP = 1

export const CLIPBOARD_HISTORY_LIMIT_MIN = 1
export const CLIPBOARD_HISTORY_LIMIT_MAX = 100
export const CLIPBOARD_HISTORY_LIMIT_DEFAULT = 20
export const CLIPBOARD_HISTORY_LIMIT_STEP = 1

export const DEFAULT_APP_CONFIG: AppConfig = {
  editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
  temporaryChatDisplayLimit: TEMPORARY_CHAT_DISPLAY_LIMIT_DEFAULT,
  clipboardHistoryLimit: CLIPBOARD_HISTORY_LIMIT_DEFAULT,
  editorLineNumbers: false,
  quickCopyAnimations: true,
}

const APP_CONFIG_STORAGE_KEY = 'snowbo-app-config'

export function clampEditorFontSize(size: number): number {
  return Math.min(
    EDITOR_FONT_SIZE_MAX,
    Math.max(EDITOR_FONT_SIZE_MIN, Math.round(size)),
  )
}

export function clampTemporaryChatDisplayLimit(limit: number): number {
  return Math.min(
    TEMPORARY_CHAT_DISPLAY_LIMIT_MAX,
    Math.max(TEMPORARY_CHAT_DISPLAY_LIMIT_MIN, Math.round(limit)),
  )
}

export function clampClipboardHistoryLimit(limit: number): number {
  return Math.min(
    CLIPBOARD_HISTORY_LIMIT_MAX,
    Math.max(CLIPBOARD_HISTORY_LIMIT_MIN, Math.round(limit)),
  )
}

/** 把字号写入 CSS 变量,供 CodeEditor 与各 UI 层消费 */
export function applyEditorFontSize(size: number): void {
  if (typeof document === 'undefined') return
  const clamped = clampEditorFontSize(size)
  document.documentElement.style.setProperty('--editor-font-size', `${clamped}px`)
  document.documentElement.style.setProperty(
    '--editor-gutter-font-size',
    `${Math.max(10, clamped - 1)}px`,
  )
}

export async function loadAppConfig(): Promise<AppConfig> {
  try {
    const cfg = (await invoke<AppConfig>('load_app_config')) ?? ({} as AppConfig)
    return {
      ...DEFAULT_APP_CONFIG,
      ...cfg,
      editorFontSize: clampEditorFontSize(cfg.editorFontSize ?? EDITOR_FONT_SIZE_DEFAULT),
      temporaryChatDisplayLimit: clampTemporaryChatDisplayLimit(
        cfg.temporaryChatDisplayLimit ?? TEMPORARY_CHAT_DISPLAY_LIMIT_DEFAULT,
      ),
      clipboardHistoryLimit: clampClipboardHistoryLimit(
        cfg.clipboardHistoryLimit ?? CLIPBOARD_HISTORY_LIMIT_DEFAULT,
      ),
      editorLineNumbers: cfg.editorLineNumbers ?? DEFAULT_APP_CONFIG.editorLineNumbers,
      quickCopyAnimations:
        cfg.quickCopyAnimations ?? DEFAULT_APP_CONFIG.quickCopyAnimations,
    }
  } catch (error) {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(APP_CONFIG_STORAGE_KEY)
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<AppConfig>
          return {
            ...DEFAULT_APP_CONFIG,
            ...parsed,
            editorFontSize: clampEditorFontSize(
              parsed.editorFontSize ?? EDITOR_FONT_SIZE_DEFAULT,
            ),
            temporaryChatDisplayLimit: clampTemporaryChatDisplayLimit(
              parsed.temporaryChatDisplayLimit ?? TEMPORARY_CHAT_DISPLAY_LIMIT_DEFAULT,
            ),
            clipboardHistoryLimit: clampClipboardHistoryLimit(
              parsed.clipboardHistoryLimit ?? CLIPBOARD_HISTORY_LIMIT_DEFAULT,
            ),
            editorLineNumbers: parsed.editorLineNumbers ?? false,
            quickCopyAnimations:
              parsed.quickCopyAnimations ?? DEFAULT_APP_CONFIG.quickCopyAnimations,
          }
        }
      } catch {
        // ignore corrupt localStorage
      }
    }
    if (isTauri()) console.warn('Failed to load app config, using defaults:', error)
    return { ...DEFAULT_APP_CONFIG }
  }
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  const normalized: AppConfig = {
    editorFontSize: clampEditorFontSize(config.editorFontSize),
    temporaryChatDisplayLimit: clampTemporaryChatDisplayLimit(
      config.temporaryChatDisplayLimit,
    ),
    clipboardHistoryLimit: clampClipboardHistoryLimit(config.clipboardHistoryLimit),
    editorLineNumbers: config.editorLineNumbers ?? DEFAULT_APP_CONFIG.editorLineNumbers,
    quickCopyAnimations:
      config.quickCopyAnimations ?? DEFAULT_APP_CONFIG.quickCopyAnimations,
  }
  try {
    await invoke('save_app_config', { config: normalized })
  } catch (error) {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(normalized))
      return
    }
    if (isTauri()) console.error('Failed to save app config:', error)
    if (isTauri()) throw error
  }
}

export interface ShortcutRegistration {
  name: 'quickCopy' | string
  accelerator: string
  ok: boolean
  error?: string
}

/**
 * 注册 Fast Copy 全局快捷键。
 * 返回值是注册结果，前端可据此提示用户改键。
 */
export async function registerGlobalShortcuts(): Promise<ShortcutRegistration[]> {
  try {
    const r = await invoke<ShortcutRegistration[] | unknown>('register_global_shortcuts')
    if (Array.isArray(r)) return r as ShortcutRegistration[]
    return []
  } catch (error) {
    if (isTauri()) console.warn('[shortcuts] register fell back due to error:', error)
    const message = error instanceof Error ? error.message : String(error)
    return [{ name: 'quickCopy', accelerator: '', ok: false, error: message }]
  }
}

export async function unregisterGlobalShortcuts(): Promise<void> {
  try {
    await invoke('unregister_global_shortcuts')
  } catch (error) {
    if (isTauri()) console.error('Failed to unregister global shortcuts:', error)
  }
}

export async function copyToClipboard(
  text: string,
  options?: { source?: 'quick-copy' },
): Promise<void> {
  try {
    await invoke('copy_to_clipboard', { text, source: options?.source })
  } catch (error) {
    // 浏览器下回退到 Clipboard API
    if (!isTauri() && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text)
        return
      } catch (e) {
        console.error('Failed to copy via navigator.clipboard:', e)
      }
    }
    if (isTauri()) console.error('Failed to copy to clipboard:', error)
    if (isTauri()) throw error
  }
}

export async function readClipboardText(): Promise<string> {
  if (!ensureTauriOrWarn()) {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        return (await navigator.clipboard.readText()) ?? ''
      } catch {
        return ''
      }
    }
    return ''
  }
  try {
    const text = await readText()
    return text ?? ''
  } catch (error) {
    if (isTauri()) console.error('Failed to read clipboard:', error)
    return ''
  }
}

export async function quickCopySelect(id: string): Promise<void> {
  await invoke('quick_copy_select', { id })
}

export async function quickCopyPinItem(item: QuickCopyMenuItem): Promise<QuickCopyMenuItem> {
  return await invoke<QuickCopyMenuItem>('quick_copy_pin_item', { item })
}

export async function quickCopyUnpinItem(pinId: string): Promise<void> {
  await invoke('quick_copy_unpin_item', { pinId })
}

const TEXT_FILE_FILTERS = [
  { name: 'Text files', extensions: ['txt', 'md', 'json', 'log', 'csv', 'yaml', 'yml'] },
  { name: 'All files', extensions: ['*'] },
]

/** 弹出系统保存对话框,把文本写入磁盘。取消时返回 null。 */
export async function saveTextFileToDisk(
  content: string,
  defaultPath?: string | null,
): Promise<string | null> {
  if (!ensureTauriOrWarn()) return null
  try {
    const path = await save({
      filters: TEXT_FILE_FILTERS,
      defaultPath: defaultPath ?? undefined,
    })
    if (!path) return null
    await writeTextFile(path, content)
    return path
  } catch (error) {
    console.error('Failed to save file:', error)
    throw error
  }
}

export async function hideQuickCopyMenu(): Promise<void> {
  await invoke('hide_quick_copy_menu')
}

export async function showMainWindow(): Promise<void> {
  await invoke('show_main_window')
}

export async function showMainWindowForNote(noteId: string): Promise<void> {
  await invoke('show_main_window_for_note', { noteId })
}

export type { QuickCopyOpenEvent }
