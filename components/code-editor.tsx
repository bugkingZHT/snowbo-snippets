"use client"
import { useEffect, useRef } from 'react'
import { EditorState, Compartment, EditorSelection, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  ViewPlugin,
  type ViewUpdate,
  placeholder as cmPlaceholder,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewline,
} from '@codemirror/commands'
import {
  HighlightStyle,
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { lintKeymap } from '@codemirror/lint'
import { tags as t } from '@lezer/highlight'
import { javascript } from '@codemirror/lang-javascript'

interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  className?: string
  wrap?: boolean
  showLineNumbers?: boolean
  minHeightPx?: number
  // 按 Mod-Enter (macOS Cmd+Enter / 其他平台 Ctrl+Enter) 时触发。
  // 优先级高于 defaultKeymap 的 Enter→insertNewline，由我们 preventDefault。
  // 不传则按键无特殊行为。
  onSubmit?: () => void
  // 文档为空时显示的占位文案。
  placeholder?: string
  // 挂载后是否自动 focus。
  autoFocus?: boolean
  // 填满父容器高度
  fillHeight?: boolean
  /** 递增时请求 focus */
  focusSignal?: number
  /** 只读模式 */
  readOnly?: boolean
}

/** 有非空选区时给编辑器根节点加 class，用于关闭行高亮、避免与选区背景叠色。 */
const selectionAwareState = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.sync(view)
    }
    update(update: ViewUpdate) {
      if (update.selectionSet) this.sync(update.view)
    }
    sync(view: EditorView) {
      view.dom.classList.toggle('cm-has-selection', !view.state.selection.main.empty)
    }
  },
)

// 统一使用 javascript 高亮。JSON 是 javascript 的真子集;纯文本则保持朴素显示。
const unifiedLanguageExtension: Extension = javascript({ jsx: false, typescript: false })

// 自定义两套高亮：浅色用偏柔和的色调，深色用偏明亮的色调，避免默认高亮在白底刺眼。
const lightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#7c3aed', fontWeight: '500' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#0f172a' },
  { tag: [t.function(t.variableName), t.labelName], color: '#2563eb' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#0891b2' },
  { tag: [t.definition(t.name), t.separator], color: '#0f172a' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#0d9488' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#b91c1c' },
  { tag: [t.meta, t.comment], color: '#64748b', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#2563eb', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '600', color: '#0f172a' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#b45309' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#15803d' },
  { tag: t.invalid, color: '#dc2626' },
])

const darkHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: '#c084fc', fontWeight: '500' },
  { tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName], color: '#e2e8f0' },
  { tag: [t.function(t.variableName), t.labelName], color: '#60a5fa' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: '#22d3ee' },
  { tag: [t.definition(t.name), t.separator], color: '#e2e8f0' },
  { tag: [t.typeName, t.className, t.number, t.changed, t.annotation, t.modifier, t.self, t.namespace], color: '#5eead4' },
  { tag: [t.operator, t.operatorKeyword, t.url, t.escape, t.regexp, t.link, t.special(t.string)], color: '#f87171' },
  { tag: [t.meta, t.comment], color: '#94a3b8', fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: '#60a5fa', textDecoration: 'underline' },
  { tag: t.heading, fontWeight: '600', color: '#f8fafc' },
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#fbbf24' },
  { tag: [t.processingInstruction, t.string, t.inserted], color: '#86efac' },
  { tag: t.invalid, color: '#f87171' },
])

const baseTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size, 12px)',
    backgroundColor: 'var(--card)',
    color: 'var(--foreground)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    paddingTop: '10px',
    paddingBottom: '10px',
    paddingRight: '12px',
    paddingLeft: '4px',
    caretColor: 'var(--foreground)',
  },
  // 让光标更醒目；避免在行首“看不到”
  '.cm-content .cm-cursor, .cm-content .cm-dropCursor': {
    borderLeftWidth: '2px',
    borderLeftColor: 'var(--foreground)',
    marginLeft: '0',
  },
  '&.cm-editor.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--foreground)',
  },
  '.cm-line': {
    padding: '0 2px',
  },
  // 光标所在行（VS Code editor.lineHighlightBackground）；有选区时不显示
  '.cm-activeLine': {
    backgroundColor: 'var(--editor-line-highlight)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--editor-line-highlight)',
  },
  '&.cm-has-selection .cm-activeLine, &.cm-has-selection .cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  // 选区：仅蓝色背景，文字色保持原样（不反色）
  '.cm-selectionBackground, .cm-content ::selection, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--editor-selection-bg) !important',
    color: 'inherit !important',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    borderRight: '0.5px solid color-mix(in oklab, var(--border) 50%, transparent)',
    color: 'var(--muted-foreground)',
    fontSize: 'var(--editor-gutter-font-size, 12px)',
    userSelect: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 10px 0 8px',
    minWidth: '2ch',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 2px',
    color: 'var(--muted-foreground)',
    opacity: '0.6',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    opacity: '1',
  },
  // 占位符
  '.cm-placeholder': {
    color: 'var(--muted-foreground)',
    fontStyle: 'italic',
  },
  // 其他相同单词（VS Code editor.selectionHighlightBackground）
  '.cm-selectionMatch': {
    backgroundColor: 'var(--editor-selection-highlight-bg)',
    borderRadius: '2px',
  },
  // 当前选中/光标下的单词（VS Code editor.wordHighlightStrongBackground）
  '.cm-selectionMatch-main': {
    backgroundColor: 'var(--editor-word-highlight-strong-bg) !important',
    borderRadius: '2px',
  },
  // 有选区时不再叠加强调色，只保留选区蓝底
  '&.cm-has-selection .cm-selectionMatch-main': {
    backgroundColor: 'transparent !important',
  },
  // 括号匹配（VS Code editorBracketMatch）
  '.cm-matchingBracket': {
    backgroundColor: 'var(--editor-bracket-match-bg)',
    outline: '1px solid var(--editor-bracket-match-border)',
  },
  // 滚动条更细
  '.cm-scroller::-webkit-scrollbar': {
    width: '8px',
    height: '8px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    backgroundColor: 'color-mix(in oklab, var(--muted-foreground) 30%, transparent)',
    borderRadius: '4px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    backgroundColor: 'color-mix(in oklab, var(--muted-foreground) 50%, transparent)',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    backgroundColor: 'transparent',
  },
})

const detectIsDark = () => {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

export function CodeEditor({
  value,
  onChange,
  className,
  wrap = false,
  showLineNumbers = false,
  minHeightPx = 96,
  onSubmit,
  placeholder,
  autoFocus = false,
  fillHeight = false,
  focusSignal,
  readOnly = false,
}: CodeEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const valueRef = useRef(value)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    valueRef.current = value
  }, [value])
  // 用 ref 持有最新的 onSubmit，绕开 effect 重建。
  // keymap binding 在 init effect 里只读 ref.current,因此外部变更不会重建 EditorView。
  const onSubmitRef = useRef(onSubmit)
  useEffect(() => {
    onSubmitRef.current = onSubmit
  }, [onSubmit])

  // Compartments 让我们能在不重建 EditorView 的情况下切换语言/换行/行号/主题/占位符
  const languageComp = useRef(new Compartment())
  const wrapComp = useRef(new Compartment())
  const gutterComp = useRef(new Compartment())
  const themeComp = useRef(new Compartment())
  const placeholderComp = useRef(new Compartment())
  const readOnlyComp = useRef(new Compartment())

  // 初始化（只跑一次）
  useEffect(() => {
    if (!editorRef.current) return

    const isDark = detectIsDark()
    const sizeTheme = EditorView.theme(
      fillHeight
        ? {
            '&': { height: '100%', minHeight: 'unset' },
            '.cm-scroller': { height: '100%', minHeight: 'unset' },
          }
        : {
            '&': { minHeight: `${minHeightPx}px` },
            '.cm-scroller': { minHeight: `${minHeightPx}px` },
          },
    )

    const state = EditorState.create({
      doc: value,
      extensions: [
        // —— 行为 ——（不使用 basicSetup，按需组装）
        history(),
        highlightSpecialChars(),
        drawSelection({ cursorBlinkRate: 1100 }),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of('  '),
        bracketMatching(),
        closeBrackets(),
        autocompletion({ activateOnTyping: false }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        selectionAwareState,
        highlightSelectionMatches({ highlightWordAroundCursor: true, minSelectionLength: 1 }),
        keymap.of([
          // Mod-Enter 必须放在 defaultKeymap 之前，否则 defaultKeymap 的 Enter
          // 会先消费事件插入换行。preventDefault: true 同时压住浏览器原生行为。
          {
            key: 'Mod-Enter',
            preventDefault: true,
            run: () => {
              const cb = onSubmitRef.current
              if (!cb) return false
              cb()
              return true
            },
          },
          // 笔记场景：换行不继承上一行缩进，新行从行首开始。
          { key: 'Enter', run: insertNewline },
          { key: 'Shift-Enter', run: insertNewline },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          ...lintKeymap,
          indentWithTab,
        ]),

        // —— 可切换的部件 ——
        gutterComp.current.of(showLineNumbers ? [lineNumbers(), foldGutter()] : []),
        wrapComp.current.of(wrap ? EditorView.lineWrapping : []),
        languageComp.current.of(unifiedLanguageExtension),
        placeholderComp.current.of(placeholder ? cmPlaceholder(placeholder) : []),
        themeComp.current.of([
          syntaxHighlighting(isDark ? darkHighlightStyle : lightHighlightStyle, { fallback: true }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ]),

        baseTheme,
        sizeTheme,
        readOnlyComp.current.of(
          readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
        ),

        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.state.readOnly) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: editorRef.current })
    viewRef.current = view

    if (autoFocus) {
      // 等下一帧 DOM 完全挂载再 focus，避免 SSR/hydration 时机问题
      window.requestAnimationFrame(() => view.focus())
    }

    // 监听根元素 dark 类变化以切换语法高亮主题
    const observer = new MutationObserver(() => {
      const dark = detectIsDark()
      view.dispatch({
        effects: themeComp.current.reconfigure([
          syntaxHighlighting(dark ? darkHighlightStyle : lightHighlightStyle, { fallback: true }),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ]),
      })
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      observer.disconnect()
      view.destroy()
      viewRef.current = null
    }
    // 仅初始化时构造一次；后续通过 dispatch effects 增量更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // wrap 变化 → reconfigure
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    })
  }, [wrap])

  // 行号显示变化 → reconfigure
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: gutterComp.current.reconfigure(
        showLineNumbers ? [lineNumbers(), foldGutter()] : [],
      ),
    })
  }, [showLineNumbers])

  // placeholder 变化 → reconfigure
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: placeholderComp.current.reconfigure(
        placeholder ? cmPlaceholder(placeholder) : [],
      ),
    })
  }, [placeholder])

  // 只读模式
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: readOnlyComp.current.reconfigure(
        readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
    })
  }, [readOnly])

  // 外部 value 变更 → 同步内容（保留光标位置，避免输入被打断）
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    const prevSel = view.state.selection
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: EditorSelection.create(
        prevSel.ranges.map((r) => {
          const head = Math.min(r.head, value.length)
          const anchor = Math.min(r.anchor, value.length)
          return EditorSelection.range(anchor, head)
        }),
        prevSel.mainIndex,
      ),
    })
  }, [value])

  useEffect(() => {
    if (focusSignal == null || focusSignal <= 0) return
    viewRef.current?.focus()
  }, [focusSignal])

  return <div ref={editorRef} className={`relative ${className ?? ''}`} />
}
