import type { QuickCopyMenuItem } from '@/types/note'
import { itemDisplayLabel } from '@/lib/note-segments'

export { itemDisplayLabel }

export type QuickCopyAction = 'copy' | 'args' | 'prompt'

export interface QuickCopyActionMeta {
  id: QuickCopyAction
  label: string
}

export const QUICK_COPY_ACTIONS: Record<QuickCopyAction, QuickCopyActionMeta> = {
  copy: { id: 'copy', label: 'Copy' },
  args: { id: 'args', label: 'Fill' },
  prompt: { id: 'prompt', label: 'AI' },
}

export interface QuickCopySearchQuery {
  action: QuickCopyAction | null
  scope: 'all' | 'tag' | 'direct-ai'
  text: string
}

export function parseQuickCopySearchQuery(query: string): QuickCopySearchQuery {
  const trimmed = query.trimStart()
  const prefix = trimmed[0]

  if (trimmed.startsWith('@@')) {
    return { action: null, scope: 'direct-ai', text: trimmed.slice(2).trimStart() }
  }

  if (prefix === '$') {
    return { action: 'args', scope: 'all', text: trimmed.slice(1).trimStart() }
  }

  if (prefix === '@') {
    return { action: 'prompt', scope: 'all', text: trimmed.slice(1).trimStart() }
  }

  if (prefix === '/') {
    return { action: null, scope: 'tag', text: trimmed.slice(1).trimStart() }
  }

  return { action: null, scope: 'all', text: trimmed }
}

export function itemSupportsPrompt(item: QuickCopyMenuItem): boolean {
  return (item.prompts?.length ?? 0) > 0
}

export function itemSupportsArgs(item: QuickCopyMenuItem): boolean {
  return item.hasArgsPlaceholder === true
}

export function getQuickCopyActions(item: QuickCopyMenuItem): QuickCopyAction[] {
  const actions: QuickCopyAction[] = []
  if (itemSupportsPrompt(item)) actions.push('prompt')
  if (itemSupportsArgs(item)) actions.push('args')
  actions.push('copy')
  return actions
}

export function getDefaultQuickCopyAction(item: QuickCopyMenuItem): QuickCopyAction {
  return getQuickCopyActions(item)[0] ?? 'copy'
}

export function nextQuickCopyAction(
  item: QuickCopyMenuItem,
  current: QuickCopyAction,
  reverse = false,
): QuickCopyAction {
  const actions = getQuickCopyActions(item)
  const idx = actions.indexOf(current)
  if (idx < 0) return getDefaultQuickCopyAction(item)
  const next = reverse
    ? (idx - 1 + actions.length) % actions.length
    : (idx + 1) % actions.length
  return actions[next]
}

export function searchQuickCopyItems(
  items: QuickCopyMenuItem[],
  query: string,
): QuickCopyMenuItem[] {
  const parsed = parseQuickCopySearchQuery(query)
  if (parsed.scope === 'direct-ai') return []

  const q = parsed.text.trim().toLowerCase()
  const action = parsed.action
  const actionItems = action
    ? items.filter((item) => getQuickCopyActions(item).includes(action))
    : items
  const scopedItems = parsed.scope === 'tag'
    ? actionItems.filter((item) => (item.tags ?? []).length > 0)
    : actionItems

  if (!q) return scopedItems

  return scopedItems.filter((item) => {
    if (parsed.scope === 'tag') {
      return (item.tags ?? []).some((tag) => tag.toLowerCase().includes(q))
    }

    if (item.label.toLowerCase().includes(q)) return true
    if (item.noteTitle?.toLowerCase().includes(q)) return true
    if (item.body.toLowerCase().includes(q)) return true
    if (item.content.toLowerCase().includes(q)) return true
    if ((item.tags ?? []).some((tag) => tag.toLowerCase().includes(q))) return true
    if ((item.prompts ?? []).some((prompt) => prompt.toLowerCase().includes(q))) return true
    if (item.hasArgsPlaceholder) {
      return extractArgsContextPreviews(item.body).some((preview) =>
        preview.toLowerCase().includes(q),
      )
    }
    return false
  })
}

export function sortQuickCopyItems(items: QuickCopyMenuItem[], query: string): QuickCopyMenuItem[] {
  const parsed = parseQuickCopySearchQuery(query)
  if (parsed.scope === 'direct-ai') return []

  const q = parsed.text.trim().toLowerCase()
  return [...items].sort(
    (a, b) =>
      scoreQuickCopyItem(b, q, parsed.action, parsed.scope) -
      scoreQuickCopyItem(a, q, parsed.action, parsed.scope),
  )
}

function scoreQuickCopyItem(
  item: QuickCopyMenuItem,
  q: string,
  action: QuickCopyAction | null,
  scope: QuickCopySearchQuery['scope'],
): number {
  let score = 0
  if (item.source === 'history') score -= 80
  if (action && getQuickCopyActions(item).includes(action)) score += 60
  if (scope === 'tag') score += 40
  if (!q) return score

  const label = itemDisplayLabel(item).toLowerCase()
  const title = item.noteTitle?.toLowerCase() ?? ''
  const tags = (item.tags ?? []).join(' ').toLowerCase()
  const prompts = (item.prompts ?? []).join(' ').toLowerCase()
  const body = item.body.toLowerCase()

  if (label === q) score += 220
  if (label.startsWith(q)) score += 180
  if (label.includes(q)) score += 140
  if (tags.includes(q)) score += 120
  if (title.includes(q)) score += 80
  if (prompts.includes(q)) score += 70
  if (body.includes(q)) score += 30
  return score
}

/** 将正文中所有 `$$` 替换为用户输入。 */
export function applyArgsPlaceholder(body: string, replacement: string): string {
  return body.split('$$').join(replacement)
}

export type QuickCopyRowTagVariant = 'comment' | 'history'

export interface QuickCopyRowTag {
  key: string
  text: string
  variant: QuickCopyRowTagVariant
}

function extractArgsContextPreviews(
  body: string,
  contextChars = 10,
  maxChipLen = 28,
): string[] {
  if (!body.includes('$$')) return []
  const parts = body.split('$$')
  const previews: string[] = []

  for (let i = 0; i < parts.length - 1; i++) {
    const before = parts[i].trim().slice(-contextChars)
    const after = parts[i + 1].trim().slice(0, contextChars)
    let text = ''
    if (before && after) text = `${before}…${after}`
    else if (before) text = `${before}…`
    else if (after) text = `…${after}`
    else text = '$$'
    text = text.replace(/\s+/g, ' ').trim()
    if (text.length > maxChipLen) text = `${text.slice(0, maxChipLen - 1)}…`
    previews.push(text)
  }

  return previews
}

/** 列表行右侧 tag：来源、元信息。 */
export function buildQuickCopyRowTags(item: QuickCopyMenuItem): QuickCopyRowTag[] {
  const chips: QuickCopyRowTag[] = []

  if (item.source === 'history') {
    chips.push({ key: 'history', text: 'History', variant: 'history' })
  }

  for (const tag of item.tags ?? []) {
    const text = tag.trim()
    if (!text) continue
    chips.push({ key: `comment:${text}`, text, variant: 'comment' })
  }

  return chips
}
