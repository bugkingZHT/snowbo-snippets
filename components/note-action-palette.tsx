"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  noteActionPaletteAtom,
  notesAtom,
  selectedNoteIdAtom,
  unsavedDraftAtom,
} from '@/store/note-store'
import type { Note } from '@/types/note'
import { createNote, deleteNote as deleteNoteAPI } from '@/lib/tauri-api'
import { isConfirmKey, createImeGuard, isImeComposing } from '@/lib/confirm-shortcut'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

function insertNewNote(notes: Note[], created: Note): Note[] {
  const firstArchivedIndex = notes.findIndex((n) => n.archived)
  if (firstArchivedIndex === -1) return [...notes, created]
  return [
    ...notes.slice(0, firstArchivedIndex),
    created,
    ...notes.slice(firstArchivedIndex),
  ]
}

export function NoteActionPalette() {
  const [palette, setPalette] = useAtom(noteActionPaletteAtom)
  const notes = useAtomValue(notesAtom)
  const selectedNoteId = useAtomValue(selectedNoteIdAtom)
  const setNotes = useSetAtom(notesAtom)
  const setSelectedId = useSetAtom(selectedNoteIdAtom)
  const setUnsavedDraft = useSetAtom(unsavedDraftAtom)

  const [inputValue, setInputValue] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const imeGuard = useMemo(() => createImeGuard(), [])

  const deleteTarget =
    palette?.kind === 'delete-note'
      ? notes.find((n) => n.id === palette.noteId) ?? null
      : null
  const deleteConfirmLabel = deleteTarget
    ? deleteTarget.title.trim() || 'Untitled'
    : ''

  const close = useCallback(() => {
    setPalette(null)
    setInputValue('')
    setBusy(false)
  }, [setPalette])

  useEffect(() => {
    if (!palette) {
      setInputValue('')
      setBusy(false)
      return
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [palette])

  useEffect(() => {
    if (!palette) return
    if (palette.kind === 'delete-note' && !deleteTarget) {
      close()
    }
  }, [close, deleteTarget, palette])

  useEffect(() => {
    if (!palette) return

    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return
      const target = e.target as HTMLElement | null
      if (target?.closest('[data-note-action-trigger]')) return
      close()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [close, palette])

  const handleCreate = async () => {
    const title = inputValue.trim()
    if (!title || busy) return

    setBusy(true)
    try {
      const created = await createNote(title, '')
      setNotes((prev) => insertNewNote(prev, created))
      setUnsavedDraft('')
      setSelectedId(created.id)
      close()
    } catch (error) {
      console.error('Failed to create note:', error)
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || busy) return
    if (inputValue.trim().toLowerCase() !== 'y') return

    setBusy(true)
    try {
      await deleteNoteAPI(deleteTarget.id)
      setNotes((prev) => prev.filter((n) => n.id !== deleteTarget.id))
      if (selectedNoteId === deleteTarget.id) {
        setSelectedId(null)
        setUnsavedDraft('')
      }
      close()
    } catch (error) {
      console.error('[Delete] Failed to delete note:', error)
      setBusy(false)
    }
  }

  if (!palette) return null
  if (palette.kind === 'delete-note' && !deleteTarget) return null

  const isNew = palette.kind === 'new-notebook'
  const canSubmit = isNew
    ? inputValue.trim().length > 0 && !busy
    : inputValue.trim().toLowerCase() === 'y' && !busy

  const submit = () => {
    if (isNew) void handleCreate()
    else void handleDelete()
  }

  return (
    <div
      className="fixed top-[32px] left-1/2 -translate-x-1/2 z-50 w-[min(560px,calc(100vw-32px))]"
      role="dialog"
      aria-label={isNew ? '新建笔记' : '删除笔记确认'}
    >
      <div
        ref={containerRef}
        className="rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          {isNew ? (
            <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          ) : (
            <Trash2 className="h-3.5 w-3.5 text-destructive shrink-0" />
          )}
          <input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            disabled={busy}
            placeholder={isNew ? '输入笔记名称…' : '输入 y 确认，n 取消'}
            {...imeGuard.compositionProps}
            onKeyDown={(e) => {
              if (!isNew && !busy && !isImeComposing(e) && !imeGuard.shouldSkipConfirm()) {
                if (e.key === 'n' || e.key === 'N') {
                  e.preventDefault()
                  close()
                  return
                }
                if (e.key === 'y' || e.key === 'Y') {
                  e.preventDefault()
                  void handleDelete()
                  return
                }
              }
              if (isConfirmKey(e, imeGuard) && canSubmit) {
                e.preventDefault()
                submit()
              }
            }}
            className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted-foreground disabled:opacity-60"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cn(
              'h-6 px-2.5 text-[12px] rounded-md shrink-0 disabled:opacity-40 disabled:cursor-not-allowed',
              isNew
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
            )}
          >
            {isNew ? '创建' : '删除'}
          </button>
        </div>

        <div className="px-3 py-2.5 text-[11px] text-muted-foreground leading-relaxed">
          {isNew ? (
            '为笔记命名后创建，将出现在 Recents 列表并自动打开编辑。'
          ) : (
            <>
              确定删除笔记「
              <span className="text-foreground/90">{deleteConfirmLabel}</span>
              」？输入 <span className="font-medium text-foreground/90">y</span> 确认，{' '}
              <span className="font-medium text-foreground/90">n</span> 取消。
            </>
          )}
        </div>
      </div>
    </div>
  )
}
