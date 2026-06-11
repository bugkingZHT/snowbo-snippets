"use client"

import * as React from "react"
import { CircleHelp, Settings } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

export function ModeToggle() {
  const router = useRouter()

  const handleSettingsClick = React.useCallback(() => {
    router.push("/settings")
  }, [router])

  const handleHelpClick = React.useCallback(() => {
    router.push("/help")
  }, [router])

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        onClick={handleSettingsClick}
        className="size-8"
        title="设置"
      >
        <Settings className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">设置</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleHelpClick}
        className="size-8"
        title="帮助"
      >
        <CircleHelp className="h-[1.2rem] w-[1.2rem]" />
        <span className="sr-only">帮助</span>
      </Button>
    </div>
  )
}
