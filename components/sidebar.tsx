"use client"
import { useEffect, useMemo, useRef, useState } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  notesAtom,
  noteActionPaletteAtom,
  selectedNoteIdAtom,
  sidebarCollapsedAtom,
} from '@/store/note-store'
import type { Note } from '@/types/note'
import { resolveNoteTitleOnSave } from '@/lib/default-note-title'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ModeToggle } from '@/components/mode-toggle'
import { Archive, ArchiveRestore, ChevronRight, Trash2, FileText, PanelLeftClose, GripVertical, Plus } from 'lucide-react'
import {
  NEW_NOTEBOOK_LABEL,
} from '@/lib/workshop-editor'
import { createImeGuard, isConfirmKey } from '@/lib/confirm-shortcut'

type NoteSection = 'notes' | 'archived'

type DropIndicator = {
  section: NoteSection
  /** 横线落在此 note 之前；null 表示区段末尾 */
  beforeId: string | null
}

function reorderInSection(
  notes: Note[],
  section: NoteSection,
  fromId: string,
  beforeId: string | null,
): Note[] {
  const isArchivedSection = section === 'archived'
  const sectionNotes = notes.filter((n) => !!n.archived === isArchivedSection)
  const otherNotes = notes.filter((n) => !!n.archived !== isArchivedSection)

  const fromIdx = sectionNotes.findIndex((n) => n.id === fromId)
  if (fromIdx === -1) return notes

  let insertIdx =
    beforeId === null
      ? sectionNotes.length
      : sectionNotes.findIndex((n) => n.id === beforeId)
  if (insertIdx === -1) return notes

  const reordered = [...sectionNotes]
  const [item] = reordered.splice(fromIdx, 1)
  if (fromIdx < insertIdx) insertIdx -= 1
  if (insertIdx === fromIdx) return notes

  reordered.splice(insertIdx, 0, item)
  return isArchivedSection ? [...otherNotes, ...reordered] : [...reordered, ...otherNotes]
}

function resolveDropIndicator(
  clientY: number,
  section: NoteSection,
  sectionNotes: Note[],
): DropIndicator | null {
  const list = document.querySelector(`[data-note-list="${section}"]`)
  if (!list) return null

  const rows = list.querySelectorAll<HTMLElement>('[data-note-row]')
  if (rows.length === 0) {
    return { section, beforeId: null }
  }

  for (const row of rows) {
    const rect = row.getBoundingClientRect()
    const id = row.dataset.noteId
    if (!id) continue

    if (clientY < rect.top) {
      return { section, beforeId: id }
    }

    if (clientY <= rect.bottom) {
      const mid = rect.top + rect.height / 2
      if (clientY < mid) return { section, beforeId: id }

      const idx = sectionNotes.findIndex((n) => n.id === id)
      const nextId =
        idx >= 0 && idx < sectionNotes.length - 1 ? sectionNotes[idx + 1].id : null
      return { section, beforeId: nextId }
    }
  }

  return { section, beforeId: null }
}

export function Sidebar() {
  const [notes, setNotes] = useAtom(notesAtom)
  const [selectedNoteId, setSelectedId] = useAtom(selectedNoteIdAtom)
  const setNoteActionPalette = useSetAtom(noteActionPaletteAtom)
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<DropIndicator | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const titleImeGuard = useMemo(() => createImeGuard(), [])

  const dragRef = useRef<{ section: NoteSection; id: string } | null>(null)
  const dropIndicatorRef = useRef<DropIndicator | null>(null)

  const { activeNotes, archived } = useMemo(() => {
    const activeList: Note[] = []
    const archivedList: Note[] = []
    for (const n of notes) {
      if (n.archived) {
        archivedList.push(n)
        continue
      }
      activeList.push(n)
    }
    return { activeNotes: activeList, archived: archivedList }
  }, [notes])

  const activeNotesRef = useRef(activeNotes)
  activeNotesRef.current = activeNotes
  const archivedRef = useRef(archived)
  archivedRef.current = archived

  useEffect(() => {
    return () => {
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
  }, [])

  const updateTitle = (id: string, title: string, content: string) => {
    const resolved = resolveNoteTitleOnSave(title, content)
    setNotes((prevNotes) =>
      prevNotes.map((n) =>
        n.id === id
          ? { ...n, title: resolved, modifiedAt: new Date().toISOString() }
          : n,
      ),
    )
  }

  const handleDoubleClick = (id: string) => {
    setEditingId(id)
  }

  const handleTitleBlur = (id: string, title: string) => {
    const note = notes.find((n) => n.id === id)
    updateTitle(id, title, note?.content ?? '')
    setEditingId(null)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent, id: string, title: string) => {
    if (isConfirmKey(e, titleImeGuard)) {
      const note = notes.find((n) => n.id === id)
      updateTitle(id, title, note?.content ?? '')
      setEditingId(null)
    }
  }

  const openNewNotebookPalette = () => {
    setNoteActionPalette({ kind: 'new-notebook' })
  }

  const openDeletePalette = (noteId: string) => {
    setNoteActionPalette({ kind: 'delete-note', noteId })
  }

  const selectNote = (id: string) => {
    setSelectedId(id)
  }

  const archiveNote = (id: string) => {
    const now = new Date().toISOString()
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, archived: true, archivedAt: now, modifiedAt: now }
          : n,
      ),
    )
  }

  const restoreArchivedNote = (id: string) => {
    const now = new Date().toISOString()
    setNotes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, archived: false, archivedAt: undefined, modifiedAt: now }
          : n,
      ),
    )
  }

  const deleteNote = (id: string) => {
    openDeletePalette(id)
  }

  const clearDrag = () => {
    dragRef.current = null
    dropIndicatorRef.current = null
    setDraggingId(null)
    setDropIndicator(null)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }

  const handleGripPointerDown = (
    e: React.PointerEvent,
    note: Note,
    section: NoteSection,
  ) => {
    if (editingId === note.id || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const gripEl = e.currentTarget as HTMLElement

    dragRef.current = { section, id: note.id }
    setDraggingId(note.id)
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'

    const onPointerMove = (ev: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return

      const target = document.elementFromPoint(ev.clientX, ev.clientY)
      const listEl = target?.closest('[data-note-list]') as HTMLElement | null
      const hoverSection = listEl?.dataset.noteList as NoteSection | undefined

      if (!hoverSection || hoverSection !== drag.section) {
        dropIndicatorRef.current = null
        setDropIndicator(null)
        return
      }

      const sectionNotes =
        hoverSection === 'archived' ? archivedRef.current : activeNotesRef.current
      const indicator = resolveDropIndicator(ev.clientY, hoverSection, sectionNotes)
      dropIndicatorRef.current = indicator
      setDropIndicator(indicator)
    }

    const onPointerUp = (ev: PointerEvent) => {
      try {
        gripEl.releasePointerCapture(ev.pointerId)
      } catch {
        // ignore if capture already released
      }

      const drag = dragRef.current
      const indicator = dropIndicatorRef.current

      if (drag && indicator && indicator.section === drag.section) {
        setNotes((prev) =>
          reorderInSection(prev, drag.section, drag.id, indicator.beforeId),
        )
      }

      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      clearDrag()
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  const renderDropLine = (section: NoteSection, beforeId: string | null) => {
    if (
      !dropIndicator ||
      dropIndicator.section !== section ||
      dropIndicator.beforeId !== beforeId
    ) {
      return null
    }
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-1.5 top-0 z-20 h-0.5 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_25%,transparent)]"
      />
    )
  }

  const renderItem = (note: Note, section: NoteSection) => {
    const isSelected = selectedNoteId === note.id
    const isEditing = editingId === note.id

    return (
    <div
      key={note.id}
      data-note-row
      data-note-id={note.id}
      data-section={section}
      className={`relative group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-0.5 px-1 py-1 rounded-md transition-colors ${
        isSelected ? 'bg-accent' : 'hover:bg-accent/60'
      } ${draggingId === note.id ? 'opacity-40' : ''}`}
    >
      {renderDropLine(section, note.id)}
      <div
        role="button"
        tabIndex={-1}
        onPointerDown={(e) => handleGripPointerDown(e, note, section)}
        className="flex h-5 w-4 shrink-0 touch-none items-center justify-center opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-muted-foreground/70"
        title="拖拽排序"
      >
        <GripVertical className="h-3 w-3 pointer-events-none" />
      </div>
      <div className="flex min-h-5 min-w-0 items-center gap-1.5">
        <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
        {isEditing ? (
          <input
            autoFocus
            defaultValue={note.title}
            {...titleImeGuard.compositionProps}
            onBlur={(e) => handleTitleBlur(note.id, e.target.value)}
            onKeyDown={(e) =>
              handleTitleKeyDown(e, note.id, (e.target as HTMLInputElement).value)
            }
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 px-1 py-0.5 text-[13px] bg-background border rounded outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <button
            onClick={() => selectNote(note.id)}
            onDoubleClick={() => handleDoubleClick(note.id)}
            className="min-w-0 flex-1 overflow-hidden text-left text-[13px] leading-5"
            title={note.title || 'Untitled'}
          >
            <span className="block min-w-0 truncate">
              {note.title || 'Untitled'}
            </span>
          </button>
        )}
      </div>

      {!isEditing ? (
        <div
          className="flex w-0 items-center gap-0.5 overflow-hidden opacity-0 transition-[width,opacity] pointer-events-none group-hover:w-11 group-hover:opacity-100 group-hover:pointer-events-auto"
        >
          {note.archived ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                restoreArchivedNote(note.id)
              }}
              title="恢复笔记"
            >
              <ArchiveRestore className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation()
                archiveNote(note.id)
              }}
              title="归档笔记"
            >
              <Archive className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            data-note-action-trigger
            className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              deleteNote(note.id)
            }}
            title="删除笔记"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ) : null}
    </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-[13px]">
      <div
        data-tauri-drag-region
        className="flex items-center pl-[72px] pr-1.5 h-[28px] shrink-0"
      >
        <div data-tauri-drag-region className="flex-1 h-full" />
        <Button
          onClick={() => setSidebarCollapsed(true)}
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title="隐藏侧边栏"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="px-2 pt-1 pb-1 shrink-0 space-y-0.5">
        <button
          type="button"
          data-note-action-trigger
          onClick={openNewNotebookPalette}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-foreground transition-colors hover:bg-accent/60"
        >
          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{NEW_NOTEBOOK_LABEL}</span>
        </button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-2 pb-2 space-y-3">
          <section>
            <div className="px-1.5 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/80">
              Notes
            </div>
            <div className="relative space-y-px" data-note-list="notes">
              {activeNotes.length > 0 ? (
                activeNotes.map((n) => renderItem(n, 'notes'))
              ) : (
                <div className="text-[11px] text-muted-foreground text-center py-2">
                  暂无笔记
                </div>
              )}
              {activeNotes.length > 0 ? (
                <div className="relative h-0">
                  {renderDropLine('notes', null)}
                </div>
              ) : null}
            </div>
          </section>

          <section>
            <button
              type="button"
              onClick={() => setArchivedExpanded((expanded) => !expanded)}
              className="flex h-6 w-full items-center gap-1 px-1.5 pt-1 pb-0.5 text-left text-[10px] uppercase tracking-wider text-muted-foreground/80 transition-colors hover:text-foreground"
            >
              <ChevronRight className={`h-3 w-3 transition-transform ${archivedExpanded ? 'rotate-90' : ''}`} />
              <Archive className="h-3 w-3" />
              <span className="flex-1">Archived</span>
              <span className="text-muted-foreground/55">{archived.length}</span>
            </button>
            {archivedExpanded ? (
              <div className="relative space-y-px" data-note-list="archived">
                {archived.length > 0 ? (
                  archived.map((n) => renderItem(n, 'archived'))
                ) : (
                  <div className="text-[11px] text-muted-foreground text-center py-2">
                    暂无归档笔记
                  </div>
                )}
                {archived.length > 0 ? (
                  <div className="relative h-0">
                    {renderDropLine('archived', null)}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>
        </div>
      </ScrollArea>

      <div className="flex h-8 shrink-0 items-center px-2">
        <ModeToggle />
      </div>
    </div>
  )
}
