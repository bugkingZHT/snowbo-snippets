/** 输入法组字/选词过程中，或刚结束组字时的 Enter 不应触发提交。 */
export function isImeComposing(e: KeyboardEvent | React.KeyboardEvent): boolean {
  if ('nativeEvent' in e) {
    if (e.nativeEvent.isComposing) return true
  } else if (e.isComposing) {
    return true
  }
  if (e.keyCode === 229 || e.key === 'Process') return true
  return false
}

export interface ImeGuard {
  compositionProps: {
    onCompositionStart: () => void
    onCompositionEnd: () => void
  }
  shouldSkipConfirm: () => boolean
}

/** 绑定到顶部确认输入框，避免中文输入法 Enter 选词误触提交。 */
export function createImeGuard(): ImeGuard {
  let composing = false
  let skipEnterAfterComposition = false
  let resetTimer: ReturnType<typeof setTimeout> | null = null

  return {
    compositionProps: {
      onCompositionStart: () => {
        composing = true
        skipEnterAfterComposition = false
        if (resetTimer) {
          clearTimeout(resetTimer)
          resetTimer = null
        }
      },
      onCompositionEnd: () => {
        composing = false
        // 部分 IME：选词 Enter 的 keydown 紧接在 compositionend 之后
        skipEnterAfterComposition = true
        if (resetTimer) clearTimeout(resetTimer)
        resetTimer = setTimeout(() => {
          skipEnterAfterComposition = false
          resetTimer = null
        }, 30)
      },
    },
    shouldSkipConfirm: () => composing || skipEnterAfterComposition,
  }
}

export function isConfirmKey(
  e: KeyboardEvent | React.KeyboardEvent,
  imeGuard?: Pick<ImeGuard, 'shouldSkipConfirm'>,
): boolean {
  if (e.key !== 'Enter') return false
  if (isImeComposing(e)) return false
  if (imeGuard?.shouldSkipConfirm()) return false
  return !e.altKey && !e.shiftKey && !e.metaKey && !e.ctrlKey
}

/** 单行操作提示，如「搜索 (⏎)」 */
export function confirmActionLabel(action: string): string {
  return `${action} (⏎)`
}

/** 输入框 placeholder：操作 + 确认键 + Tab 切换 */
export function confirmInputPlaceholder(
  action: string,
  extra?: string,
): string {
  const suffix = extra ? ` · ${extra}` : ''
  return `${action} (⏎${suffix})`
}
