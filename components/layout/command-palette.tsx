"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  BarChart3,
  BookOpen,
  Settings,
  Plus,
  Sparkles,
  ListOrdered,
} from "lucide-react"
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command"

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agent-teams", label: "Agent Teams", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/knowledge-base", label: "Knowledge Base", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  function navigate(href: string) {
    router.push(href)
    setOpen(false)
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          {navItems.map(({ href, label, icon: Icon }) => (
            <CommandItem key={href} onSelect={() => navigate(href)}>
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => navigate("/agent-teams?action=create")}>
            <Plus className="mr-2 h-4 w-4" />
            Create Team
          </CommandItem>
          <CommandItem onSelect={() => navigate("/agent-teams?action=smart-create")}>
            <Sparkles className="mr-2 h-4 w-4" />
            Smart Create Team
          </CommandItem>
          <CommandItem onSelect={() => navigate("/queue")}>
            <ListOrdered className="mr-2 h-4 w-4" />
            Submit Task to Queue
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
