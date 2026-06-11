"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useTheme } from "@/components/theme-provider"
import { ArrowLeft, Moon, Sun, Monitor, FileText, Trash2, RotateCcw, Save, Sparkles, Loader2, Type, AppWindow, ListOrdered, ClipboardList, CheckCircle2, XCircle, Tag, AtSign, DollarSign, Copy } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState, useEffect, useRef, type ReactNode } from "react"
import { useAtom } from "jotai"
import { getStoragePath, getDeletedNotes, restoreNote, loadShortcutConfig, saveShortcutConfig, registerGlobalShortcuts, unregisterGlobalShortcuts, loadAiConfig, saveAiConfig, DEFAULT_AI_CONFIG, EDITOR_FONT_SIZE_MIN, EDITOR_FONT_SIZE_MAX, EDITOR_FONT_SIZE_DEFAULT, EDITOR_FONT_SIZE_STEP, clampEditorFontSize, CLIPBOARD_HISTORY_LIMIT_MIN, CLIPBOARD_HISTORY_LIMIT_MAX, CLIPBOARD_HISTORY_LIMIT_DEFAULT, CLIPBOARD_HISTORY_LIMIT_STEP, clampClipboardHistoryLimit } from "@/lib/tauri-api"
import { processCellWithAI } from "@/lib/ai"
import { aiConfigAtom, appConfigAtom, shortcutConfigAtom } from "@/store/note-store"
import type { Note, ShortcutConfig } from "@/types/note"

type SettingsTab = 'basic' | 'quick-copy' | 'ai'

const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'basic', label: '基础设置' },
  { id: 'quick-copy', label: '快捷窗口' },
  { id: 'ai', label: 'AI 加工' },
]

function isSettingsTab(tab: string | null): tab is SettingsTab {
  return tab === 'basic' || tab === 'quick-copy' || tab === 'ai'
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">
      {children}
    </code>
  )
}

function Example({ children }: { children: string }) {
  return (
    <pre className="mt-2 rounded border border-border/40 bg-background/80 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-foreground/90 whitespace-pre-wrap">
      {children}
    </pre>
  )
}

function QuickCopyInfoCard({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <div className="h-full rounded-md border border-border/60 bg-muted/30 p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-foreground/90">
        {icon}
        {title}
      </div>
      <div className="text-[11px] leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<SettingsTab>('basic')
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [storagePath, setStoragePath] = useState<string>("")
  const [deletedNotes, setDeletedNotes] = useState<Note[]>([])
  const [isRecording, setIsRecording] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle')
  // 各条快捷键的注册结果（OS 冲突时单条失败但不阻塞其他条）
  const [shortcutErrors, setShortcutErrors] = useState<Record<string, string>>({})
  // 设置页独立加载和保存 AI 配置。
  const [aiConfig, setAiConfig] = useAtom(aiConfigAtom)
  const [appConfig, setAppConfig] = useAtom(appConfigAtom)
  const [shortcutConfig, setShortcutConfig] = useAtom(shortcutConfigAtom)
  const [aiSaveStatus, setAiSaveStatus] = useState<'idle' | 'saving' | 'success'>('idle')
  const [aiTestStatus, setAiTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [aiTestMessage, setAiTestMessage] = useState<string>('')
  // 卸载时清理悬挂的 keydown 监听器
  const recordingHandlerRef = useRef<((e: KeyboardEvent) => void) | null>(null)
  useEffect(() => {
    return () => {
      if (recordingHandlerRef.current) {
        window.removeEventListener('keydown', recordingHandlerRef.current)
        recordingHandlerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const readTabFromUrl = () => {
      const tab = new URLSearchParams(window.location.search).get('tab')
      setActiveTab(isSettingsTab(tab) ? tab : 'basic')
    }

    readTabFromUrl()
    window.addEventListener('popstate', readTabFromUrl)
    return () => window.removeEventListener('popstate', readTabFromUrl)
  }, [])

  useEffect(() => {
    window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-settings-scroll] [data-slot="scroll-area-viewport"]')
        ?.scrollTo({ top: 0, behavior: 'auto' })
    })
  }, [activeTab])

  // 获取存储路径
  useEffect(() => {
    const fetchStoragePath = async () => {
      try {
        const path = await getStoragePath()
        setStoragePath(path)
      } catch (error) {
        console.error('Failed to get storage path:', error)
        setStoragePath('~/.snowbo-notebook')
      }
    }
    fetchStoragePath()
  }, [])

  // 获取已删除的笔记
  useEffect(() => {
    const fetchDeletedNotes = async () => {
      try {
        const notes = await getDeletedNotes()
        setDeletedNotes(notes)
      } catch (error) {
        console.error('Failed to fetch deleted notes:', error)
      }
    }
    fetchDeletedNotes()
  }, [])

  // 加载快捷键配置
  useEffect(() => {
    const fetchShortcutConfig = async () => {
      try {
        const config = await loadShortcutConfig()
        setShortcutConfig(config)
      } catch (error) {
        console.error('Failed to load shortcut config:', error)
      }
    }
    fetchShortcutConfig()
  }, [setShortcutConfig])

  // 加载 AI 配置
  useEffect(() => {
    const fetchAiConfig = async () => {
      try {
        const config = await loadAiConfig()
        setAiConfig(config)
      } catch (error) {
        console.error('Failed to load AI config:', error)
      }
    }
    fetchAiConfig()
  }, [setAiConfig])

  // 恢复笔记
  const handleRestore = async (id: string) => {
    try {
      await restoreNote(id)
      // 从列表中移除已恢复的笔记
      setDeletedNotes(prev => prev.filter(n => n.id !== id))
    } catch (error) {
      console.error('Failed to restore note:', error)
    }
  }

  // 快捷键录制处理函数
  const handleRecordShortcut = (field: keyof ShortcutConfig) => {
    // 切到新输入框时,先把上一次的悬挂监听器卸掉
    if (recordingHandlerRef.current) {
      window.removeEventListener('keydown', recordingHandlerRef.current)
      recordingHandlerRef.current = null
    }
    setIsRecording(field)

    const isMac =
      typeof navigator !== 'undefined' &&
      /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      // Esc 取消录制
      if (e.key === 'Escape') {
        setIsRecording(null)
        window.removeEventListener('keydown', handleKeyDown)
        recordingHandlerRef.current = null
        return
      }

      const modifiers: string[] = []
      // 区分 Cmd 和 Ctrl - 之前用 CmdOrCtrl 把 mac 的 Ctrl 也写成 Cmd 是错的
      if (isMac) {
        if (e.metaKey) modifiers.push('Cmd')
        if (e.ctrlKey) modifiers.push('Ctrl')
      } else {
        if (e.ctrlKey) modifiers.push('Ctrl')
        if (e.metaKey) modifiers.push('Super')
      }
      if (e.altKey) modifiers.push(isMac ? 'Option' : 'Alt')
      if (e.shiftKey) modifiers.push('Shift')

      // 派生主键:优先 e.code(不受 Shift 影响,KeyA / Digit1 / F1...)
      // global-hotkey 的解析器认得 KeyA、Digit1 这类 W3C code,也认得单字符 A、1
      // 见 global-hotkey/src/hotkey.rs 的 parse_key
      const code = e.code
      let mainKey: string | null = null

      if (code.startsWith('Key')) {
        mainKey = code.slice(3) // KeyA -> A
      } else if (code.startsWith('Digit')) {
        mainKey = code.slice(5) // Digit1 -> 1
      } else if (/^F\d{1,2}$/.test(code)) {
        mainKey = code // F1...F24
      } else if (code.startsWith('Numpad')) {
        mainKey = code // Numpad0...Numpad9 NumpadAdd 等
      } else {
        // 其他特殊键直接用 e.key,但要剔除单纯的修饰键
        const k = e.key
        if (k.length === 1) {
          // 单字符 key 仍然受 Shift 影响,这里用 code 兜底
          // 比如未知键盘布局下的符号
          mainKey = k.toUpperCase()
        } else if (
          k !== 'Control' &&
          k !== 'Meta' &&
          k !== 'Alt' &&
          k !== 'Shift' &&
          k !== 'OS' &&
          k !== 'Dead' &&
          k !== 'Unidentified'
        ) {
          mainKey = k // ArrowUp / Enter / Space / Tab 等
        }
      }

      if (!mainKey || modifiers.length === 0) {
        // 还在按修饰键,或者按了无主键的组合,继续等
        return
      }

      const shortcut = [...modifiers, mainKey].join('+')
      setShortcutConfig((prev) => ({ ...prev, [field]: shortcut }))
      setIsRecording(null)
      window.removeEventListener('keydown', handleKeyDown)
      recordingHandlerRef.current = null
    }

    recordingHandlerRef.current = handleKeyDown
    window.addEventListener('keydown', handleKeyDown)
  }

  // 保存 AI 配置
  const handleSaveAi = async () => {
    setAiSaveStatus('saving')
    try {
      await saveAiConfig(aiConfig)
      setAiSaveStatus('success')
      setTimeout(() => setAiSaveStatus('idle'), 2000)
    } catch (error) {
      console.error('Failed to save AI config:', error)
      setAiSaveStatus('idle')
    }
  }

  // 测试 AI 接口:发一次最小请求,只看是否能正常拿到非空响应
  const handleTestAi = async () => {
    setAiTestStatus('testing')
    setAiTestMessage('')
    try {
      // 用一段无害样例触发完整链路(URL / 鉴权 / 模型名 / JSON 解析)
      await processCellWithAI('{"xxxx": "vvv"}', {
        instruction: '原样返回',
        config: aiConfig,
      })
      setAiTestStatus('ok')
      setAiTestMessage('成功')
    } catch (error) {
      setAiTestStatus('fail')
      const detail = error instanceof Error ? error.message : ''
      setAiTestMessage(detail ? `失败:${detail}` : '失败')
    }
    setTimeout(() => {
      setAiTestStatus('idle')
      setAiTestMessage('')
    }, 6000)
  }

  const handleResetAiPrompt = () => {
    setAiConfig((prev) => ({ ...prev, systemPrompt: DEFAULT_AI_CONFIG.systemPrompt }))
  }

  // 保存快捷键配置
  const handleSaveShortcuts = async () => {
    setSaveStatus('saving')
    setShortcutErrors({})
    try {
      await saveShortcutConfig(shortcutConfig)
      await unregisterGlobalShortcuts()
      const results = await registerGlobalShortcuts()
      const errs: Record<string, string> = {}
      for (const r of results) {
        if (!r.ok) errs[r.name] = r.error ?? '注册失败（多半被其他 App 占用）'
      }
      setShortcutErrors(errs)
      setSaveStatus('success')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (error) {
      console.error('Failed to save shortcuts:', error)
      setSaveStatus('idle')
    }
  }

  const switchTab = (tab: SettingsTab) => {
    setActiveTab(tab)
    window.history.replaceState(null, '', `/settings?tab=${tab}`)
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-[13px]">
      {/* 顶栏：与主页面统一的高度,留 traffic lights 空间,可拖拽 */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-1.5 pl-[72px] pr-3 h-[28px] shrink-0 border-b border-border/40"
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/")}
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          title="返回"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <span className="text-[13px] font-medium text-foreground/90">设置</span>
      </div>

      <ScrollArea data-settings-scroll className="h-[calc(100vh-28px)]">
        <div className="max-w-2xl mx-auto px-5 py-5 space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/35 p-1">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => switchTab(tab.id)}
                className={`h-7 rounded px-2 text-[12px] font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'basic' && (
            <>
          {/* 主题设置 */}
          <Card className="gap-0 py-0">
            <CardHeader className="pt-3.5 pb-2 px-4">
              <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Sun className="h-3.5 w-3.5" />
                外观
              </CardTitle>
              <CardDescription className="text-[11px]">
                选择您喜欢的主题模式
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-3 px-4">
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setTheme("light")}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-md border transition-colors ${
                    theme === "light"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-accent/50"
                  }`}
                >
                  <Sun className="h-4 w-4" />
                  <span className="text-[12px] font-medium">浅色</span>
                </button>

                <button
                  onClick={() => setTheme("dark")}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-md border transition-colors ${
                    theme === "dark"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-accent/50"
                  }`}
                >
                  <Moon className="h-4 w-4" />
                  <span className="text-[12px] font-medium">深色</span>
                </button>

                <button
                  onClick={() => setTheme("system")}
                  className={`flex flex-col items-center gap-1.5 py-3 rounded-md border transition-colors ${
                    theme === "system"
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40 hover:bg-accent/50"
                  }`}
                >
                  <Monitor className="h-4 w-4" />
                  <span className="text-[12px] font-medium">系统</span>
                </button>
              </div>

              <div className="pt-2 border-t text-[11px] text-muted-foreground">
                当前主题：
                <span className="font-medium text-foreground ml-1.5">
                  {theme === "system" ? `系统 (${resolvedTheme})` : theme}
                </span>
              </div>

              <div className="pt-3 border-t space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <Type className="h-3.5 w-3.5" />
                    编辑器字号
                  </label>
                  <span className="text-[12px] font-mono tabular-nums text-foreground">
                    {appConfig.editorFontSize}px
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-[14px]"
                    onClick={() =>
                      setAppConfig((prev) => ({
                        ...prev,
                        editorFontSize: clampEditorFontSize(prev.editorFontSize - EDITOR_FONT_SIZE_STEP),
                      }))
                    }
                    disabled={appConfig.editorFontSize <= EDITOR_FONT_SIZE_MIN}
                    title="减小字号 (⌘-)"
                  >
                    −
                  </Button>
                  <input
                    type="range"
                    min={EDITOR_FONT_SIZE_MIN}
                    max={EDITOR_FONT_SIZE_MAX}
                    step={EDITOR_FONT_SIZE_STEP}
                    value={appConfig.editorFontSize}
                    onChange={(e) =>
                      setAppConfig((prev) => ({
                        ...prev,
                        editorFontSize: clampEditorFontSize(Number(e.target.value)),
                      }))
                    }
                    className="flex-1 h-1.5 accent-primary cursor-pointer"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-[14px]"
                    onClick={() =>
                      setAppConfig((prev) => ({
                        ...prev,
                        editorFontSize: clampEditorFontSize(prev.editorFontSize + EDITOR_FONT_SIZE_STEP),
                      }))
                    }
                    disabled={appConfig.editorFontSize >= EDITOR_FONT_SIZE_MAX}
                    title="增大字号 (⌘+)"
                  >
                    +
                  </Button>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    范围 {EDITOR_FONT_SIZE_MIN}–{EDITOR_FONT_SIZE_MAX}px，默认 {EDITOR_FONT_SIZE_DEFAULT}px
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAppConfig((prev) => ({
                        ...prev,
                        editorFontSize: EDITOR_FONT_SIZE_DEFAULT,
                      }))
                    }
                    className="hover:text-foreground underline-offset-2 hover:underline"
                  >
                    恢复默认
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  快捷键：<kbd className="px-1 py-0.5 rounded border bg-muted/50 font-mono text-[10px]">⌘-</kbd>
                  {' '}缩小 ·{' '}
                  <kbd className="px-1 py-0.5 rounded border bg-muted/50 font-mono text-[10px]">⌘+</kbd>
                  {' '}放大 ·{' '}
                  <kbd className="px-1 py-0.5 rounded border bg-muted/50 font-mono text-[10px]">⌘0</kbd>
                  {' '}重置
                </p>
              </div>

              <div className="pt-3 border-t space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <label className="text-[12px] font-medium text-muted-foreground flex items-center gap-1.5">
                      <ListOrdered className="h-3.5 w-3.5 shrink-0" />
                      显示行号
                    </label>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      在单元格编辑器左侧显示行号与折叠槽。首次使用默认关闭。
                    </p>
                  </div>
                  <Button
                    variant={appConfig.editorLineNumbers ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 shrink-0 px-3 text-[12px]"
                    onClick={() =>
                      setAppConfig((prev) => ({
                        ...prev,
                        editorLineNumbers: !prev.editorLineNumbers,
                      }))
                    }
                    aria-pressed={appConfig.editorLineNumbers}
                  >
                    {appConfig.editorLineNumbers ? '已开启' : '已关闭'}
                  </Button>
                </div>
              </div>

            </CardContent>
          </Card>

          {/* 存储信息 */}
          <Card className="gap-0 py-0">
            <CardHeader className="pt-3.5 pb-2 px-4">
              <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
                <FileText className="h-3.5 w-3.5" />
                数据存储
              </CardTitle>
              <CardDescription className="text-[11px]">
                查看笔记数据的存储位置
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-3 px-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">存储目录</label>
                <div className="px-2.5 py-2 bg-muted/50 rounded-md font-mono text-[11px] break-all border">
                  {storagePath || "加载中..."}
                </div>
              </div>

              <div className="pt-2 border-t text-[11px] text-muted-foreground leading-relaxed">
                笔记与配置均保存在此目录下。备份整个文件夹即可保留全部数据。
              </div>

              <div className="pt-3 border-t space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-medium text-muted-foreground flex items-center gap-1.5">
                    <ClipboardList className="h-3.5 w-3.5" />
                    剪切板历史缓存数量
                  </label>
                  <span className="text-[12px] font-mono tabular-nums text-foreground">
                    {appConfig.clipboardHistoryLimit}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  快捷复制结果中显示的系统剪切板历史条数，超出上限的旧记录会被自动丢弃。
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-[14px]"
                    onClick={() =>
                      setAppConfig((prev) => ({
                        ...prev,
                        clipboardHistoryLimit: clampClipboardHistoryLimit(
                          prev.clipboardHistoryLimit - CLIPBOARD_HISTORY_LIMIT_STEP,
                        ),
                      }))
                    }
                    disabled={appConfig.clipboardHistoryLimit <= CLIPBOARD_HISTORY_LIMIT_MIN}
                  >
                    −
                  </Button>
                  <input
                    type="range"
                    min={CLIPBOARD_HISTORY_LIMIT_MIN}
                    max={CLIPBOARD_HISTORY_LIMIT_MAX}
                    step={CLIPBOARD_HISTORY_LIMIT_STEP}
                    value={appConfig.clipboardHistoryLimit}
                    onChange={(e) =>
                      setAppConfig((prev) => ({
                        ...prev,
                        clipboardHistoryLimit: clampClipboardHistoryLimit(Number(e.target.value)),
                      }))
                    }
                    className="flex-1 h-1.5 accent-primary cursor-pointer"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-[14px]"
                    onClick={() =>
                      setAppConfig((prev) => ({
                        ...prev,
                        clipboardHistoryLimit: clampClipboardHistoryLimit(
                          prev.clipboardHistoryLimit + CLIPBOARD_HISTORY_LIMIT_STEP,
                        ),
                      }))
                    }
                    disabled={appConfig.clipboardHistoryLimit >= CLIPBOARD_HISTORY_LIMIT_MAX}
                  >
                    +
                  </Button>
                </div>
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    范围 {CLIPBOARD_HISTORY_LIMIT_MIN}–{CLIPBOARD_HISTORY_LIMIT_MAX} 条，默认 {CLIPBOARD_HISTORY_LIMIT_DEFAULT} 条
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setAppConfig((prev) => ({
                        ...prev,
                        clipboardHistoryLimit: CLIPBOARD_HISTORY_LIMIT_DEFAULT,
                      }))
                    }
                    className="hover:text-foreground underline-offset-2 hover:underline"
                  >
                    恢复默认
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 最近删除 */}
          <Card className="gap-0 py-0">
            <CardHeader className="pt-3.5 pb-2 px-4">
              <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Trash2 className="h-3.5 w-3.5" />
                最近删除
              </CardTitle>
              <CardDescription className="text-[11px]">
                最多保留最近 5 条已删除的笔记;超出时最早删除的条目会被永久移除。点击即可恢复。
              </CardDescription>
            </CardHeader>
            <CardContent className="py-3 px-4">
              {deletedNotes.length === 0 ? (
                <div className="text-center py-5 text-muted-foreground">
                  <Trash2 className="h-6 w-6 mx-auto mb-1.5 opacity-30" />
                  <p className="text-[12px]">没有已删除的笔记</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {deletedNotes.map(note => (
                    <div
                      key={note.id}
                      className="flex items-center justify-between px-2 py-1.5 rounded-md border bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium truncate">{note.title || 'Untitled'}</p>
                        {note.deletedAt && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            删除于 {new Date(note.deletedAt).toLocaleDateString('zh-CN')}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRestore(note.id)}
                        className="ml-2 h-6 px-2 gap-1 text-[11px]"
                      >
                        <RotateCcw className="h-3 w-3" />
                        恢复
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
            </>
          )}

          {activeTab === 'quick-copy' && (
            <>
          {/* 快捷窗口 */}
          <Card className="gap-0 py-0">
            <CardHeader className="pt-3.5 pb-2 px-4">
              <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
                <AppWindow className="h-3.5 w-3.5" />
                快捷窗口
              </CardTitle>
              <CardDescription className="text-[11px]">
                配置唤出快捷键
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-3 px-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">快捷复制面板</label>
                <div className="flex items-center gap-2">
                  <Input
                    value={shortcutConfig.quickCopy}
                    readOnly
                    className="font-mono text-[12px] h-7 cursor-pointer"
                    onClick={() => handleRecordShortcut('quickCopy')}
                    placeholder={isRecording === 'quickCopy' ? "按下快捷键..." : "未设置"}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[12px]"
                    onClick={() => {
                      if (recordingHandlerRef.current) {
                        window.removeEventListener('keydown', recordingHandlerRef.current)
                        recordingHandlerRef.current = null
                      }
                      setIsRecording(null)
                      setShortcutConfig((prev) => ({ ...prev, quickCopy: '' }))
                    }}
                    disabled={!shortcutConfig.quickCopy && isRecording !== 'quickCopy'}
                    title="清空快捷键"
                  >
                    清空
                  </Button>
                  {isRecording === 'quickCopy' && (
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      请按下组合键
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  唤出快捷复制 Pop-up。默认{' '}
                  <kbd className="px-1 py-0.5 rounded border bg-muted/50 font-mono text-[10px]">⌘⇧B</kbd>
                  {' / '}
                  <kbd className="px-1 py-0.5 rounded border bg-muted/50 font-mono text-[10px]">Ctrl⇧B</kbd>
                  。点击输入框可改键，按 Esc 取消录制；清空后不会注册全局快捷键。
                </p>
                {shortcutErrors.quickCopy && (
                  <p className="text-[11px] text-destructive">
                    注册失败：{shortcutErrors.quickCopy}（多半被其他 App 占用，请换一个组合）
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t">
                <div className="min-w-0">
                  <label className="text-[12px] font-medium text-muted-foreground">
                    动画效果
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                    关闭后，快捷窗口会尽量减少过渡和动画，以降低低配置机型上的卡顿。
                  </p>
                </div>
                <Button
                  type="button"
                  variant={appConfig.quickCopyAnimations ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 shrink-0 px-3 text-[12px]"
                  onClick={() =>
                    setAppConfig((prev) => ({
                      ...prev,
                      quickCopyAnimations: !prev.quickCopyAnimations,
                    }))
                  }
                  aria-pressed={appConfig.quickCopyAnimations}
                >
                  {appConfig.quickCopyAnimations ? '已开启' : '已关闭'}
                </Button>
              </div>

              <div className="pt-2 border-t">
                <Button
                  onClick={handleSaveShortcuts}
                  disabled={saveStatus === 'saving'}
                  size="sm"
                  className="w-full h-7 text-[12px]"
                >
                  {saveStatus === 'saving' ? (
                    <>保存中...</>
                  ) : saveStatus === 'success' ? (
                    <>已保存 ✓</>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      保存配置
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
            </>
          )}

          {activeTab === 'ai' && (
            <>
          {/* AI 配置 */}
          <Card className="gap-0 py-0">
            <CardHeader className="pt-3.5 pb-2 px-4">
              <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Sparkles className="h-3.5 w-3.5" />
                AI 加工
              </CardTitle>
              <CardDescription className="text-[11px]">
                兼容 OpenAI Chat Completions 协议(/v1/chat/completions),用于 quick-copy 的 AI 加工
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-3 px-4">
              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">Base URL</label>
                <Input
                  value={aiConfig.baseUrl}
                  onChange={(e) => setAiConfig((p) => ({ ...p, baseUrl: e.target.value }))}
                  placeholder="https://api.openai.com/v1"
                  className="font-mono text-[12px] h-7"
                />
                <p className="text-[11px] text-muted-foreground">
                  自动补 /chat/completions;也支持 Azure OpenAI、DeepSeek、SiliconFlow 等兼容端点。
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">API Key</label>
                <Input
                  type="password"
                  value={aiConfig.apiKey}
                  onChange={(e) => setAiConfig((p) => ({ ...p, apiKey: e.target.value }))}
                  placeholder="sk-..."
                  className="font-mono text-[12px] h-7"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[12px] font-medium text-muted-foreground">Model</label>
                <Input
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig((p) => ({ ...p, model: e.target.value }))}
                  placeholder="gpt-4o-mini"
                  className="font-mono text-[12px] h-7"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[12px] font-medium text-muted-foreground">系统提示词</label>
                  <button
                    type="button"
                    onClick={handleResetAiPrompt}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                  >
                    恢复默认
                  </button>
                </div>
                <Textarea
                  value={aiConfig.systemPrompt}
                  onChange={(e) => setAiConfig((p) => ({ ...p, systemPrompt: e.target.value }))}
                  rows={6}
                  className="text-[12px] font-mono leading-relaxed"
                />
                <p className="text-[11px] text-muted-foreground">
                  默认提示词强约束模型只输出「处理结果」——无解释、无 markdown 包裹,适合直接回填 cell。
                </p>
              </div>

              <div className="pt-2 border-t flex items-center gap-2">
                <Button
                  onClick={handleSaveAi}
                  disabled={aiSaveStatus === 'saving'}
                  size="sm"
                  className="flex-1 h-7 text-[12px]"
                >
                  {aiSaveStatus === 'saving' ? (
                    <>保存中...</>
                  ) : aiSaveStatus === 'success' ? (
                    <>已保存 ✓</>
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5 mr-1.5" />
                      保存 AI 配置
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleTestAi}
                  disabled={aiTestStatus === 'testing' || !aiConfig.apiKey || !aiConfig.baseUrl || !aiConfig.model}
                  variant={aiTestStatus === 'fail' ? 'destructive' : 'outline'}
                  size="sm"
                  className={`h-7 min-w-[6.5rem] text-[12px] ${
                    aiTestStatus === 'ok'
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300'
                      : ''
                  }`}
                  title={aiTestStatus === 'fail' && aiTestMessage ? aiTestMessage : '发送固定样例验证返回格式'}
                >
                  {aiTestStatus === 'testing' ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      测试中
                    </>
                  ) : aiTestStatus === 'ok' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      连接成功
                    </>
                  ) : aiTestStatus === 'fail' ? (
                    <>
                      <XCircle className="h-3.5 w-3.5 mr-1.5" />
                      连接失败
                    </>
                  ) : (
                    <>测试连接</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
