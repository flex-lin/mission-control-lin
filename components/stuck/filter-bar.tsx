"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Search } from "lucide-react"

const BLOCKER_TYPES = [
  { value: "all", label: "All Types" },
  { value: "decision_needed", label: "Decision Needed" },
  { value: "missing_info", label: "Missing Info" },
  { value: "dependency", label: "Dependency" },
  { value: "error", label: "Error" },
  { value: "permission", label: "Permission" },
]

interface FilterBarProps {
  blockerType: string
  team: string
  search: string
  teamNames: string[]
  showDismissed: boolean
  onBlockerTypeChange: (value: string) => void
  onTeamChange: (value: string) => void
  onSearchChange: (value: string) => void
  onShowDismissedChange: (value: boolean) => void
}

export function FilterBar({
  blockerType,
  team,
  search,
  teamNames,
  showDismissed,
  onBlockerTypeChange,
  onTeamChange,
  onSearchChange,
  onShowDismissedChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={blockerType} onValueChange={onBlockerTypeChange}>
        <SelectTrigger className="w-[160px] text-xs h-8">
          <SelectValue placeholder="All Types" />
        </SelectTrigger>
        <SelectContent>
          {BLOCKER_TYPES.map((t) => (
            <SelectItem key={t.value} value={t.value} className="text-xs">
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={team} onValueChange={onTeamChange}>
        <SelectTrigger className="w-[160px] text-xs h-8">
          <SelectValue placeholder="All Teams" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            All Teams
          </SelectItem>
          {teamNames.map((name) => (
            <SelectItem key={name} value={name} className="text-xs">
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search blockers..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-8 text-xs h-8"
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="show-dismissed"
          checked={showDismissed}
          onCheckedChange={onShowDismissedChange}
          className="scale-75"
        />
        <Label htmlFor="show-dismissed" className="text-xs text-muted-foreground cursor-pointer">
          Show dismissed
        </Label>
      </div>
    </div>
  )
}
