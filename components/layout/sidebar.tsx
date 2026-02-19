"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  BarChart3,
  BookOpen,
  Settings,
  Cpu,
  AlertTriangle,
  ListOrdered,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import type { StuckTask } from "@/types"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/queue", label: "Task Queue", icon: ListOrdered },
  { href: "/stuck", label: "Stuck", icon: AlertTriangle },
  { href: "/agent-teams", label: "Agent Teams", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const { data: stuckTasks } = useAutoRefresh<StuckTask[]>({
    url: "/api/teams/stuck",
    intervalMs: 15000,
  })
  const stuckCount = stuckTasks?.length ?? 0

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-[hsl(var(--sidebar))] border-[hsl(var(--sidebar-border))]">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-[hsl(var(--sidebar-border))] px-4">
        <Cpu className="h-5 w-5 text-blue-400" />
        <span className="text-sm font-semibold tracking-wide text-[hsl(var(--sidebar-foreground))]">
          Mission Control
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] font-medium"
                  : "text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {label === "Stuck" && stuckCount > 0 && (
                <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500/90 px-1 text-[10px] font-medium text-white">
                  {stuckCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[hsl(var(--sidebar-border))] p-3">
        <button
          onClick={() =>
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true })
            )
          }
          className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--accent))] hover:text-[hsl(var(--accent-foreground))] transition-colors"
        >
          <span>Search...</span>
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--muted))] px-1.5 font-mono text-[10px] font-medium text-[hsl(var(--muted-foreground))]">
            ⌘K
          </kbd>
        </button>
        <p className="mt-2 px-3 text-xs text-[hsl(var(--muted-foreground))]">
          Mission Control Lin
        </p>
      </div>
    </aside>
  )
}
