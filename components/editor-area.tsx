"use client"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  currentNoteAtom,
  notesAtom,
  sidebarCollapsedAtom,
  shortcutConfigAtom,
} from '@/store/note-store'
import { NoteEditor } from '@/components/note-editor'
import { Button } from '@/components/ui/button'
import { AppWindow, BookOpenText, FileText, PanelLeftOpen, Pencil, Pin, Settings, Sparkles } from 'lucide-react'
import { resolveNoteTitleOnSave, autoNoteTitleOnContentChange } from '@/lib/default-note-title'
import { loadShortcutConfig, setWindowAlwaysOnTop } from '@/lib/tauri-api'
import { NEW_NOTEBOOK_LABEL } from '@/lib/workshop-editor'
import { createImeGuard, isConfirmKey } from '@/lib/confirm-shortcut'
import { useRouter } from 'next/navigation'

const EMPTY_EDITOR_NOTE_ID = '__empty__'

function formatShortcutKeys(shortcut: string): string[] {
  const keys = shortcut
    .split('+')
    .map((key) => key.trim())
    .filter(Boolean)

  if (keys.length === 0) return ['未设置']

  return keys.map((key) => {
    if (key === 'CmdOrCtrl') return 'Cmd/Ctrl'
    if (key === 'Command') return 'Cmd'
    if (key === 'Control') return 'Ctrl'
    if (key === 'Option') return 'Opt'
    return key
  })
}

export function EditorArea() {
  const router = useRouter()
  const note = useAtomValue(currentNoteAtom)
  const setNotes = useSetAtom(notesAtom)
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom)
  const shortcutConfig = useAtomValue(shortcutConfigAtom)
  const setShortcutConfig = useSetAtom(shortcutConfigAtom)
  const [editingTitle, setEditingTitle] = useState(false)
  const [isWindowPinned, setIsWindowPinned] = useState(false)
  const titleImeGuard = useMemo(() => createImeGuard(), [])
  const quickCopyKeys = useMemo(
    () => formatShortcutKeys(shortcutConfig.quickCopy),
    [shortcutConfig.quickCopy],
  )

  useEffect(() => {
    void loadShortcutConfig().then(setShortcutConfig)
  }, [setShortcutConfig])

  const toggleWindowPin = async () => {
    const newState = !isWindowPinned
    setIsWindowPinned(newState)
    await setWindowAlwaysOnTop(newState)
  }

  const updateTitle = (title: string) => {
    if (!note) return
    const now = new Date().toISOString()
    const resolved = resolveNoteTitleOnSave(title, note.content)
    setNotes((prevNotes) =>
      prevNotes.map((n) =>
        n.id === note.id ? { ...n, title: resolved, modifiedAt: now } : n,
      ),
    )
  }

  const updateContent = useCallback(
    (content: string) => {
      if (!note) return
      const now = new Date().toISOString()
      setNotes((prevNotes) =>
        prevNotes.map((n) => {
          if (n.id !== note.id) return n
          const title = autoNoteTitleOnContentChange(n.title, content)
          return { ...n, content, title, modifiedAt: now }
        }),
      )
    },
    [note, setNotes],
  )

  const editorNoteId = note?.id ?? EMPTY_EDITOR_NOTE_ID

  const TopBar = (
    <div
      data-tauri-drag-region
      className={`flex items-center gap-1.5 h-[28px] shrink-0 ${sidebarCollapsed ? 'pl-[72px] pr-3' : 'px-3'}`}
    >
      {sidebarCollapsed && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={() => setSidebarCollapsed(false)}
          title="显示侧边栏"
        >
          <PanelLeftOpen className="h-3.5 w-3.5" />
        </Button>
      )}
      {note ? (
        editingTitle ? (
          <input
            autoFocus
            defaultValue={note.title}
            {...titleImeGuard.compositionProps}
            onBlur={(e) => {
              updateTitle(e.target.value)
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (isConfirmKey(e, titleImeGuard)) {
                updateTitle((e.target as HTMLInputElement).value)
                setEditingTitle(false)
              } else if (e.key === 'Escape') {
                setEditingTitle(false)
              }
            }}
            className="flex-1 min-w-0 px-1.5 py-0.5 text-[13px] font-medium bg-background border rounded outline-none focus:ring-1 focus:ring-ring"
          />
        ) : (
          <div className="group flex-1 min-w-0 flex items-center gap-1">
            <div
              data-tauri-drag-region
              className="min-w-0 flex-1 text-left text-[13px] font-medium truncate text-foreground/90 select-none"
            >
              {note.title || 'Untitled'}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditingTitle(true)}
              className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity"
              title="编辑标题"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      ) : (
        <div
          data-tauri-drag-region
          className="flex-1 min-w-0 text-left text-[13px] font-medium truncate text-foreground/90 select-none"
        >
          {NEW_NOTEBOOK_LABEL}
        </div>
      )}
      <Button
        onClick={toggleWindowPin}
        variant="ghost"
        size="icon"
        className={`h-6 w-6 shrink-0 ${isWindowPinned ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
        title={isWindowPinned ? '取消窗口置顶' : '窗口置顶'}
      >
        <Pin className={`h-3.5 w-3.5 ${isWindowPinned ? 'fill-current' : ''}`} />
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col h-full overflow-hidden bg-editor-canvas dark:bg-transparent">
      {TopBar}
      <div className="flex-1 min-h-0">
        {note ? (
          <NoteEditor
            key={editorNoteId}
            noteId={editorNoteId}
            content={note.content}
            onChange={updateContent}
            flatToolbarInset={sidebarCollapsed ? 'pl-[72px] pr-3' : 'px-3'}
            flatToolbarMatchSidebarButton={sidebarCollapsed}
          />
        ) : (
          <div className="flex h-full items-center justify-center px-6 py-8">
            <div className="w-full max-w-xl space-y-4">
              <div className="text-center">
                <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
                <h2 className="text-[14px] font-semibold text-foreground/90">
                  选择一篇笔记开始编辑
                </h2>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  或在左侧新建笔记，把常用命令、回复和提示词整理成可搜索的片段。
                </p>
              </div>

              <div className="grid items-start gap-2 sm:grid-cols-3">
                <div className="flex h-36 min-h-0 flex-col overflow-hidden rounded-md border bg-background/75 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-foreground/90">
                    <BookOpenText className="h-3.5 w-3.5 text-emerald-600" />
                    快捷语法
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    通过 <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">--</code> 分割片段，
                    并使用 <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{"//"}</code>、
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">$$</code>、
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">@@</code>
                    {' '} 标记标签、占位符或可被引用的 AI 提示词。
                  </p>
                </div>

                <div className="flex h-36 min-h-0 flex-col overflow-hidden rounded-md border bg-background/75 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-foreground/90">
                    <AppWindow className="h-3.5 w-3.5 text-[#007AFF]" />
                    快捷复制窗口
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    按{' '}
                    {quickCopyKeys.map((key, index) => (
                      <span key={`${key}-${index}`}>
                        {index > 0 && ' + '}
                        <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">
                          {key}
                        </kbd>
                      </span>
                    ))}
                    {' '}呼出快捷面板，快速复制、填充或使用 AI 加工片段到剪切板。
                  </p>
                </div>

                <div className="flex h-36 min-h-0 flex-col overflow-hidden rounded-md border bg-background/75 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-foreground/90">
                    <Sparkles className="h-3.5 w-3.5 text-violet-600" />
                    AI 能力
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    在设置页配置 API 接口后，快捷窗口里的 <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">@</code> 和 <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">@@</code> AI 能力就能使用。
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/help')}
                  className="h-7 px-2 text-[11px]"
                >
                  <BookOpenText className="mr-1 h-3 w-3" />
                  打开帮助
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/settings?tab=quick-copy')}
                  className="h-7 px-2 text-[11px]"
                >
                  <Settings className="mr-1 h-3 w-3" />
                  配置快捷键
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/settings?tab=ai')}
                  className="h-7 px-2 text-[11px]"
                >
                  <Sparkles className="mr-1 h-3 w-3" />
                  配置 AI
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
