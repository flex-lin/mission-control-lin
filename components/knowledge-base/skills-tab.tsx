"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Zap, ChevronDown, ChevronRight } from "lucide-react"
import type { Skill } from "@/types"

export function SkillsTab() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch("/api/skills")
      .then((res) => res.json())
      .then((json) => setSkills(json.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggle = (folderName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(folderName)) next.delete(folderName)
      else next.add(folderName)
      return next
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-xs text-muted-foreground">Loading skills…</p>
        </CardContent>
      </Card>
    )
  }

  if (skills.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <p className="text-xs text-muted-foreground">No skills found</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {skills.map((skill) => (
        <Card key={skill.folderName}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Zap className="h-4 w-4 text-purple-400" />
                <CardTitle className="text-sm">{skill.name}</CardTitle>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {skill.folderName}
                </Badge>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => toggle(skill.folderName)}
              >
                {expanded.has(skill.folderName) ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            {skill.description && (
              <p className="text-xs text-muted-foreground">{skill.description}</p>
            )}
          </CardHeader>
          {expanded.has(skill.folderName) && (
            <CardContent className="pt-0">
              <pre className="whitespace-pre-wrap rounded-md bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground">
                {skill.content}
              </pre>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
