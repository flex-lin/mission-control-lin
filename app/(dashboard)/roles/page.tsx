"use client"

import { useState, useEffect, useCallback } from "react"
import { Topbar } from "@/components/layout/topbar"
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Lock,
  UserCheck,
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

const AGENT_TYPE_DESCRIPTIONS: Record<AgentType, string> = {
  "general-purpose": "Standard agent with full tool access",
  Bash: "Specializes in shell commands and scripts",
  Explore: "Focused on code exploration and analysis",
  Plan: "Focused on planning and task decomposition",
}

interface RoleFormData {
  name: string
  role: string
  agentType: AgentType
  description: string
}

const EMPTY_FORM: RoleFormData = {
  name: "",
  role: "",
  agentType: "general-purpose",
  description: "",
}

export default function RolesPage() {
  const [roles, setRoles] = useState<TeamRole[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState<RoleFormData>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Edit dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<TeamRole | null>(null)
  const [editForm, setEditForm] = useState<RoleFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const fetchRoles = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/roles")
      const json = await res.json()
      setRoles(json.data ?? [])
    } catch {
      toast.error("Failed to load roles")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRoles()
  }, [fetchRoles])

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredRoles = roles.filter((r) => {
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
      setRoles((prev) => [...prev, json.data])
      setCreateOpen(false)
      setCreateForm(EMPTY_FORM)
      toast.success(`Role "${createForm.role}" created`)
    } catch {
      setCreateError("Network error — please try again")
    } finally {
      setCreating(false)
    }
  }

  function openEdit(role: TeamRole) {
    setEditingRole(role)
    setEditForm({
      name: role.name,
      role: role.role,
      agentType: role.agentType as AgentType,
      description: role.description,
    })
    setEditError(null)
    setEditOpen(true)
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editingRole) return
    setEditError(null)

    if (!editForm.name.trim() || !editForm.role.trim() || !editForm.description.trim()) {
      setEditError("All fields are required")
      return
    }

    setSaving(true)
    try {
      const res = await fetch(`/api/roles/${editingRole.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      })
      const json = await res.json()
      if (!res.ok) {
        setEditError(json.error ?? "Failed to save changes")
        return
      }
      setRoles((prev) => prev.map((r) => (r.id === editingRole.id ? json.data : r)))
      setEditOpen(false)
      setEditingRole(null)
      toast.success("Role updated")
    } catch {
      setEditError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/roles/${id}`, { method: "DELETE" })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? "Failed to delete role")
        return
      }
      setRoles((prev) => prev.filter((r) => r.id !== id))
      toast.success("Role deleted")
    } catch {
      toast.error("Network error — please try again")
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex flex-col">
      <Topbar
        title="Team Roles"
        subtitle="Manage preset and custom roles for agent team composition"
      />

      <div className="p-6 space-y-6">
        {/* Header actions */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search roles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setCreateForm(EMPTY_FORM)
              setCreateError(null)
              setCreateOpen(true)
            }}
          >
            <Plus className="h-4 w-4" />
            New Role
          </Button>
        </div>

        {/* Stats */}
        {!loading && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5" />
              {roles.filter((r) => r.isPreset).length} preset roles
            </span>
            <span className="flex items-center gap-1.5">
              <UserCheck className="h-3.5 w-3.5" />
              {roles.filter((r) => !r.isPreset).length} custom roles
            </span>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Preset Roles */}
            {presetRoles.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Preset Roles</h2>
                  <Badge variant="secondary" className="text-xs">{presetRoles.length}</Badge>
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Read-only — built-in roles</span>
                </div>
                <div className="grid gap-2">
                  {presetRoles.map((role) => (
                    <RoleCard
                      key={role.id}
                      role={role}
                      expanded={expandedIds.has(role.id)}
                      onToggleExpanded={() => toggleExpanded(role.id)}
                      onEdit={null}
                      onDelete={null}
                      deleting={false}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Custom Roles */}
            {(customRoles.length > 0 || !search) && (
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Custom Roles</h2>
                  <Badge variant="secondary" className="text-xs">{customRoles.length}</Badge>
                  <span className="text-xs text-muted-foreground">Your organization&apos;s roles</span>
                </div>
                {customRoles.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-center">
                    <UserCheck className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-sm font-medium">No custom roles yet</p>
                    <p className="text-xs text-muted-foreground mt-1 mb-4">
                      Create custom roles to define specialized team members for your projects
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        setCreateForm(EMPTY_FORM)
                        setCreateError(null)
                        setCreateOpen(true)
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create First Custom Role
                    </Button>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {customRoles.map((role) => (
                      <RoleCard
                        key={role.id}
                        role={role}
                        expanded={expandedIds.has(role.id)}
                        onToggleExpanded={() => toggleExpanded(role.id)}
                        onEdit={() => openEdit(role)}
                        onDelete={() => handleDelete(role.id)}
                        deleting={deletingId === role.id}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}

            {filteredRoles.length === 0 && search && (
              <div className="text-center py-12">
                <p className="text-sm text-muted-foreground">
                  No roles match &ldquo;{search}&rdquo;
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={(v) => { setCreateOpen(v); if (!v) setCreateForm(EMPTY_FORM) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Custom Role
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-name">Name (kebab-case) *</Label>
                <Input
                  id="create-name"
                  placeholder="e.g. mobile-dev"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">Used internally as the agent&apos;s identifier</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-role">Display Title *</Label>
                <Input
                  id="create-role"
                  placeholder="e.g. Mobile Developer"
                  value={createForm.role}
                  onChange={(e) => setCreateForm({ ...createForm, role: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-agent-type">Agent Type</Label>
              <Select
                value={createForm.agentType}
                onValueChange={(v) => setCreateForm({ ...createForm, agentType: v as AgentType })}
              >
                <SelectTrigger id="create-agent-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(AGENT_TYPE_LABELS) as [AgentType, string][]).map(([type, label]) => (
                    <SelectItem key={type} value={type}>
                      <div>
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">{AGENT_TYPE_DESCRIPTIONS[type]}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-description">Description *</Label>
              <Textarea
                id="create-description"
                placeholder="What is this role responsible for? What are their key tasks and areas of ownership?"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                rows={3}
              />
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creating} className="gap-1.5">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create Role
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={(v) => { setEditOpen(v); if (!v) setEditingRole(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Edit Role
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-name">Name (kebab-case) *</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-role">Display Title *</Label>
                <Input
                  id="edit-role"
                  value={editForm.role}
                  onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-agent-type">Agent Type</Label>
              <Select
                value={editForm.agentType}
                onValueChange={(v) => setEditForm({ ...editForm, agentType: v as AgentType })}
              >
                <SelectTrigger id="edit-agent-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(AGENT_TYPE_LABELS) as [AgentType, string][]).map(([type, label]) => (
                    <SelectItem key={type} value={type}>
                      <div>
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-muted-foreground">{AGENT_TYPE_DESCRIPTIONS[type]}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-description">Description *</Label>
              <Textarea
                id="edit-description"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
              />
            </div>
            {editError && (
              <p className="text-sm text-destructive">{editError}</p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface RoleCardProps {
  role: TeamRole
  expanded: boolean
  onToggleExpanded: () => void
  onEdit: (() => void) | null
  onDelete: (() => void) | null
  deleting: boolean
}

function RoleCard({ role, expanded, onToggleExpanded, onEdit, onDelete, deleting }: RoleCardProps) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{role.role}</span>
            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">{role.name}</code>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {AGENT_TYPE_LABELS[role.agentType as AgentType] ?? role.agentType}
            </Badge>
            {role.isPreset && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5">
                <Lock className="h-2.5 w-2.5" />
                Preset
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!role.isPreset && onEdit && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onEdit}
              title="Edit role"
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {!role.isPreset && onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              disabled={deleting}
              title="Delete role"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onToggleExpanded}
            title={expanded ? "Collapse" : "Expand"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 border-t pt-2">
          <p className="text-sm text-muted-foreground">{role.description}</p>
          <p className="text-xs text-muted-foreground mt-2">
            Created {new Date(role.createdAt).toLocaleDateString()}
          </p>
        </div>
      )}
    </div>
  )
}
