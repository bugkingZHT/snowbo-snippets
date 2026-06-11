export interface Note {
  id: string
  title: string
  content: string
  createdAt: string
  modifiedAt: string
  archived?: boolean
  archivedAt?: string
  deleted?: boolean
  deletedAt?: string
}

export interface ShortcutConfig {
  quickCopy: string
}

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt: string
  recentInstructions: string[]
}

export interface AppConfig {
  editorFontSize: number
  temporaryChatDisplayLimit: number
  /** 快捷复制结果中缓存的系统剪切板历史条数 */
  clipboardHistoryLimit: number
  editorLineNumbers: boolean
  /** 是否启用快捷窗口中的过渡和动画效果 */
  quickCopyAnimations: boolean
}

/** quick-copy 弹窗仍使用 cell 粒度;主窗口不再暴露 Cell。 */
export interface Cell {
  id: string
  mode: 'text' | 'code'
  content: string
  wrap?: boolean
}

export interface QuickCopyMenuItem {
  id: string
  label: string
  originalId?: string
  pinId?: string
  pinned?: boolean
  noteTitle?: string
  source?: 'note' | 'history' | 'pinned'
  /** 片段完整正文（含 `//` `@@` 行） */
  content: string
  /** 复制用正文（已去掉标记行） */
  body: string
  /** 行首 `//` metadata / alias / tag，popup 右侧小 tag 展示 */
  tags?: string[]
  /** 行首 `@@` AI 指令，供 AI 对话上下文 */
  prompts?: string[]
  /** 正文含 `$$` 快捷替换占位符 */
  hasArgsPlaceholder?: boolean
}

export interface QuickCopyNoteGroup {
  noteId: string
  title: string
  items: QuickCopyMenuItem[]
}

export interface QuickCopyMenuPayload {
  pinned: QuickCopyMenuItem[]
  notes: QuickCopyNoteGroup[]
  recent: QuickCopyMenuItem[]
  emptyMessage?: string
}

export interface QuickCopyOpenEvent {
  menu: QuickCopyMenuPayload
  defaultSelectedId: string | null
}
