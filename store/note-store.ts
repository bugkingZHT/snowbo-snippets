import { atom } from 'jotai'
import type { AiConfig, AppConfig, Note, ShortcutConfig } from '@/types/note'
import { DEFAULT_AI_CONFIG, DEFAULT_APP_CONFIG, DEFAULT_SHORTCUT_CONFIG } from '@/lib/tauri-api'

export const selectedNoteIdAtom = atom<string | null>(null)

export const sidebarCollapsedAtom = atom<boolean>(false)

export const notesAtom = atom<Note[]>([])

/** 未选中任何笔记时的编辑缓冲;保存后落盘并出现在侧边栏。 */
export const unsavedDraftAtom = atom<string>('')

export const aiConfigAtom = atom<AiConfig>(DEFAULT_AI_CONFIG)

export const appConfigAtom = atom<AppConfig>(DEFAULT_APP_CONFIG)

export const shortcutConfigAtom = atom<ShortcutConfig>(DEFAULT_SHORTCUT_CONFIG)

export type NoteActionPaletteState =
  | { kind: 'new-notebook' }
  | { kind: 'delete-note'; noteId: string }

export const noteActionPaletteAtom = atom<NoteActionPaletteState | null>(null)

export const currentNoteAtom = atom((get) => {
  const selectedId = get(selectedNoteIdAtom)
  if (!selectedId) return null
  const notes = get(notesAtom)
  return notes.find((note) => note.id === selectedId) ?? null
})
