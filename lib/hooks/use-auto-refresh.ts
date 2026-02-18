"use client"

import { useState, useEffect, useCallback, useRef } from "react"

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
  intervalMs = 5000,
  enabled = true,
}: UseAutoRefreshOptions): UseAutoRefreshResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

    intervalRef.current = setInterval(refetch, intervalMs)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [refetch, intervalMs, enabled])

  return { data, loading, error, refetch }
}
