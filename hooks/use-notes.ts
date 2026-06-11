"use client"
import { useEffect } from 'react'
import { useAtom } from 'jotai'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@tauri-apps/api/core'
import { notesAtom } from '@/store/note-store'
import { notesWithResolvedTitles } from '@/lib/default-note-title'
import { loadNotes, saveNotes } from '@/lib/tauri-api'

export function useNotesSync() {
  const [notes, setNotes] = useAtom(notesAtom)

  useEffect(() => {
    loadNotes()
      .then(setNotes)
      .catch(console.error)
  }, [setNotes])

  useEffect(() => {
    if (!isTauri()) return

    let unlisten: (() => void) | undefined
    void listen('notes-changed', () => {
      loadNotes()
        .then(setNotes)
        .catch(console.error)
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      unlisten?.()
    }
  }, [setNotes])

  useEffect(() => {
    if (notes.length === 0) return

    const timeoutId = setTimeout(() => {
      saveNotes(notesWithResolvedTitles(notes)).catch(console.error)
    }, 1000)

    return () => clearTimeout(timeoutId)
  }, [notes])
}
