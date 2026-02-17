"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, BarChart3, BookOpen, Settings, Plus } from "lucide-react"

const actions = [
  {
    label: "New Team",
    icon: Plus,
    href: "/agent-teams?action=new",
    description: "Create an agent team",
  },
  {
    label: "Agent Teams",
    icon: Users,
    href: "/agent-teams",
    description: "View all teams",
  },
  {
    label: "Analytics",
    icon: BarChart3,
    href: "/analytics",
    description: "Token usage & costs",
  },
  {
    label: "Projects",
    icon: BookOpen,
    href: "/knowledge-base",
    description: "Browse indexed projects",
  },
  {
    label: "Settings",
    icon: Settings,
    href: "/settings",
    description: "Configure Mission Control",
  },
]

export function QuickActions() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {actions.map(({ label, icon: Icon, href, description }) => (
          <Button
            key={href}
            variant="outline"
            asChild
            className="h-auto flex-col gap-1 py-3 text-left"
          >
            <Link href={href}>
              <Icon className="h-4 w-4" />
              <span className="text-xs font-medium">{label}</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                {description}
              </span>
            </Link>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}
