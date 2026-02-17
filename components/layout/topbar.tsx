import { cn } from "@/lib/utils"

interface TopbarProps {
  title: string
  subtitle?: string
  children?: React.ReactNode
}

export function Topbar({ title, subtitle, children }: TopbarProps) {
  return (
    <header className="flex h-14 items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--background))] px-6">
      <div className="flex flex-col justify-center">
        <h1 className="text-sm font-semibold leading-none text-[hsl(var(--foreground))]">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
            {subtitle}
          </p>
        )}
      </div>
      {children && (
        <div className={cn("flex items-center gap-2")}>{children}</div>
      )}
    </header>
  )
}
