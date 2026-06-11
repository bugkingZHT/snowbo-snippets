"use client"
import { useAppConfigSync } from '@/hooks/use-app-config'

/** 在 layout 挂载,保证各路由都能加载/持久化 app 配置并响应字号快捷键 */
export function AppConfigSync() {
  useAppConfigSync()
  return null
}
