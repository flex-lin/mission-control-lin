"use client"

import { createContext, useContext, useState, useEffect, useCallback } from "react"
import type { Settings } from "@/types"

interface SettingsContextValue {
  settings: Settings
  loading: boolean
  refetch: () => Promise<void>
}

const defaultSettings: Settings = {
  theme: "dark",
  refreshInterval: 30,
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  loading: true,
  refetch: async () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(defaultSettings)
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/settings")
      if (!res.ok) return
      const json = await res.json()
      setSettings(json.data ?? json)
    } catch {
      // silently use defaults
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return (
    <SettingsContext.Provider value={{ settings, loading, refetch }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  return useContext(SettingsContext)
}
