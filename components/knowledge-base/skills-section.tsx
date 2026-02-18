"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Zap, ChevronDown, ChevronRight } from "lucide-react"
import type { Skill } from "@/types"

export function SkillsSection() {
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

  if (loading || skills.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-purple-400" />
        <h2 className="text-sm font-semibold">Skills</h2>
        <Badge variant="secondary" className="text-[10px]">
          {skills.length}
        </Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {skills.map((skill) => (
          <Card key={skill.folderName}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">{skill.name}</CardTitle>
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
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] font-mono">
                  {skill.folderName}
                </Badge>
              </div>
              {skill.description && (
                <p className="text-xs text-muted-foreground">{skill.description}</p>
              )}
            </CardHeader>
            {expanded.has(skill.folderName) && (
              <CardContent className="pt-0">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
                  {skill.content}
                </pre>
              </CardContent>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
