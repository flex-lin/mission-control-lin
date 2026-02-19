export const dynamic = "force-dynamic"
import { notFound } from "next/navigation"
import { Topbar } from "@/components/layout/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import type { Project, ProjectContext, KnowledgeBaseEntry } from "@/types"
import { FileText, FolderTree, BookOpen, Zap } from "lucide-react"
import { SkillsTab } from "@/components/knowledge-base/skills-tab"
import { RemoveProjectButton } from "@/components/knowledge-base/remove-project-button"

async function getProjectWithContext(id: string): Promise<(Project & ProjectContext) | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31777"
  try {
    const res = await fetch(`${base}/api/projects/${encodeURIComponent(id)}`, { cache: "no-store" })
    if (!res.ok) return null
    const json = await res.json()
    return json.data ?? null
  } catch {
    return null
  }
}

async function getKbEntry(projectPath: string): Promise<KnowledgeBaseEntry | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31777"
  try {
    const res = await fetch(`${base}/api/knowledge-base`, { cache: "no-store" })
    if (!res.ok) return null
    const json = await res.json()
    const entries = (json.data ?? []) as KnowledgeBaseEntry[]
    return entries.find((e) => e.path === projectPath) ?? null
  } catch {
    return null
  }
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const project = await getProjectWithContext(id)

  if (!project) notFound()

  const kbEntry = await getKbEntry(project.path)
  const context = { claudeMd: project.claudeMd, memoryFiles: project.memoryFiles ?? {}, fileTree: project.fileTree }
  const memoryFileEntries = Object.entries(context.memoryFiles)

  return (
    <div className="flex flex-col">
      <Topbar title={project.name} subtitle={project.path}>
        {kbEntry && (
          <RemoveProjectButton
            entryId={kbEntry.id}
            name={kbEntry.name}
            path={kbEntry.path}
          />
        )}
      </Topbar>

      <div className="space-y-6 p-6">
        {/* Tags */}
        {(project.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {(project.tags ?? []).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <Tabs defaultValue="claude-md">
          <TabsList>
            <TabsTrigger value="claude-md" className="gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              CLAUDE.md
            </TabsTrigger>
            <TabsTrigger value="memory" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Memory ({memoryFileEntries.length})
            </TabsTrigger>
            <TabsTrigger value="files" className="gap-1.5">
              <FolderTree className="h-3.5 w-3.5" />
              Files
            </TabsTrigger>
            <TabsTrigger value="skills" className="gap-1.5">
              <Zap className="h-3.5 w-3.5" />
              Skills
            </TabsTrigger>
          </TabsList>

          <TabsContent value="claude-md">
            <Card>
              <CardContent className="p-0">
                {context.claudeMd ? (
                  <ScrollArea className="h-[calc(100vh-320px)]">
                    <pre className="whitespace-pre-wrap p-6 font-mono text-xs leading-relaxed text-foreground">
                      {context.claudeMd}
                    </pre>
                  </ScrollArea>
                ) : (
                  <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                    No CLAUDE.md found in this project
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="memory">
            {memoryFileEntries.length === 0 ? (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <p className="text-xs text-muted-foreground">No memory files found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {memoryFileEntries.map(([filename, content]) => (
                  <Card key={filename}>
                    <CardHeader className="pb-2">
                      <CardTitle className="font-mono text-xs text-muted-foreground">
                        {filename}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <ScrollArea className="max-h-64">
                        <pre className="whitespace-pre-wrap px-6 pb-6 font-mono text-xs leading-relaxed">
                          {content}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="files">
            <Card>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-320px)]">
                  {(context.fileTree ?? []).length === 0 ? (
                    <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
                      No file tree available
                    </div>
                  ) : (
                    <ul className="space-y-0.5 p-4">
                      {(context.fileTree ?? []).map((file) => (
                        <li
                          key={file}
                          className="font-mono text-xs text-muted-foreground hover:text-foreground"
                        >
                          {file}
                        </li>
                      ))}
                    </ul>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="skills">
            <SkillsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
