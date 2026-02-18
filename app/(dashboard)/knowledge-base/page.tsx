export const dynamic = "force-dynamic"
import Link from "next/link"
import { Topbar } from "@/components/layout/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { BookOpen, FolderOpen } from "lucide-react"
import type { Project } from "@/types"

async function getProjects(): Promise<Project[]> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3777"
  try {
    const res = await fetch(`${base}/api/projects`, { cache: "no-store" })
    if (!res.ok) return []
    const json = await res.json()
    return json.data ?? []
  } catch {
    return []
  }
}

export default async function KnowledgeBasePage() {
  const projects = await getProjects()

  return (
    <div className="flex flex-col">
      <Topbar
        title="Knowledge Base"
        subtitle={`${projects.length} indexed project${projects.length !== 1 ? "s" : ""}`}
      />

      <div className="p-6">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
            <BookOpen className="mb-3 h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">No projects indexed</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add project directories in{" "}
              <Link href="/settings" className="text-blue-400 underline">
                Settings → Indexed Directories
              </Link>
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link key={project.id} href={`/knowledge-base/${project.id}`}>
                <Card className="cursor-pointer transition-colors hover:bg-accent/50">
                  <CardHeader className="pb-2">
                    <div className="flex items-start gap-2">
                      <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <CardTitle className="text-sm font-semibold text-foreground leading-snug">
                        {project.name}
                      </CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {project.path}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(project.tags ?? []).map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    {project.lastScanned && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Last scanned {new Date(project.lastScanned).toLocaleDateString()}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
