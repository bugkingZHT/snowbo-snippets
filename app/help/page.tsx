"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  AtSign,
  ArrowLeft,
  Copy,
  DollarSign,
  Keyboard,
  Sparkles,
  Tag,
} from "lucide-react"
import { useRouter } from "next/navigation"

type HelpTab = 'markers' | 'quick-copy'

const HELP_TABS: Array<{ id: HelpTab; label: string }> = [
  { id: 'markers', label: '片段标记' },
  { id: 'quick-copy', label: '快捷窗口' },
]

function isHelpTab(tab: string | null): tab is HelpTab {
  return tab === 'markers' || tab === 'quick-copy'
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

function HintCard({
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
      <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground/90">
        {icon}
        {title}
      </div>
      <div className="text-[11px] leading-relaxed text-muted-foreground">{children}</div>
    </div>
  )
}

function MarkerCard({
  marker,
  title,
  children,
}: {
  marker: string
  title: string
  children: ReactNode
}) {
  return (
    <div className="h-full rounded-md border border-border/60 bg-background/70 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <InlineCode>{marker}</InlineCode>
        <span className="text-[12px] font-medium text-foreground/90">{title}</span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

export default function HelpPage() {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<HelpTab>('markers')

  useEffect(() => {
    const readTabFromUrl = () => {
      const tab = new URLSearchParams(window.location.search).get('tab')
      setActiveTab(isHelpTab(tab) ? tab : 'markers')
    }

    readTabFromUrl()
    window.addEventListener('popstate', readTabFromUrl)
    return () => window.removeEventListener('popstate', readTabFromUrl)
  }, [])

  const switchTab = (tab: HelpTab) => {
    setActiveTab(tab)
    window.history.replaceState(null, '', `/help?tab=${tab}`)
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-background text-[13px]">
      <div
        data-tauri-drag-region
        className="flex h-[28px] shrink-0 items-center gap-1.5 border-b border-border/40 pl-[72px] pr-3"
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
        <span className="text-[13px] font-medium text-foreground/90">帮助</span>
      </div>

      <ScrollArea className="h-[calc(100vh-28px)]">
        <div className="max-w-2xl mx-auto px-5 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/35 p-1">
            {HELP_TABS.map((tab) => (
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

          {activeTab === 'markers' && (
          <Card className="gap-0 py-0">
            <CardHeader className="pt-3.5 pb-2 px-4">
              <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Copy className="h-3.5 w-3.5 text-[#007AFF]" />
                片段标记笔记
              </CardTitle>
              <CardDescription className="text-[11px]">
                标题负责识别，tag 负责召回，输入槽和 AI 指令负责动作。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-3 px-4">
              <div className="grid auto-rows-fr grid-cols-2 gap-2">
                <MarkerCard marker="--" title="切成多个片段">
                  单独一行且只包含 <InlineCode>--</InlineCode> 时，会把一篇笔记拆成多个快捷条目。
                </MarkerCard>
                <MarkerCard marker="//" title="标题与 tag">
                  <InlineCode>{"// title:"}</InlineCode>
                  {" 作为结果标题；"}
                  <InlineCode>{"// tag:"}</InlineCode>
                  {" 作为搜索标签。普通 "}
                  <InlineCode>{"// xxx"}</InlineCode>
                  {" 也会变成 alias / tag。"}
                </MarkerCard>
                <MarkerCard marker="$$" title="替换输入槽">
                  正文里的所有 <InlineCode>$$</InlineCode> 会在 Fill 时被同一段输入替换。
                </MarkerCard>
                <MarkerCard marker="@@" title="提示词指令">
                  行首 <InlineCode>@@</InlineCode> 是这个片段的 AI 提示词，不进入 Copy 正文。
                </MarkerCard>
              </div>

              <HintCard
                icon={<Copy className="h-3.5 w-3.5 text-[#007AFF]" />}
                title="完整笔记例子"
              >
                这里同时放了 Linux 命令片段、Linux 命令替换实例，以及 git commit message 提示词。
                <Example>{`// title: 查端口占用
// tag: linux port network
lsof -i :$$
--
// title: 查看目录大小
// tag: linux disk size
du -sh $$
--
// title: Git commit message
// tag: git ai commit
@@ 根据下面的 diff 摘要生成一行 conventional commit message
$$`}</Example>
              </HintCard>
            </CardContent>
          </Card>
          )}

          {activeTab === 'quick-copy' && (
          <Card className="gap-0 py-0">
            <CardHeader className="pt-3.5 pb-2 px-4">
              <CardTitle className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Keyboard className="h-3.5 w-3.5" />
                快捷窗口搜索
              </CardTitle>
              <CardDescription className="text-[11px]">
                普通输入会搜索全部内容；加前缀可以直接切到目标动作。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 py-3 px-4">
              <div className="grid auto-rows-fr grid-cols-2 gap-2">
                <HintCard
                  icon={<DollarSign className="h-3.5 w-3.5 text-orange-500" />}
                  title="Fill index"
                >
                  <InlineCode>$</InlineCode> 只看带 <InlineCode>$$</InlineCode> 输入槽的片段，并默认执行 Fill。
                  <Example>{`$ port
$ disk`}</Example>
                </HintCard>
                <HintCard
                  icon={<AtSign className="h-3.5 w-3.5 text-violet-600" />}
                  title="AI index"
                >
                  <InlineCode>@</InlineCode> 只看带 <InlineCode>@@</InlineCode> 指令的片段，并默认执行 AI。
                  <Example>{`@ commit
@ conventional`}</Example>
                </HintCard>
                <HintCard
                  icon={<Sparkles className="h-3.5 w-3.5 text-violet-600" />}
                  title="Direct AI"
                >
                  <InlineCode>@@</InlineCode> 不引用任何片段，直接把搜索栏内容交给 AI。
                  <Example>{`@@ write a commit message
@@ explain this shell error`}</Example>
                </HintCard>
                <HintCard
                  icon={<Tag className="h-3.5 w-3.5 text-emerald-600" />}
                  title="Tag index"
                >
                  <InlineCode>/</InlineCode> 只按 tag / alias 搜索，不匹配正文。
                  <Example>{`/ linux
/ git`}</Example>
                </HintCard>
              </div>

              <div className="rounded-md border border-border/60 bg-background/70 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                <InlineCode>Enter</InlineCode> 执行当前动作；Fill / AI 会进入输入阶段。
                <span className="ml-2">
                  <InlineCode>Esc</InlineCode> 从输入阶段回到搜索，再按一次关闭窗口。
                </span>
              </div>

              <HintCard
                icon={<DollarSign className="h-3.5 w-3.5 text-orange-500" />}
                title="替换实例"
              >
                选择 <InlineCode>查端口占用</InlineCode> 后输入端口号，命令里的输入槽会被替换。
                <Example>{`搜索：$ port
输入：3000
结果：lsof -i :3000`}</Example>
              </HintCard>

              <HintCard
                icon={<Sparkles className="h-3.5 w-3.5 text-violet-600" />}
                title="提示词实例"
              >
                选择 <InlineCode>Git commit message</InlineCode> 后粘贴 diff 摘要，让 AI 生成 commit message。
                <Example>{`搜索：@ commit
输入：help page split into two columns
结果：refactor(help): split help content into columns`}</Example>
              </HintCard>
            </CardContent>
          </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
