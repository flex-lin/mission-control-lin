"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Users,
  Plus,
  X,
  Check,
  Loader2,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import type { TeamRole, AgentType } from "@/types"

const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  "general-purpose": "General Purpose",
  Bash: "Bash",
  Explore: "Explore",
  Plan: "Plan",
}

interface RolePickerProps {
  selectedRoles: TeamRole[]
  onChange: (roles: TeamRole[]) => void
  disabled?: boolean
}

interface CreateRoleFormData {
  name: string
  role: string
  agentType: AgentType
  description: string
}

const EMPTY_FORM: CreateRoleFormData = {
  name: "",
  role: "",
  agentType: "general-purpose",
  description: "",
}

export function RolePicker({ selectedRoles, onChange, disabled }: RolePickerProps) {
  const [open, setOpen] = useState(false)
  const [allRoles, setAllRoles] = useState<TeamRole[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<CreateRoleFormData>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const fetchRoles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/roles")
      const json = await res.json()
      setAllRoles(json.data ?? [])
    } catch {
      toast.error("Failed to load roles")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      fetchRoles()
      setSearch("")
      setShowCreate(false)
      setCreateForm(EMPTY_FORM)
      setCreateError(null)
    }
  }, [open, fetchRoles])

  function isSelected(role: TeamRole) {
    return selectedRoles.some((r) => r.id === role.id)
  }

  function toggleRole(role: TeamRole) {
    if (isSelected(role)) {
      onChange(selectedRoles.filter((r) => r.id !== role.id))
    } else {
      onChange([...selectedRoles, role])
    }
  }

  function removeRole(roleId: number) {
    onChange(selectedRoles.filter((r) => r.id !== roleId))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)

    if (!createForm.name.trim() || !createForm.role.trim() || !createForm.description.trim()) {
      setCreateError("All fields are required")
      return
    }

    setCreating(true)
    try {
      const res = await fetch("/api/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      })
      const json = await res.json()
      if (!res.ok) {
        setCreateError(json.error ?? "Failed to create role")
        return
      }
      const newRole = json.data as TeamRole
      setAllRoles((prev) => [...prev, newRole])
      setShowCreate(false)
      setCreateForm(EMPTY_FORM)
      toast.success(`Role "${newRole.role}" created`)
      // Auto-select the newly created role
      onChange([...selectedRoles, newRole])
    } catch {
      setCreateError("Network error — please try again")
    } finally {
      setCreating(false)
    }
  }

  const filteredRoles = allRoles.filter((r) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      r.name.toLowerCase().includes(q) ||
      r.role.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q)
    )
  })

  const presetRoles = filteredRoles.filter((r) => r.isPreset)
  const customRoles = filteredRoles.filter((r) => !r.isPreset)

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {selectedRoles.length === 0 ? (
          <span className="text-xs text-muted-foreground">No team members configured — AI will decide the team composition</span>
        ) : (
          selectedRoles.map((role) => (
            <Badge
              key={role.id}
              variant="secondary"
              className="gap-1 pr-1 text-xs"
            >
              <span className="font-medium">{role.role}</span>
              <span className="text-muted-foreground">({role.name})</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeRole(role.id)}
                  className="ml-0.5 rounded-sm hover:bg-muted transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))
        )}
        {!disabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 gap-1 px-2 text-xs"
            onClick={() => setOpen(true)}
          >
            <Users className="h-3 w-3" />
            {selectedRoles.length === 0 ? "Configure Team" : "Edit Team"}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Configure Team Members
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search roles..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Preset Roles */}
                {presetRoles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Preset Roles</p>
                    <div className="grid gap-1.5">
                      {presetRoles.map((role) => (
                        <RoleCard
                          key={role.id}
                          role={role}
                          selected={isSelected(role)}
                          onToggle={() => toggleRole(role)}
                          onDelete={null}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Custom Roles */}
                {customRoles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom Roles</p>
                    <div className="grid gap-1.5">
                      {customRoles.map((role) => (
                        <RoleCard
                          key={role.id}
                          role={role}
                          selected={isSelected(role)}
                          onToggle={() => toggleRole(role)}
                          onDelete={async () => {
                            try {
                              const res = await fetch(`/api/roles/${role.id}`, { method: "DELETE" })
                              if (res.ok) {
                                setAllRoles((prev) => prev.filter((r) => r.id !== role.id))
                                onChange(selectedRoles.filter((r) => r.id !== role.id))
                                toast.success("Role deleted")
                              } else {
                                const j = await res.json()
                                toast.error(j.error ?? "Failed to delete role")
                              }
                            } catch {
                              toast.error("Network error")
                            }
                          }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {filteredRoles.length === 0 && !loading && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {search ? `No roles match "${search}"` : "No roles available"}
                  </p>
                )}

                {/* Create Custom Role */}
                <div className="rounded-lg border border-dashed">
                  <button
                    type="button"
                    onClick={() => setShowCreate(!showCreate)}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showCreate ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Create custom role
                  </button>
                  {showCreate && (
                    <form onSubmit={handleCreate} className="px-3 pb-3 space-y-3 border-t pt-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Name (kebab-case) *</Label>
                          <Input
                            placeholder="e.g. mobile-dev"
                            value={createForm.name}
                            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Display Title *</Label>
                          <Input
                            placeholder="e.g. Mobile Developer"
                            value={createForm.role}
                            onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Agent Type</Label>
                        <Select
                          value={createForm.agentType}
                          onValueChange={(v) => setCreateForm({ ...createForm, agentType: v as AgentType })}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.keys(AGENT_TYPE_LABELS) as AgentType[]).map((type) => (
                              <SelectItem key={type} value={type} className="text-xs">
                                {AGENT_TYPE_LABELS[type]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Description *</Label>
                        <Textarea
                          placeholder="What is this role responsible for?"
                          value={createForm.description}
                          onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                          rows={2}
                          className="text-xs resize-none"
                        />
                      </div>
                      {createError && (
                        <p className="text-xs text-destructive">{createError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" className="h-7 text-xs" disabled={creating}>
                          {creating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                          Create & Select
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setShowCreate(false)
                            setCreateForm(EMPTY_FORM)
                            setCreateError(null)
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="border-t pt-3">
            <div className="flex items-center gap-3 w-full">
              <span className="text-xs text-muted-foreground flex-1">
                {selectedRoles.length === 0
                  ? "No members selected — AI will auto-compose the team"
                  : `${selectedRoles.length} member${selectedRoles.length !== 1 ? "s" : ""} selected`}
              </span>
              <Button variant="outline" size="sm" onClick={() => onChange([])}>
                Clear All
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Done
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface RoleCardProps {
  role: TeamRole
  selected: boolean
  onToggle: () => void
  onDelete: (() => Promise<void>) | null
}

function RoleCard({ role, selected, onToggle, onDelete }: RoleCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [deleting, setDeleting] = useState(false)

  return (
    <div
      className={`rounded-md border transition-colors cursor-pointer ${
        selected ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
      }`}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        onClick={onToggle}
      >
        <div
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/50"
          }`}
        >
          {selected && <Check className="h-2.5 w-2.5" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium">{role.role}</span>
            <code className="text-[10px] text-muted-foreground bg-muted px-1 py-0.5 rounded font-mono">{role.name}</code>
            <Badge variant="outline" className="text-[9px] px-1 py-0">
              {role.agentType}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
            onClick={() => setExpanded(!expanded)}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          {onDelete && (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive transition-colors p-0.5"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true)
                try {
                  await onDelete()
                } finally {
                  setDeleting(false)
                }
              }}
              title="Delete custom role"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-3 pb-2 pt-0">
          <p className="text-xs text-muted-foreground">{role.description}</p>
        </div>
      )}
    </div>
  )
}
