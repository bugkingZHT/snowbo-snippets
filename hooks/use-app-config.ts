"use client"
import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { appConfigAtom } from '@/store/note-store'
import {
  applyEditorFontSize,
  clampEditorFontSize,
  EDITOR_FONT_SIZE_DEFAULT,
  EDITOR_FONT_SIZE_STEP,
  loadAppConfig,
  saveAppConfig,
} from '@/lib/tauri-api'

/**
 * 应用顶层挂一次:加载 app 配置、同步 CSS 变量、debounce 落盘,
 * 并注册 ⌘-/⌘+/⌘0 字号快捷键(阻止浏览器默认缩放)。
 */
export function useAppConfigSync() {
  const [config, setConfig] = useAtom(appConfigAtom)
  const hydratedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    loadAppConfig()
      .then((cfg) => {
        if (cancelled) return
        setConfig(cfg)
        applyEditorFontSize(cfg.editorFontSize)
        hydratedRef.current = true
      })
      .catch((e) => {
        console.warn('[app-config] load failed:', e)
        applyEditorFontSize(EDITOR_FONT_SIZE_DEFAULT)
        hydratedRef.current = true
      })
    return () => {
      cancelled = true
    }
  }, [setConfig])

  useEffect(() => {
    applyEditorFontSize(config.editorFontSize)
  }, [config.editorFontSize])

  useEffect(() => {
    if (!hydratedRef.current) return
    const t = window.setTimeout(() => {
      saveAppConfig(config).catch((e) => console.warn('[app-config] save failed:', e))
    }, 500)
    return () => window.clearTimeout(t)
  }, [config])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.altKey) return

      if (e.key === '0') {
        e.preventDefault()
        setConfig((prev) => ({ ...prev, editorFontSize: EDITOR_FONT_SIZE_DEFAULT }))
        return
      }

      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setConfig((prev) => ({
          ...prev,
          editorFontSize: clampEditorFontSize(prev.editorFontSize - EDITOR_FONT_SIZE_STEP),
        }))
        return
      }

      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setConfig((prev) => ({
          ...prev,
          editorFontSize: clampEditorFontSize(prev.editorFontSize + EDITOR_FONT_SIZE_STEP),
        }))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setConfig])
}
