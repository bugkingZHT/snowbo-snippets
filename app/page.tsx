"use client"
import { useEffect } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@tauri-apps/api/core'
import { ResizablePanel, ResizablePanelGroup, ResizableHandle } from '@/components/ui/resizable'
import { Sidebar } from '@/components/sidebar'
import { EditorArea } from '@/components/editor-area'
import { NoteActionPalette } from '@/components/note-action-palette'
import { useNotesSync } from '@/hooks/use-notes'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from '@/lib/tauri-api'
import {
  selectedNoteIdAtom,
  sidebarCollapsedAtom,
} from '@/store/note-store'

export default function Home() {
  useNotesSync()
  const sidebarCollapsed = useAtomValue(sidebarCollapsedAtom)
  const setSelectedNoteId = useSetAtom(selectedNoteIdAtom)
  const setSidebarCollapsed = useSetAtom(sidebarCollapsedAtom)

  useEffect(() => {
    setSelectedNoteId(null)
  }, [setSelectedNoteId])

  useEffect(() => {
    const initShortcuts = async () => {
      // registerGlobalShortcuts 内部已吞掉所有异常，只用返回值表达失败。
      // 这里**绝对不能用 console.error**：Next 16 dev overlay 把 console.error
      // 升级成 Console Error 弹窗，而 OS 层快捷键冲突不是致命错误。
      const results = await registerGlobalShortcuts()
      const failed = results.filter((r) => !r.ok)
      if (failed.length > 0) {
        console.warn(
          '[shortcuts] 部分全局快捷键注册失败（多半被其他 App 占用），可在设置页改键：',
          failed.map((r) => `${r.name}=${r.accelerator}: ${r.error ?? 'unknown'}`).join('; '),
        )
      }
    }
    initShortcuts()

    return () => {
      unregisterGlobalShortcuts()
    }
  }, [])

  useEffect(() => {
    if (!isTauri()) return

    let unlistenMainOpened: (() => void) | undefined
    let unlistenOpenNote: (() => void) | undefined
    void listen('main-window-opened', () => {
      setSidebarCollapsed(false)
    }).then((fn) => {
      unlistenMainOpened = fn
    })
    void listen<string>('open-note-requested', (event) => {
      setSidebarCollapsed(false)
      setSelectedNoteId(event.payload)
    }).then((fn) => {
      unlistenOpenNote = fn
    })

    return () => {
      unlistenMainOpened?.()
      unlistenOpenNote?.()
    }
  }, [setSelectedNoteId, setSidebarCollapsed])

  return (
    <div className="h-screen w-screen overflow-hidden">
      {sidebarCollapsed ? (
        <EditorArea />
      ) : (
        <ResizablePanelGroup className="h-full">
          <ResizablePanel defaultSize={22} minSize={12}>
            <Sidebar />
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel defaultSize={78} minSize={30}>
            <EditorArea />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      <NoteActionPalette />
    </div>
  )
}
