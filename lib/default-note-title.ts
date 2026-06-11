import type { Note } from '@/types/note'

/** 新建笔记时随机选用的默认标题（高原/雪域动物）。 */
export const DEFAULT_NOTE_ANIMAL_NAMES = [
  '雪豹',
  '猞猁',
  '岩羊',
  '薮猫',
  '牦牛',
  '藏羚',
  '旱獭',
  '藏狐',
  '棕熊',
  '灰狼',
  '马麝',
  '白唇鹿',
  '斑头雁',
  '黑颈鹤',
  '藏马鸡',
  '雪鸡',
  '藏野驴',
  '鼠兔',
  '高原兔',
  '狗獾',
] as const

export const NOTE_TITLE_MAX_LENGTH = 60

export function randomDefaultNoteTitle(): string {
  const index = Math.floor(Math.random() * DEFAULT_NOTE_ANIMAL_NAMES.length)
  return DEFAULT_NOTE_ANIMAL_NAMES[index]
}

/** 从正文首行推导标题：跳过空行，超长截断。 */
export function deriveNoteTitleFromContent(
  content: string,
  maxLength = NOTE_TITLE_MAX_LENGTH,
): string {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0)
  if (!firstLine) return ''
  const trimmed = firstLine.trim().replace(/\t/g, ' ')
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 1)}…`
}

/** 有自定义标题则用自定义，否则从正文推导，再否则随机动物名（仅新建笔记时使用）。 */
export function resolveNoteTitle(title: string, content: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  const derived = deriveNoteTitleFromContent(content)
  if (derived) return derived
  return randomDefaultNoteTitle()
}

/** 自动保存时推导标题：不从空正文随机取名，避免每次保存标题变化。 */
export function resolveNoteTitleOnSave(title: string, content: string): string {
  const trimmed = title.trim()
  if (trimmed) return trimmed
  return deriveNoteTitleFromContent(content) || title
}

export function isPlaceholderNoteTitle(title: string): boolean {
  const trimmed = title.trim()
  return trimmed === '' || trimmed.toLowerCase() === 'untitled'
}

/** 占位标题笔记在编辑正文时，用首行内容自动替换标题。 */
export function autoNoteTitleOnContentChange(title: string, content: string): string {
  if (!isPlaceholderNoteTitle(title)) return title
  return deriveNoteTitleFromContent(content) || title
}

export function notesWithResolvedTitles(notes: Note[]): Note[] {
  return notes.map((note) => {
    const resolved = resolveNoteTitleOnSave(note.title, note.content)
    if (resolved === note.title) return note
    return { ...note, title: resolved }
  })
}
