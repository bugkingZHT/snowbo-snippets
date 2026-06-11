"use client"

import { useEffect } from 'react'
import { subscribeThemeSync } from '@/lib/theme'
import { AppConfigSync } from '@/components/app-config-sync'

export default function QuickCopyLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const unsubscribeTheme = subscribeThemeSync('system')

    const { body, documentElement: html } = document
    body.style.background = 'transparent'
    html.style.background = 'transparent'
    body.classList.remove('bg-background')

    return () => {
      unsubscribeTheme()
      body.style.background = ''
      html.style.background = ''
      body.classList.add('bg-background')
    }
  }, [])

  return (
    <>
      <AppConfigSync />
      {children}
    </>
  )
}
