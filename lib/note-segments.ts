export interface SegmentMarkers {
  title?: string
  tags: string[]
  prompts: string[]
  hasArgsPlaceholder: boolean
  body: string
}

/** 提示词类型片段在列表行右侧展示的小 tag 文案。 */
export const PROMPT_TYPE_TAG_LABEL = 'Prompt'

/** 将 `@@` 行后的提示词拼成列表主文案。 */
export function formatPromptDisplayLabel(prompts: string[]): string {
  const text = prompts.map((p) => p.trim()).filter(Boolean).join(' · ')
  return text || '(空)'
}

export function itemDisplayLabel(item: { label: string; prompts?: string[] }): string {
  const label = item.label.trim()
  if (label && label !== '(空)') return label
  if ((item.prompts?.length ?? 0) > 0) {
    return formatPromptDisplayLabel(item.prompts!)
  }
  return item.label
}

/** 按独立成行且仅含 `--` 的分隔线切分笔记正文。 */
export function splitContentByDashSeparator(content: string): string[] {
  const segments: string[] = []
  const chunk: string[] = []

  for (const line of content.split('\n')) {
    if (line.trim() === '--') {
      const segment = chunk.join('\n')
      if (segment.trim()) segments.push(segment)
      chunk.length = 0
    } else {
      chunk.push(line)
    }
  }

  const segment = chunk.join('\n')
  if (segment.trim()) segments.push(segment)
  return segments
}

/** 行首 `//` 为 metadata / alias / tag，`@@` 为 AI 指令，均不进入正文。 */
export function splitSegmentMarkers(content: string): SegmentMarkers {
  let title: string | undefined
  const tags: string[] = []
  const prompts: string[] = []
  const bodyLines: string[] = []

  for (const line of content.split('\n')) {
    const trimmedStart = line.trimStart()
    if (trimmedStart.startsWith('//')) {
      const meta = trimmedStart.slice(2).trimStart()
      const titleMatch = meta.match(/^(title|name)\s*:\s*(.+)$/i)
      const tagMatch = meta.match(/^(tag|tags)\s*:\s*(.+)$/i)
      if (titleMatch) {
        title = titleMatch[2].trim()
      } else if (tagMatch) {
        for (const tag of tagMatch[2].split(/[,\s]+/)) {
          const text = tag.trim()
          if (text) tags.push(text)
        }
      } else if (meta) {
        tags.push(meta)
      }
    } else if (trimmedStart.startsWith('@@')) {
      const prompt = trimmedStart.slice(2).trimStart()
      if (prompt) prompts.push(prompt)
    } else {
      bodyLines.push(line)
    }
  }

  const body = bodyLines.join('\n')
  return {
    title,
    tags,
    prompts,
    hasArgsPlaceholder: body.includes('$$'),
    body,
  }
}

export function cellLabel(content: string): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0) ?? ''
  const trimmed = firstLine.trim()
  if (!trimmed) return '(空)'
  return trimmed.replace(/\t/g, ' ')
}
