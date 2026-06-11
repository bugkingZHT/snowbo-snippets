import type { AiConfig } from '@/types/note'
import { DEFAULT_AI_CONFIG, loadAiConfig } from './tauri-api'

export class AiNotConfiguredError extends Error {
  constructor() {
    super('AI 接口未配置:请到设置页填写 baseUrl / apiKey / model')
    this.name = 'AiNotConfiguredError'
  }
}

const stripCodeFence = (s: string): string => {
  // 模型时不时还是会用 ```...``` 包结果——按要求剥掉
  const trimmed = s.trim()
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z0-9_+-]*)\n([\s\S]*?)\n```$/)
  if (fenceMatch) return fenceMatch[1]
  return trimmed
}

const normalizeBaseUrl = (raw: string): string => {
  const u = raw.trim().replace(/\/+$/, '')
  // 用户在 baseUrl 里完整填了 .../chat/completions 时直接用,否则拼后缀
  if (u.endsWith('/chat/completions')) return u
  return `${u}/chat/completions`
}

const isConfigured = (config: AiConfig): boolean =>
  config.baseUrl.trim().length > 0 && config.apiKey.trim().length > 0 && config.model.trim().length > 0

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string }
  }>
  error?: { message?: string }
}

export interface ProcessCellOptions {
  /** 用户输入的处理指令(必填),例如「抽取 xxxx 字段的值」「翻译为英文」 */
  instruction: string
  /** 缺省时会现读 data.json 中的 ai 配置 */
  config?: AiConfig
}

/**
 * 把 cell 内容连同用户输入的处理指令一起送到 OpenAI 兼容的 chat/completions 接口,
 * 拿回模型输出后剥掉常见的 markdown 代码栅栏,作为新的 cell 内容返回。
 *
 * 协议:user message 拆成"指令" + "内容"两段(用 fenced data block 包裹原内容,
 * 防止内容里再出现自然语言被模型当指令二次解析)。
 */
export async function processCellWithAI(
  cellContent: string,
  options: ProcessCellOptions,
): Promise<string> {
  const config = options.config ?? (await loadAiConfig())
  if (!isConfigured(config)) throw new AiNotConfiguredError()

  const instruction = options.instruction.trim()
  if (!instruction) throw new Error('请填写处理指令')

  const systemPrompt = config.systemPrompt.trim() || DEFAULT_AI_CONFIG.systemPrompt
  const url = normalizeBaseUrl(config.baseUrl)

  // 用纯文本数据块隔离用户内容,避免内容里"看起来像指令"的字句污染请求。
  // cellContent 可能为空——表示从零生成,这时让模型把 instruction 当独立任务执行。
  const hasContent = cellContent.length > 0
  const userMessage = hasContent
    ? `Instruction: ${instruction}\n\n` +
      `Apply the instruction to the following content and output ONLY the processed result.\n` +
      `<content>\n${cellContent}\n</content>`
    : `Instruction: ${instruction}\n\n` +
      `The cell is currently empty. Treat the instruction as a standalone task and produce the requested output. Output ONLY the result, nothing else.`

  const body = {
    model: config.model,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as ChatCompletionResponse
      detail = j.error?.message ?? ''
    } catch {
      try {
        detail = await res.text()
      } catch {
        // ignore
      }
    }
    throw new Error(`AI 调用失败 (${res.status}): ${detail || res.statusText}`)
  }

  const json = (await res.json()) as ChatCompletionResponse
  const text = json.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('AI 返回为空')
  }
  return stripCodeFence(text)
}

export interface AiWithContextOptions {
  /** 主内容：主窗口为编辑器正文；快捷弹窗 AI 模式不传剪切板 */
  primaryContent?: string
  /** 引用的片段正文（已去掉 `//` `@@`） */
  snippetBody?: string
  /** 引用片段内 `@@` 行提取的提示词 */
  segmentPrompts?: string[]
  /** 用户输入的处理指令 */
  userInput: string
  config?: AiConfig
}

async function chatCompletionWithBlocks(
  systemPrompt: string,
  userMessage: string,
  config: AiConfig,
): Promise<string> {
  const url = normalizeBaseUrl(config.baseUrl)

  const body = {
    model: config.model,
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as ChatCompletionResponse
      detail = j.error?.message ?? ''
    } catch {
      try {
        detail = await res.text()
      } catch {
        // ignore
      }
    }
    throw new Error(`AI 调用失败 (${res.status}): ${detail || res.statusText}`)
  }

  const json = (await res.json()) as ChatCompletionResponse
  const text = json.choices?.[0]?.message?.content
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('AI 返回为空')
  }
  return stripCodeFence(text)
}

/**
 * 统一的 AI 上下文：主内容 + 引用的笔记片段 + 用户输入。
 * 主窗口主内容为编辑器；快捷弹窗 AI 模式仅使用选中的预置片段与用户输入。
 */
export async function aiWithContext(options: AiWithContextOptions): Promise<string> {
  const config = options.config ?? (await loadAiConfig())
  if (!isConfigured(config)) throw new AiNotConfiguredError()

  const input = options.userInput.trim()
  if (!input) throw new Error('请填写处理指令')

  const systemPrompt = config.systemPrompt.trim() || DEFAULT_AI_CONFIG.systemPrompt

  const blocks: string[] = []
  const primary = (options.primaryContent ?? '').trim()
  if (primary) {
    blocks.push(`<primary-content>\n${primary}\n</primary-content>`)
  }
  const snippet = options.snippetBody?.trim() ?? ''
  if (snippet) {
    blocks.push(`<referenced-snippet>\n${snippet}\n</referenced-snippet>`)
  }
  const segPrompt = (options.segmentPrompts ?? []).join('\n').trim()
  if (segPrompt) {
    blocks.push(`<snippet-prompt>\n${segPrompt}\n</snippet-prompt>`)
  }
  blocks.push(`<user-input>\n${input}\n</user-input>`)

  const userMessage =
    'Apply the system instructions to the blocks below. ' +
    'The primary content block (if present) is what the user is working on in the editor. ' +
    'Referenced snippet blocks (if any) are supplementary material from a snippet note. ' +
    'Output ONLY the processed result, no explanations.\n\n' +
    blocks.join('\n\n')

  return chatCompletionWithBlocks(systemPrompt, userMessage, config)
}
