"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Sparkles, Loader2, ArrowLeft, Check } from "lucide-react"
import { toast } from "sonner"
import type { TeamPlan } from "@/types"

type WizardStep = "goal" | "reviewing" | "done"

export function SmartCreateDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<WizardStep>("goal")
  const [goal, setGoal] = useState("")
  const [projectPath, setProjectPath] = useState("")
  const [loading, setLoading] = useState(false)
  const [spawning, setSpawning] = useState(false)
  const [plan, setPlan] = useState<TeamPlan | null>(null)
  const [createdTeamName, setCreatedTeamName] = useState("")

  function resetState() {
    setStep("goal")
    setGoal("")
    setProjectPath("")
    setPlan(null)
    setLoading(false)
    setSpawning(false)
    setCreatedTeamName("")
  }

  async function handleGenerate() {
    if (!goal.trim()) return
    setLoading(true)

    try {
      const res = await fetch("/api/teams/smart-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal: goal.trim(),
          projectPath: projectPath.trim() || undefined,
        }),
      })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error ?? "Failed to generate plan")
        return
      }

      setPlan(json.data as TeamPlan)
      setStep("reviewing")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }

  async function handleSpawn() {
    if (!plan) return
    setSpawning(true)

    try {
      const res = await fetch("/api/teams/spawn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error ?? "Failed to create team")
        return
      }

      setCreatedTeamName(plan.teamName)
      setStep("done")
      toast.success(`Team "${plan.teamName}" created with ${json.data.membersCreated} members`)
      router.refresh()
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setSpawning(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) resetState()
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />
          Smart Create
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        {step === "goal" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Smart Team Creation
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="smart-goal">What do you want the team to accomplish?</Label>
                <Textarea
                  id="smart-goal"
                  placeholder="e.g. Build a REST API with authentication, database models, and comprehensive tests"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={4}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="smart-path">Project path (optional)</Label>
                <Input
                  id="smart-path"
                  placeholder="/home/user/my-project"
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleGenerate} disabled={loading || !goal.trim()} className="gap-1.5">
                {loading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate Plan with AI
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "reviewing" && plan && (
          <>
            <DialogHeader>
              <DialogTitle>Review Team Plan</DialogTitle>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
              <div className="space-y-1.5">
                <Label htmlFor="plan-name">Team Name</Label>
                <Input
                  id="plan-name"
                  value={plan.teamName}
                  onChange={(e) => setPlan({ ...plan, teamName: e.target.value })}
                />
              </div>

              <div>
                <p className="text-sm text-muted-foreground">{plan.description}</p>
              </div>

              <div className="space-y-2">
                <Label>Team Members ({plan.personas.length})</Label>
                <div className="grid gap-2">
                  {plan.personas.map((persona) => (
                    <div
                      key={persona.name}
                      className="rounded-md border border-border bg-muted/30 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{persona.name}</span>
                        <Badge variant="secondary" className="text-[10px]">
                          {persona.role}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {persona.agentType}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{persona.description}</p>
                    </div>
                  ))}
                </div>
              </div>

              {plan.initialTasks.length > 0 && (
                <div className="space-y-2">
                  <Label>Initial Tasks ({plan.initialTasks.length})</Label>
                  <div className="grid gap-1.5">
                    {plan.initialTasks.map((task, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-border bg-muted/30 p-2.5"
                      >
                        <p className="text-sm font-medium text-foreground">{task.subject}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{task.description}</p>
                        {task.assignTo && (
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            → {task.assignTo}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("goal")} className="gap-1.5">
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
              <Button onClick={handleSpawn} disabled={spawning} className="gap-1.5">
                {spawning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating…
                  </>
                ) : (
                  "Approve & Create"
                )}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "done" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                Team Created
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Your team <span className="font-medium text-foreground">{createdTeamName}</span> is
              ready. View the team page to start managing agents and tasks.
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setOpen(false)
                  resetState()
                }}
              >
                Close
              </Button>
              <Button
                onClick={() => {
                  setOpen(false)
                  resetState()
                  router.push(`/agent-teams/${encodeURIComponent(createdTeamName)}`)
                }}
              >
                View Team
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
