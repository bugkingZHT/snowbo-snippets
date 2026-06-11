"use client"
import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { appConfigAtom } from '@/store/note-store'
import {
  copyToClipboard as copyTextToClipboard,
  revealNoteFileInDir,
  revealPathInDir,
  saveTextFileToDisk,
} from '@/lib/tauri-api'
import { Button } from '@/components/ui/button'
import {
  Copy,
  WrapText,
  AlignLeft,
  Check,
  Download,
  FolderOpen,
  Loader2,
} from 'lucide-react'
import { CodeEditor } from './code-editor'

interface NoteEditorProps {
  noteId: string
  content: string
  onChange: (content: string) => void
  flatToolbarInset?: string
  flatToolbarMatchSidebarButton?: boolean
}

export function NoteEditor({
  noteId,
  content,
  onChange,
  flatToolbarInset = 'px-3',
  flatToolbarMatchSidebarButton = false,
}: NoteEditorProps) {
  const editorLineNumbers = useAtomValue(appConfigAtom).editorLineNumbers
  const [copySuccess, setCopySuccess] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [fileIoBusy, setFileIoBusy] = useState(false)
  const [exportFilePath, setExportFilePath] = useState<string | null>(null)

  const copyToClipboard = async () => {
    try {
      await copyTextToClipboard(content)
      setCopySuccess(true)
      window.setTimeout(() => setCopySuccess(false), 1200)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }

  const exportFile = async () => {
    if (fileIoBusy) return
    setFileIoBusy(true)
    try {
      const path = await saveTextFileToDisk(content, exportFilePath)
      if (path) setExportFilePath(path)
    } catch {
      // saveTextFileToDisk 已记录错误
    } finally {
      setFileIoBusy(false)
    }
  }

  const revealFileInDir = async () => {
    if (fileIoBusy) return
    setFileIoBusy(true)
    try {
      if (exportFilePath) {
        await revealPathInDir(exportFilePath)
      } else {
        await revealNoteFileInDir(noteId)
      }
    } catch (error) {
      console.error('Failed to reveal file in directory:', error)
    } finally {
      setFileIoBusy(false)
    }
  }

  const fileIoIcon = fileIoBusy ? (
    <Loader2 className="h-3.5 w-3.5 animate-spin" />
  ) : null

  return (
    <div className="flex flex-col h-full overflow-hidden [--card:var(--background)] dark:[--card:var(--background)]">
      <div className="sticky top-0 z-20 shrink-0">
        <div
          className={`flex items-center justify-between gap-2 h-[28px] shrink-0 bg-transparent ${flatToolbarInset}`}
        >
          <div
            className={`flex items-center min-w-0 ${flatToolbarMatchSidebarButton ? 'gap-1.5' : 'gap-0.5'}`}
          >
            {flatToolbarMatchSidebarButton ? (
              <span className="w-6 shrink-0" aria-hidden />
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={revealFileInDir}
              disabled={fileIoBusy}
              className="h-6 w-6"
              title={
                exportFilePath
                  ? `在文件管理器中显示 ${exportFilePath}`
                  : '在文件管理器中显示笔记文件'
              }
            >
              {fileIoIcon ?? <FolderOpen className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={exportFile}
              disabled={fileIoBusy}
              className="h-6 w-6"
              title={exportFilePath ? `导出到 ${exportFilePath}` : '导出为文件'}
            >
              {fileIoIcon ?? <Download className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setWrap((w) => !w)}
              className="h-6 w-6"
              title={wrap ? '当前：自动换行（点击关闭）' : '当前：不换行（点击开启）'}
              aria-pressed={wrap}
            >
              {wrap ? <WrapText className="h-3.5 w-3.5" /> : <AlignLeft className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={copyToClipboard}
              className={`h-6 w-6 ${
                copySuccess
                  ? 'text-green-600 hover:text-green-600 bg-green-500/10 hover:bg-green-500/20'
                  : ''
              }`}
              title={copySuccess ? '已复制' : '复制到剪贴板'}
            >
              {copySuccess ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative">
        <CodeEditor
          value={content}
          wrap={wrap}
          showLineNumbers={editorLineNumbers}
          onChange={onChange}
          fillHeight
          className="h-full"
          autoFocus
        />
      </div>
    </div>
  )
}
