"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { listen } from '@tauri-apps/api/event'
import { invoke, isTauri } from '@tauri-apps/api/core'
import {
  AppWindow,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  DollarSign,
  FileText,
  History,
  Loader2,
  Pin,
  PinOff,
  ArrowRight,
  Search,
  Sparkles,
} from 'lucide-react'
import {
  copyToClipboard,
  hideQuickCopyMenu,
  quickCopyPinItem,
  quickCopySelect,
  quickCopyUnpinItem,
  showMainWindow,
  showMainWindowForNote,
  type QuickCopyOpenEvent,
} from '@/lib/tauri-api'
import type { QuickCopyMenuItem } from '@/types/note'
import { aiWithContext, AiNotConfiguredError } from '@/lib/ai'
import {
  applyArgsPlaceholder,
  buildQuickCopyRowTags,
  getDefaultQuickCopyAction,
  getQuickCopyActions,
  itemDisplayLabel,
  parseQuickCopySearchQuery,
  QUICK_COPY_ACTIONS,
  searchQuickCopyItems,
  sortQuickCopyItems,
  type QuickCopyAction,
  type QuickCopyRowTag,
} from '@/lib/quick-copy-markers'
import { applyStoredTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { appConfigAtom } from '@/store/note-store'
import { loadAppConfig } from '@/lib/tauri-api'
import {
  confirmActionLabel,
  confirmInputPlaceholder,
  createImeGuard,
  isConfirmKey,
} from '@/lib/confirm-shortcut'

type Workflow =
  | { kind: 'search' }
  | { kind: 'args'; item: QuickCopyMenuItem }
  | { kind: 'prompt'; item: QuickCopyMenuItem }

interface QuickCopyDisplayGroup {
  id: string
  noteId: string
  title: string
  items: QuickCopyMenuItem[]
}

type QuickCopyDisplayEntry =
  | { kind: 'pinned-item'; id: string; item: QuickCopyMenuItem }
  | { kind: 'history-header'; id: string; items: QuickCopyMenuItem[] }
  | { kind: 'history-item'; id: string; item: QuickCopyMenuItem }
  | { kind: 'note-header'; id: string; group: QuickCopyDisplayGroup }
  | { kind: 'note-item'; id: string; group: QuickCopyDisplayGroup; item: QuickCopyMenuItem }

const POPUP_ANIMATION_MS = 120

function waitForPopupAnimation(enabled: boolean): Promise<void> {
  if (!enabled) return Promise.resolve()
  return new Promise((resolve) => {
    window.setTimeout(resolve, POPUP_ANIMATION_MS)
  })
}

function flattenItems(payload: QuickCopyOpenEvent): QuickCopyMenuItem[] {
  const items: QuickCopyMenuItem[] = []
  for (const group of payload.menu.notes) {
    for (const item of group.items) {
      items.push({
        ...item,
        noteTitle: item.noteTitle ?? group.title,
        source: item.source ?? 'note',
      })
    }
  }
  for (const item of payload.menu.recent) {
    items.push({ ...item, source: 'history' })
  }
  return items
}

function noteGroupsFromPayload(payload: QuickCopyOpenEvent): QuickCopyDisplayGroup[] {
  return payload.menu.notes
    .map((group, index) => ({
      id: `${index}:${group.title}`,
      noteId: group.noteId,
      title: group.title,
      items: group.items.map((item) => ({
        ...item,
        noteTitle: item.noteTitle ?? group.title,
        source: item.source ?? 'note',
      })),
    }))
    .filter((group) => group.items.length > 0)
}

function historyItemsFromPayload(payload: QuickCopyOpenEvent): QuickCopyMenuItem[] {
  return payload.menu.recent.map((item) => ({ ...item, source: 'history' }))
}

const labelFadeMask =
  '[mask-image:linear-gradient(to_right,#000_0%,#000_calc(100%-2.5rem),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,#000_0%,#000_calc(100%-2.5rem),transparent_100%)]'

function actionTone(action: QuickCopyAction, active: boolean): string {
  if (action === 'prompt') {
    return active
      ? 'bg-violet-600 text-white dark:bg-violet-500'
      : 'bg-violet-500/15 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
  }
  if (action === 'args') {
    return active
      ? 'bg-orange-500 text-white'
      : 'bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300'
  }
  return active
    ? 'bg-[#007AFF] text-white dark:bg-[#0A84FF]'
    : 'bg-[#007AFF]/12 text-[#007AFF] dark:bg-[#0A84FF]/18 dark:text-[#0A84FF]'
}

function tagClass(variant: QuickCopyRowTag['variant']): string {
  if (variant === 'history') {
    return 'bg-muted text-muted-foreground'
  }
  return 'bg-primary/12 text-primary'
}

function ActionIcon({ action }: { action: QuickCopyAction }) {
  if (action === 'prompt') return <Sparkles className="h-3 w-3" />
  if (action === 'args') return <DollarSign className="h-3 w-3" />
  return <Copy className="h-3 w-3" />
}

function QuickCopyRow({
  item,
  selected,
  selectedAction,
  depth = 0,
  rowRef,
  onMouseEnter,
  onExecute,
  onAction,
  onActionFocus,
  onPinToggle,
  pinnedActive,
}: {
  item: QuickCopyMenuItem
  selected: boolean
  selectedAction: QuickCopyAction
  depth?: number
  pinnedActive: boolean
  rowRef?: (node: HTMLDivElement | null) => void
  onMouseEnter: () => void
  onExecute: () => void
  onAction: (action: QuickCopyAction) => void
  onActionFocus: (action: QuickCopyAction) => void
  onPinToggle: () => void
}) {
  const actions = getQuickCopyActions(item)
  const tags = buildQuickCopyRowTags(item)
    .filter((tag) => tag.variant !== 'history')
    .slice(0, 2)
  const label = itemDisplayLabel(item)

  return (
    <div
      ref={rowRef}
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onExecute}
      className={cn(
        'group relative grid h-7 cursor-default grid-cols-[1fr_auto] items-center gap-2 pl-2.5 pr-2 transition-colors',
        selected ? 'bg-accent' : 'hover:bg-accent/55',
      )}
    >
      <button
        type="button"
        data-quick-copy-pin-button="true"
        tabIndex={-1}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.currentTarget.blur()
          onPinToggle()
        }}
        className={cn(
          'absolute inset-y-0 left-0 z-10 inline-flex w-12 shrink-0 items-center justify-start pl-2.5',
          'bg-gradient-to-r from-popover via-popover/95 to-transparent text-muted-foreground',
          'opacity-0 transition-[opacity,color] duration-150 hover:text-foreground focus:outline-none',
          'group-hover:opacity-100 group-hover:from-accent group-hover:via-accent/90',
          pinnedActive && 'text-amber-600 dark:text-amber-400',
        )}
        title={pinnedActive ? '取消固定' : '固定快照'}
        aria-label={pinnedActive ? '取消固定' : '固定快照'}
      >
        {pinnedActive ? <PinOff className="h-2.5 w-2.5" /> : <Pin className="h-2.5 w-2.5" />}
      </button>
      <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: `${depth * 8}px` }}>
        <span className={cn('min-w-0 flex-1 truncate text-[12px] leading-4', labelFadeMask)}>
          {label}
        </span>
        <div className="hidden min-w-0 items-center gap-0.5 sm:flex">
          {tags.map((tag) => (
            <span
              key={tag.key}
              title={tag.text}
              className={cn(
                'max-w-[4.5rem] truncate rounded px-1 py-0.5 text-[9px] font-medium leading-none',
                tagClass(tag.variant),
              )}
            >
              {tag.text}
            </span>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 self-center">
        {actions.map((action) => {
          const active = selected && selectedAction === action
          return (
            <button
              key={action}
              type="button"
              data-quick-copy-action-button="true"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onAction(action)
              }}
              onFocus={() => onActionFocus(action)}
              className={cn(
                'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 text-[10px] font-medium transition-colors',
                actionTone(action, active),
              )}
              title={QUICK_COPY_ACTIONS[action].label}
            >
              <ActionIcon action={action} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function QuickCopyFolderRow({
  icon,
  title,
  count,
  expanded,
  selected,
  rowRef,
  onMouseEnter,
  onToggle,
  onOpenNote,
}: {
  icon: ReactNode
  title: string
  count: number
  expanded: boolean
  selected: boolean
  rowRef?: (node: HTMLDivElement | null) => void
  onMouseEnter: () => void
  onToggle: () => void
  onOpenNote?: () => void
}) {
  return (
    <div
      ref={rowRef}
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onToggle}
      className={cn(
        'group relative flex h-7 cursor-default items-center gap-1.5 px-3 text-[11px] transition-colors',
        selected ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/55',
      )}
    >
      <ChevronRight className={cn('h-3 w-3 transition-transform', expanded && 'rotate-90')} />
      {icon}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      <span className="text-[10px] text-muted-foreground/55">{count}</span>
      {onOpenNote ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            e.currentTarget.blur()
            onOpenNote()
          }}
          className={cn(
            'absolute inset-y-0 right-0 z-10 inline-flex w-12 shrink-0 items-center justify-end pr-3',
            'bg-gradient-to-l from-popover via-popover/95 to-transparent text-muted-foreground',
            'opacity-0 transition-[opacity,color] duration-150 hover:text-foreground focus:outline-none',
            'group-hover:opacity-100 group-hover:from-accent group-hover:via-accent/90',
          )}
          title="打开笔记"
          aria-label="打开笔记"
        >
          <ArrowRight className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  )
}

function QuickCopyMenuPanel({
  payload,
  onClose,
}: {
  payload: QuickCopyOpenEvent
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const busyRef = useRef(false)
  const closingRef = useRef(false)
  const appConfig = useAtomValue(appConfigAtom)
  const animationsEnabled = appConfig.quickCopyAnimations
  const imeGuard = useMemo(() => createImeGuard(), [])

  const [workflow, setWorkflow] = useState<Workflow>({ kind: 'search' })
  const [inputValue, setInputValue] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [actionOverrides, setActionOverrides] = useState<Record<string, QuickCopyAction>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)
  const [pinnedItems, setPinnedItems] = useState<QuickCopyMenuItem[]>(() => payload.menu.pinned ?? [])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(() => new Set())
  const [filterCollapsedHistory, setFilterCollapsedHistory] = useState(false)
  const [filterCollapsedNoteIds, setFilterCollapsedNoteIds] = useState<Set<string>>(() => new Set())
  const selectedEntryNodeRef = useRef<HTMLDivElement | null>(null)
  const lastAutoSelectedInputRef = useRef<string | null>(null)

  busyRef.current = busy

  const allItems = useMemo(() => [...pinnedItems, ...flattenItems(payload)], [payload, pinnedItems])
  const allNoteGroups = useMemo(() => noteGroupsFromPayload(payload), [payload])
  const allHistoryItems = useMemo(() => historyItemsFromPayload(payload), [payload])
  const visiblePinnedItems = useMemo(() => {
    if (workflow.kind !== 'search') return []
    return sortQuickCopyItems(searchQuickCopyItems(pinnedItems, inputValue), inputValue)
  }, [inputValue, pinnedItems, workflow.kind])
  const visibleHistoryItems = useMemo(() => {
    if (workflow.kind !== 'search') return []
    return sortQuickCopyItems(searchQuickCopyItems(allHistoryItems, inputValue), inputValue)
  }, [allHistoryItems, inputValue, workflow.kind])
  const visibleNoteGroups = useMemo(() => {
    if (workflow.kind !== 'search') return []
    return allNoteGroups
      .map((group) => ({
        ...group,
        items: sortQuickCopyItems(searchQuickCopyItems(group.items, inputValue), inputValue),
      }))
      .filter((group) => group.items.length > 0)
  }, [allNoteGroups, inputValue, workflow.kind])
  const isFiltering = inputValue.trim().length > 0
  const historyVisible = isFiltering ? !filterCollapsedHistory : historyExpanded
  const visibleEntries = useMemo<QuickCopyDisplayEntry[]>(() => {
    const entries: QuickCopyDisplayEntry[] = []
    for (const item of visiblePinnedItems) {
      entries.push({ kind: 'pinned-item', id: item.id, item })
    }
    if (visibleHistoryItems.length > 0) {
      entries.push({ kind: 'history-header', id: 'history', items: visibleHistoryItems })
      if (historyVisible) {
        for (const item of visibleHistoryItems) {
          entries.push({ kind: 'history-item', id: item.id, item })
        }
      }
    }

    for (const group of visibleNoteGroups) {
      const noteVisible = isFiltering
        ? !filterCollapsedNoteIds.has(group.id)
        : expandedNoteIds.has(group.id)
      entries.push({ kind: 'note-header', id: `note:${group.id}`, group })
      if (noteVisible) {
        for (const item of group.items) {
          entries.push({ kind: 'note-item', id: item.id, group, item })
        }
      }
    }

    return entries
  }, [expandedNoteIds, filterCollapsedNoteIds, historyVisible, isFiltering, visibleHistoryItems, visibleNoteGroups, visiblePinnedItems])
  const visibleItems = useMemo(
    () => visibleEntries.flatMap((entry) =>
      entry.kind === 'history-header' || entry.kind === 'note-header' ? [] : [entry.item],
    ),
    [visibleEntries],
  )
  const visibleItemIndexById = useMemo(() => {
    const indexes = new Map<string, number>()
    visibleEntries.forEach((entry, index) => {
      if (entry.kind !== 'history-header' && entry.kind !== 'note-header') {
        indexes.set(entry.item.id, index)
      }
    })
    return indexes
  }, [visibleEntries])
  const visibleEntryIndexById = useMemo(() => {
    const indexes = new Map<string, number>()
    visibleEntries.forEach((entry, index) => indexes.set(entry.id, index))
    return indexes
  }, [visibleEntries])
  const visibleResultCount = useMemo(
    () => visiblePinnedItems.length + visibleHistoryItems.length + visibleNoteGroups.reduce((sum, group) => sum + group.items.length, 0),
    [visibleHistoryItems.length, visibleNoteGroups, visiblePinnedItems.length],
  )
  const searchAction = useMemo(
    () => (workflow.kind === 'search' ? parseQuickCopySearchQuery(inputValue).action : null),
    [inputValue, workflow.kind],
  )
  const directAiInput = useMemo(() => {
    if (workflow.kind !== 'search') return null
    const parsed = parseQuickCopySearchQuery(inputValue)
    return parsed.scope === 'direct-ai' ? parsed.text.trim() : null
  }, [inputValue, workflow.kind])
  const isDirectAiQuery = directAiInput !== null
  const actionForItem = useCallback(
    (item: QuickCopyMenuItem): QuickCopyAction =>
      actionOverrides[item.id] ??
      (searchAction && getQuickCopyActions(item).includes(searchAction)
        ? searchAction
        : getDefaultQuickCopyAction(item)),
    [actionOverrides, searchAction],
  )

  const selectedEntry = visibleEntries[selectedIndex] ?? visibleEntries[0] ?? null
  const selectedItem =
    selectedEntry?.kind === 'history-header' || selectedEntry?.kind === 'note-header'
      ? null
      : selectedEntry?.item ?? null
  const selectedAction = selectedItem ? actionForItem(selectedItem) : 'copy'

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  useEffect(() => {
    setWorkflow({ kind: 'search' })
    setInputValue('')
    setSelectedIndex(0)
    setActionOverrides({})
    setBusy(false)
    setError(null)
    setEntered(false)
    setClosing(false)
    setPinnedItems(payload.menu.pinned ?? [])
    setHistoryExpanded(false)
    setExpandedNoteIds(new Set())
    setFilterCollapsedHistory(false)
    setFilterCollapsedNoteIds(new Set())
    lastAutoSelectedInputRef.current = null
    closingRef.current = false
    focusInput()
  }, [payload, focusInput])

  useEffect(() => {
    if (!animationsEnabled) {
      setEntered(true)
      return
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [animationsEnabled, payload])

  useEffect(() => {
    if (selectedIndex >= visibleEntries.length) {
      setSelectedIndex(visibleEntries.length > 0 ? visibleEntries.length - 1 : 0)
    }
  }, [selectedIndex, visibleEntries.length])

  useEffect(() => {
    if (workflow.kind !== 'search') return
    if (lastAutoSelectedInputRef.current === inputValue) return
    lastAutoSelectedInputRef.current = inputValue

    if (!inputValue.trim()) {
      setSelectedIndex(0)
      return
    }

    const firstItemIndex = visibleEntries.findIndex(
      (entry) => entry.kind !== 'history-header' && entry.kind !== 'note-header',
    )
    setSelectedIndex(firstItemIndex >= 0 ? firstItemIndex : 0)
  }, [inputValue, visibleEntries, workflow.kind])

  useEffect(() => {
    if (!selectedEntry) return
    selectedEntryNodeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedEntry, selectedIndex, visibleEntries])

  const toggleHistoryGroup = useCallback((force?: boolean) => {
    if (isFiltering) {
      setFilterCollapsedHistory((collapsed) => force === undefined ? !collapsed : !force)
      return
    }
    setHistoryExpanded((expanded) => force ?? !expanded)
  }, [isFiltering])

  const toggleNoteGroup = useCallback((groupId: string, force?: boolean) => {
    if (isFiltering) {
      setFilterCollapsedNoteIds((prev) => {
        const next = new Set(prev)
        const shouldExpand = force ?? next.has(groupId)
        if (shouldExpand) next.delete(groupId)
        else next.add(groupId)
        return next
      })
      return
    }

    setExpandedNoteIds((prev) => {
      const next = new Set(prev)
      const shouldExpand = force ?? !next.has(groupId)
      if (shouldExpand) next.add(groupId)
      else next.delete(groupId)
      return next
    })
  }, [isFiltering])

  const selectEntryById = useCallback((entryId: string) => {
    const index = visibleEntries.findIndex((entry) => entry.id === entryId)
    if (index >= 0) setSelectedIndex(index)
  }, [visibleEntries])

  const moveSelectedEntry = useCallback((delta: 1 | -1) => {
    if (visibleEntries.length === 0) return
    setActionOverrides({})
    setSelectedIndex((idx) => (idx + delta + visibleEntries.length) % visibleEntries.length)
  }, [visibleEntries.length])

  const focusSelectedRowButton = useCallback((reverse = false) => {
    if (!selectedItem) return false
    const row = selectedEntryNodeRef.current
    if (!row) return false

    const buttons = Array.from(
      row.querySelectorAll<HTMLElement>(
        '[data-quick-copy-action-button="true"]',
      ),
    ).filter((button) => !button.hasAttribute('disabled'))
    if (buttons.length === 0) return false

    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const currentIndex = activeElement ? buttons.indexOf(activeElement) : -1
    const nextIndex = currentIndex < 0
      ? (reverse ? buttons.length - 1 : 0)
      : (currentIndex + (reverse ? -1 : 1) + buttons.length) % buttons.length
    buttons[nextIndex]?.focus()
    return true
  }, [selectedItem])

  const dismissWithAnimation = useCallback(async (action: () => Promise<void>) => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    await waitForPopupAnimation(animationsEnabled)
    try {
      await action()
    } catch (err) {
      closingRef.current = false
      setClosing(false)
      throw err
    }
  }, [animationsEnabled])

  const closeMenu = useCallback(async () => {
    try {
      await dismissWithAnimation(hideQuickCopyMenu)
    } catch (err) {
      console.error('[QuickCopy] failed to hide window:', err)
      onClose()
    }
  }, [dismissWithAnimation, onClose])

  const openMainWindow = useCallback(async () => {
    try {
      await dismissWithAnimation(showMainWindow)
    } catch (err) {
      console.error('[QuickCopy] failed to open main window:', err)
      onClose()
    }
  }, [dismissWithAnimation, onClose])

  const openNoteInMainWindow = useCallback(async (noteId: string) => {
    try {
      await dismissWithAnimation(() => showMainWindowForNote(noteId))
    } catch (err) {
      console.error('[QuickCopy] failed to open note in main window:', err)
      onClose()
    }
  }, [dismissWithAnimation, onClose])

  const copyItem = useCallback(
    async (id: string) => {
      try {
        await dismissWithAnimation(() => quickCopySelect(id))
      } catch (err) {
        console.error('[QuickCopy] failed to copy:', err)
        await closeMenu()
      }
    },
    [closeMenu, dismissWithAnimation],
  )

  const finishWithClipboard = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      try {
        await copyToClipboard(trimmed, { source: 'quick-copy' })
        await closeMenu()
      } catch (err) {
        console.error('[QuickCopy] failed to copy result:', err)
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [closeMenu],
  )

  const executeAction = useCallback(
    (item: QuickCopyMenuItem, action: QuickCopyAction) => {
      setError(null)
      if (action === 'copy') {
        void copyItem(item.id)
        return
      }
      setWorkflow({ kind: action, item })
      setInputValue('')
      focusInput()
    },
    [copyItem, focusInput],
  )

  const togglePinnedItem = useCallback(async (item: QuickCopyMenuItem) => {
    setError(null)
    try {
      if (item.pinned && item.pinId) {
        await quickCopyUnpinItem(item.pinId)
        setPinnedItems((prev) => prev.filter((pinned) => pinned.pinId !== item.pinId))
        return
      }

      const pinned = await quickCopyPinItem({
        ...item,
        originalId: item.originalId ?? item.id,
      })
      setPinnedItems((prev) => {
        const originalId = pinned.originalId ?? pinned.id
        const withoutExisting = prev.filter((existing) =>
          (existing.originalId ?? existing.id) !== originalId,
        )
        return [pinned, ...withoutExisting]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const submitArgs = useCallback(async () => {
    if (workflow.kind !== 'args' || busy) return
    const text = inputValue.trim()
    if (!text) return
    const result = applyArgsPlaceholder(workflow.item.body, text)
    await finishWithClipboard(result)
  }, [busy, finishWithClipboard, inputValue, workflow])

  const submitPrompt = useCallback(async () => {
    if (workflow.kind !== 'prompt' || busy) return
    const text = inputValue.trim()
    if (!text) return

    setError(null)
    setBusy(true)
    try {
      const result = await aiWithContext({
        snippetBody: workflow.item.body,
        segmentPrompts: workflow.item.prompts,
        userInput: text,
      })
      await finishWithClipboard(result)
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        setError('请先在设置页配置 AI 接口')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
    }
  }, [busy, finishWithClipboard, inputValue, workflow])

  const submitDirectAi = useCallback(async () => {
    if (busy) return
    const text = directAiInput?.trim() ?? ''
    if (!text) {
      setError('请输入要发送给 AI 的内容')
      return
    }

    setError(null)
    setBusy(true)
    try {
      const result = await aiWithContext({ userInput: text })
      await finishWithClipboard(result)
    } catch (err) {
      if (err instanceof AiNotConfiguredError) {
        setError('请先在设置页配置 AI 接口')
      } else {
        setError(err instanceof Error ? err.message : String(err))
      }
    } finally {
      setBusy(false)
    }
  }, [busy, directAiInput, finishWithClipboard])

  const submitCurrent = useCallback(() => {
    if (workflow.kind === 'args') {
      void submitArgs()
      return
    }
    if (workflow.kind === 'prompt') {
      void submitPrompt()
      return
    }
    if (isDirectAiQuery) {
      void submitDirectAi()
      return
    }
    if (selectedEntry?.kind === 'history-header') {
      toggleHistoryGroup()
      return
    }
    if (selectedEntry?.kind === 'note-header') {
      toggleNoteGroup(selectedEntry.group.id)
      return
    }
    const item = selectedItem ?? visibleItems[0]
    if (!item) return
    executeAction(item, actionForItem(item))
  }, [
    actionForItem,
    executeAction,
    selectedEntry,
    selectedItem,
    submitArgs,
    submitDirectAi,
    submitPrompt,
    toggleHistoryGroup,
    toggleNoteGroup,
    visibleItems,
    workflow.kind,
    isDirectAiQuery,
  ])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      if (busyRef.current) return
      void closeMenu()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (busyRef.current) return
        e.preventDefault()
        e.stopPropagation()
        if (workflow.kind === 'search') {
          void closeMenu()
        } else {
          setWorkflow({ kind: 'search' })
          setInputValue('')
          setError(null)
          focusInput()
        }
        return
      }

      if (workflow.kind === 'search') {
        if (e.key === 'Tab' && selectedItem && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (focusSelectedRowButton(e.shiftKey)) {
            e.preventDefault()
            e.stopPropagation()
            return
          }
        }

        if (e.key === 'ArrowDown') {
          e.preventDefault()
          moveSelectedEntry(1)
          return
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault()
          moveSelectedEntry(-1)
          return
        }

        if (e.key === 'ArrowRight' && selectedEntry?.kind === 'history-header') {
          e.preventDefault()
          toggleHistoryGroup(true)
          return
        }

        if (e.key === 'ArrowRight' && selectedEntry?.kind === 'note-header') {
          e.preventDefault()
          toggleNoteGroup(selectedEntry.group.id, true)
          return
        }

        if (e.key === 'ArrowLeft') {
          if (selectedEntry?.kind === 'history-header') {
            e.preventDefault()
            toggleHistoryGroup(false)
            return
          }
          if (selectedEntry?.kind === 'history-item') {
            e.preventDefault()
            toggleHistoryGroup(false)
            selectEntryById('history')
            return
          }
          if (selectedEntry?.kind === 'note-header') {
            e.preventDefault()
            toggleNoteGroup(selectedEntry.group.id, false)
            return
          }
          if (selectedEntry?.kind === 'note-item') {
            e.preventDefault()
            toggleNoteGroup(selectedEntry.group.id, false)
            selectEntryById(`note:${selectedEntry.group.id}`)
            return
          }
        }
      }

      const inlineButtonTarget =
        e.target instanceof HTMLElement &&
        e.target.closest<HTMLElement>(
          '[data-quick-copy-action-button="true"]',
        )

      const isQuickCopyEnter = isConfirmKey(e, imeGuard)

      if (isQuickCopyEnter && inlineButtonTarget) {
        e.preventDefault()
        e.stopPropagation()
        inlineButtonTarget.click()
        return
      }

      if (isQuickCopyEnter) {
        e.preventDefault()
        e.stopPropagation()
        submitCurrent()
        return
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [
    closeMenu,
    executeAction,
    focusInput,
    focusSelectedRowButton,
    imeGuard,
    moveSelectedEntry,
    selectedAction,
    selectedEntry,
    selectedItem,
    selectEntryById,
    submitCurrent,
    toggleHistoryGroup,
    toggleNoteGroup,
    visibleEntries.length,
    workflow.kind,
  ])

  const canSubmitWorkflow =
    workflow.kind !== 'search' && inputValue.trim().length > 0 && !busy
  const canSubmitSearch =
    workflow.kind === 'search' &&
    (isDirectAiQuery ? (directAiInput?.length ?? 0) > 0 : !!selectedEntry) &&
    !busy

  const placeholder =
    workflow.kind === 'args'
      ? confirmInputPlaceholder('输入替换内容…', 'Esc 返回搜索')
      : workflow.kind === 'prompt'
        ? confirmInputPlaceholder('描述希望 AI 做什么…', 'Esc 返回搜索')
        : confirmInputPlaceholder('搜索所有未归档片段…', '$ Fill · @ AI · @@ Chat · / Tag')

  const statusText =
    workflow.kind === 'args'
      ? `Fill · ${itemDisplayLabel(workflow.item)}`
        : workflow.kind === 'prompt'
          ? `AI · ${itemDisplayLabel(workflow.item)}`
          : isDirectAiQuery
            ? 'Direct AI · 不引用任何片段'
          : inputValue.trim()
            ? `找到 ${visibleResultCount} 个结果`
          : '默认折叠；使用 ←/→ 展开或收起'

  const popupVisible = entered && !closing
  const disableMotionClass = !animationsEnabled && '[&_*]:!animate-none [&_*]:!transition-none'

  return (
    <div
      className={cn(
        'fixed inset-0 z-[100] flex justify-center items-start bg-black/8 dark:bg-black/18 backdrop-blur-[1px] pt-[min(14vh,120px)]',
        animationsEnabled && 'transition-opacity duration-[120ms] ease-out',
        popupVisible ? 'opacity-100' : 'opacity-0',
        !popupVisible && 'pointer-events-none',
        disableMotionClass,
      )}
      role="presentation"
    >
      <div
        ref={menuRef}
        role="dialog"
        aria-label="Snowbo Snippets"
        className={cn(
          'w-[min(560px,calc(100vw-48px))] max-h-[min(560px,calc(100vh-160px))]',
          'rounded-xl border border-border/50',
          'bg-popover/98 text-popover-foreground backdrop-blur-xl',
          'shadow-[0_24px_80px_rgba(0,0,0,0.22)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]',
          'overflow-hidden flex flex-col',
          animationsEnabled && 'transition-[opacity,transform] duration-[120ms] ease-out will-change-[opacity,transform]',
          popupVisible || !animationsEnabled
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-[0.98] -translate-y-1',
        )}
      >
        <div className="shrink-0 border-b border-border/50">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <span className="truncate text-[12px] font-medium text-muted-foreground select-none">
              Snowbo Snippets
              <span className="font-normal text-muted-foreground/60"> · Quick copy</span>
            </span>
            <button
              type="button"
              onClick={() => void openMainWindow()}
              className={cn(
                'shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-md',
                'text-muted-foreground transition-colors hover:bg-black/[0.04] hover:text-foreground dark:hover:bg-white/[0.08]',
              )}
              title="打开主窗口"
              aria-label="打开主窗口"
            >
              <AppWindow className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="px-3 pb-2.5">
            <div className="flex items-center gap-2">
              {workflow.kind === 'prompt' || isDirectAiQuery ? (
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400" />
              ) : workflow.kind === 'args' ? (
                <DollarSign className="h-3.5 w-3.5 shrink-0 text-orange-500 dark:text-orange-400" />
              ) : (
                <Search className="h-3.5 w-3.5 shrink-0 text-[#007AFF] dark:text-[#0A84FF]" />
              )}
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  setError(null)
                  if (workflow.kind === 'search') {
                    setSelectedIndex(0)
                    setActionOverrides({})
                    setFilterCollapsedHistory(false)
                    setFilterCollapsedNoteIds(new Set())
                  }
                }}
                {...imeGuard.compositionProps}
                disabled={busy}
                placeholder={placeholder}
                className={cn(
                  'h-8 flex-1 rounded-md border border-border/60 bg-background/80',
                  'px-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/70',
                  'outline-none focus:ring-1 focus:ring-ring',
                  busy && 'opacity-70',
                )}
              />
              <button
                type="button"
                onClick={submitCurrent}
                disabled={workflow.kind === 'search' ? !canSubmitSearch : !canSubmitWorkflow}
                className={cn(
                  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
                  canSubmitSearch || canSubmitWorkflow
                    ? 'bg-[#007AFF] text-white hover:bg-[#0066DD] dark:bg-[#0A84FF] dark:hover:bg-[#0077E6]'
                    : 'cursor-not-allowed bg-muted text-muted-foreground',
                  isDirectAiQuery && canSubmitSearch && 'bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600',
                  workflow.kind === 'prompt' && canSubmitWorkflow && 'bg-violet-600 hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-600',
                  workflow.kind === 'args' && canSubmitWorkflow && 'bg-orange-500 hover:bg-orange-600',
                )}
                title={
                  workflow.kind === 'search'
                    ? confirmActionLabel(isDirectAiQuery ? '发送给 AI' : '执行选中动作')
                    : workflow.kind === 'prompt'
                      ? confirmActionLabel('发送给 AI')
                      : confirmActionLabel('应用替换')
                }
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : workflow.kind === 'search' ? (
                  selectedItem && selectedAction === 'copy' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  )
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {error ? (
              <p className="mt-1.5 px-1 text-[11px] text-destructive">{error}</p>
            ) : (
              <p className="mt-1 px-1 text-[10px] text-muted-foreground/80">{statusText}</p>
            )}
          </div>
        </div>

        {payload.menu.emptyMessage && allItems.length === 0 && !isDirectAiQuery ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground select-none">
            {payload.menu.emptyMessage}
          </div>
        ) : workflow.kind !== 'search' ? (
          <div className="px-3 py-2">
            <QuickCopyRow
              item={workflow.item}
              selected
              selectedAction={workflow.kind}
              pinnedActive={workflow.item.pinned === true}
              onMouseEnter={() => {}}
              onExecute={() => {}}
              onAction={(action) => {
                if (action !== workflow.kind) executeAction(workflow.item, action)
              }}
              onActionFocus={() => {}}
              onPinToggle={() => void togglePinnedItem(workflow.item)}
            />
          </div>
        ) : visibleEntries.length === 0 && !isDirectAiQuery ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground select-none">
            没有匹配的片段
          </div>
        ) : isDirectAiQuery ? (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground select-none">
            {directAiInput ? '按 Enter 直接发送给 AI' : '输入内容后直接发送给 AI'}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto overscroll-contain py-1" role="listbox">
            {visiblePinnedItems.length > 0 ? (
              <div className="pb-1">
                {visiblePinnedItems.map((item) => {
                  const index = visibleItemIndexById.get(item.id) ?? 0
                  const selected = index === selectedIndex
                  const action = actionForItem(item)
                  return (
                    <QuickCopyRow
                      key={item.id}
                      item={item}
                      selected={selected}
                      selectedAction={action}
                      pinnedActive
                      depth={1}
                      rowRef={selected ? (node) => { selectedEntryNodeRef.current = node } : undefined}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onExecute={() => {
                        setSelectedIndex(index)
                        executeAction(item, action)
                      }}
                      onAction={(nextAction) => {
                        setSelectedIndex(index)
                        setActionOverrides((prev) => ({ ...prev, [item.id]: nextAction }))
                        executeAction(item, nextAction)
                      }}
                      onActionFocus={(nextAction) => {
                        setSelectedIndex(index)
                        setActionOverrides((prev) => ({ ...prev, [item.id]: nextAction }))
                      }}
                      onPinToggle={() => void togglePinnedItem(item)}
                    />
                  )
                })}
              </div>
            ) : null}

            {visibleHistoryItems.length > 0 ? (
              <div className="pb-1">
                <QuickCopyFolderRow
                  title="History"
                  icon={<History className="h-3 w-3" />}
                  count={visibleHistoryItems.length}
                  expanded={historyVisible}
                  selected={selectedEntry?.kind === 'history-header'}
                  rowRef={selectedEntry?.kind === 'history-header'
                    ? (node) => { selectedEntryNodeRef.current = node }
                    : undefined}
                  onMouseEnter={() => setSelectedIndex(visibleEntryIndexById.get('history') ?? 0)}
                  onToggle={() => {
                    setSelectedIndex(visibleEntryIndexById.get('history') ?? 0)
                    toggleHistoryGroup()
                  }}
                />
                {historyVisible && visibleHistoryItems.map((item) => {
                  const index = visibleItemIndexById.get(item.id) ?? 0
                  const selected = index === selectedIndex
                  const action = actionForItem(item)
                  return (
                    <QuickCopyRow
                      key={item.id}
                      item={item}
                      selected={selected}
                      selectedAction={action}
                      depth={1}
                      pinnedActive={item.pinned === true}
                      rowRef={selected ? (node) => { selectedEntryNodeRef.current = node } : undefined}
                      onMouseEnter={() => setSelectedIndex(index)}
                      onExecute={() => {
                        setSelectedIndex(index)
                        executeAction(item, action)
                      }}
                      onAction={(nextAction) => {
                        setSelectedIndex(index)
                        setActionOverrides((prev) => ({ ...prev, [item.id]: nextAction }))
                        executeAction(item, nextAction)
                      }}
                      onActionFocus={(nextAction) => {
                        setSelectedIndex(index)
                        setActionOverrides((prev) => ({ ...prev, [item.id]: nextAction }))
                      }}
                      onPinToggle={() => void togglePinnedItem(item)}
                    />
                  )
                })}
              </div>
            ) : null}

            {visibleNoteGroups.length > 0 ? (
              <div>
                {visibleNoteGroups.map((group) => (
                  <div key={group.id} className="pb-1">
                    {(() => {
                      const expanded = isFiltering
                        ? !filterCollapsedNoteIds.has(group.id)
                        : expandedNoteIds.has(group.id)
                      const entryId = `note:${group.id}`
                      const index = visibleEntryIndexById.get(entryId) ?? 0
                      const selected = index === selectedIndex
                      return (
                        <QuickCopyFolderRow
                          key={entryId}
                          icon={<FileText className="h-3 w-3" />}
                          title={group.title}
                          count={group.items.length}
                          expanded={expanded}
                          selected={selected}
                          rowRef={selected ? (node) => { selectedEntryNodeRef.current = node } : undefined}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onToggle={() => {
                            setSelectedIndex(index)
                            toggleNoteGroup(group.id)
                          }}
                          onOpenNote={() => void openNoteInMainWindow(group.noteId)}
                        />
                      )
                    })()}
                    {(isFiltering
                      ? !filterCollapsedNoteIds.has(group.id)
                      : expandedNoteIds.has(group.id)) && group.items.map((item) => {
                      const index = visibleItemIndexById.get(item.id) ?? 0
                      const selected = index === selectedIndex
                      const action = actionForItem(item)
                      return (
                        <QuickCopyRow
                          key={item.id}
                          item={item}
                          selected={selected}
                          selectedAction={action}
                          depth={1}
                          pinnedActive={item.pinned === true}
                          rowRef={selected ? (node) => { selectedEntryNodeRef.current = node } : undefined}
                          onMouseEnter={() => setSelectedIndex(index)}
                          onExecute={() => {
                            setSelectedIndex(index)
                            executeAction(item, action)
                          }}
                          onAction={(nextAction) => {
                            setSelectedIndex(index)
                            setActionOverrides((prev) => ({ ...prev, [item.id]: nextAction }))
                            executeAction(item, nextAction)
                          }}
                          onActionFocus={(nextAction) => {
                            setSelectedIndex(index)
                            setActionOverrides((prev) => ({ ...prev, [item.id]: nextAction }))
                          }}
                          onPinToggle={() => void togglePinnedItem(item)}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

/** 独立 quick-copy 窗口的事件宿主。 */
export function QuickCopyMenuHost() {
  const [openPayload, setOpenPayload] = useState<QuickCopyOpenEvent | null>(null)
  const setAppConfig = useSetAtom(appConfigAtom)

  useEffect(() => {
    if (!openPayload) return
    applyStoredTheme('system')
    void loadAppConfig()
      .then((cfg) => setAppConfig(cfg))
      .catch((error) => {
        console.warn('[QuickCopy] failed to load app config:', error)
      })
  }, [openPayload, setAppConfig])

  useEffect(() => {
    if (!isTauri()) return

    let unlistenOpen: (() => void) | undefined
    let unlistenClose: (() => void) | undefined
    let cancelled = false

    void (async () => {
      unlistenOpen = await listen<QuickCopyOpenEvent>('quick-copy-open', (event) => {
        setOpenPayload(event.payload)
      })
      unlistenClose = await listen('quick-copy-close', () => {
        setOpenPayload(null)
      })
      if (cancelled) {
        unlistenOpen()
        unlistenClose()
        return
      }
      await invoke('quick_copy_host_ready')
    })().catch((error) => {
      console.error('[QuickCopy] failed to initialize host:', error)
    })

    return () => {
      cancelled = true
      unlistenOpen?.()
      unlistenClose?.()
    }
  }, [])

  if (!openPayload) {
    return <div className="fixed inset-0 bg-transparent" aria-hidden />
  }

  return (
    <QuickCopyMenuPanel
      payload={openPayload}
      onClose={() => setOpenPayload(null)}
    />
  )
}
