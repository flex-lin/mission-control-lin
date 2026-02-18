"use client"

import { cn } from "@/lib/utils"
import { Breadcrumbs } from "@/components/layout/breadcrumbs"

interface TopbarProps {
  title: string
  subtitle?: string
  live?: boolean
  children?: React.ReactNode
}

export function Topbar({ title, subtitle, live, children }: TopbarProps) {
  return (
    <header className="border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-6">
      <div className="py-2">
        <Breadcrumbs />
      </div>
      <div className="flex h-14 items-center justify-between">
        <div className="flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold leading-none text-[hsl(var(--foreground))]">
              {title}
            </h1>
            {live && (
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
              {subtitle}
            </p>
          )}
        </div>
        {children && (
          <div className={cn("flex items-center gap-2")}>{children}</div>
        )}
      </div>
    </header>
  )
}
