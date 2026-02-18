"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSettings } from "@/lib/settings-context"

interface UseAutoRefreshOptions {
  url: string
  intervalMs?: number
  enabled?: boolean
}

interface UseAutoRefreshResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useAutoRefresh<T>({
  url,
  intervalMs,
  enabled = true,
}: UseAutoRefreshOptions): UseAutoRefreshResult<T> {
  const { settings } = useSettings()
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Use explicit intervalMs if provided, otherwise read from settings (seconds → ms)
  const resolvedInterval = intervalMs ?? (settings.refreshInterval ?? 30) * 1000

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json.data ?? json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fetch failed")
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    if (!enabled) return

    refetch()

    intervalRef.current = setInterval(refetch, resolvedInterval)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [refetch, resolvedInterval, enabled])

  return { data, loading, error, refetch }
}
