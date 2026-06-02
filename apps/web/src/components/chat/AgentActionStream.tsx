import { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  Terminal,
  Brain,
  FilePlus,
  FileText,
  FilePen,
  Pencil,
  Loader2,
  Search,
  AlertCircle,
  CheckCircle2,
  Globe,
  Wrench,
  Eye,
  Sparkles,
  FileCode,
  type LucideIcon,
} from "lucide-react";
import type { ThoughtItem } from "./MessageComponents";
import { useChatStore } from "../../stores";
import { ToolResultCard } from "./tool-results";

interface AgentActionStreamProps {
  thoughts: ThoughtItem[];
  isThinking?: boolean;
}

export type ActionCategory =
  | "think"
  | "search"
  | "file_create"
  | "file_read"
  | "file_write"
  | "file_edit"
  | "command"
  | "preview"
  | "media"
  | "browser"
  | "monologue"
  | "generic";

export type ActionStatus = "pending" | "running" | "completed" | "failed";

export interface AgentActionItem {
  id: string;
  type: ActionCategory;
  label: string;
  context: string;
  detail: string | null;
  status: ActionStatus;
  durationMs: number | null;
  text: string;
  timestamp?: number;
  command?: string;
  filePath?: string;
  searchQuery?: string;
}

/* ── Phase Configuration ─────────────────────────────────── */

export type AgentPhase =
  | "planning"
  | "coding"
  | "validation"
  | "execution"
  | "complete"
  | "error"
  | "unknown";

interface PhaseConfig {
  label: string;
  color: string;
  bg: string;
  icon: LucideIcon;
  order: number;
}

export const PHASE_CONFIG: Record<AgentPhase, PhaseConfig> = {
  planning: { label: "Planning", color: "#a78bfa", bg: "rgba(167, 139, 250, 0.06)", icon: Brain, order: 1 },
  coding: { label: "Coding", color: "#38bdf8", bg: "rgba(56, 189, 248, 0.06)", icon: FileCode, order: 2 },
  validation: { label: "Validation", color: "#fbbf24", bg: "rgba(251, 191, 36, 0.06)", icon: CheckCircle2, order: 3 },
  execution: { label: "Execution", color: "#34d399", bg: "rgba(52, 211, 153, 0.06)", icon: Sparkles, order: 4 },
  complete: { label: "Complete", color: "#34d399", bg: "rgba(52, 211, 153, 0.06)", icon: CheckCircle2, order: 5 },
  error: { label: "Error", color: "#f87171", bg: "rgba(248, 113, 113, 0.06)", icon: AlertCircle, order: 6 },
  unknown: { label: "Working", color: "#9ca3af", bg: "rgba(156, 163, 175, 0.04)", icon: Wrench, order: 99 },
};

/* ── Category Configuration ─────────────────────────────── */

interface CategoryConfig {
  color: string;
  bg: string;
  icon: LucideIcon;
  label: string;
  prefix?: string;
  ansiColor?: string;
}

export const CATEGORY_CONFIG: Record<ActionCategory, CategoryConfig> = {
  think: {
    color: "#a78bfa",
    bg: "rgba(167, 139, 250, 0.06)",
    icon: Brain,
    label: "Thinking",
    ansiColor: "#c084fc",
  },
  search: {
    color: "#fbbf24",
    bg: "rgba(251, 191, 36, 0.06)",
    icon: Search,
    label: "Searching",
    prefix: "🔍",
    ansiColor: "#f59e0b",
  },
  file_create: {
    color: "#34d399",
    bg: "rgba(52, 211, 153, 0.06)",
    icon: FilePlus,
    label: "Creating",
    prefix: "+",
    ansiColor: "#4ade80",
  },
  file_read: {
    color: "#60a5fa",
    bg: "rgba(96, 165, 250, 0.06)",
    icon: FileText,
    label: "Reading",
    prefix: "◆",
    ansiColor: "#60a5fa",
  },
  file_write: {
    color: "#38bdf8",
    bg: "rgba(56, 189, 248, 0.06)",
    icon: FilePen,
    label: "Writing",
    prefix: "◆",
    ansiColor: "#38bdf8",
  },
  file_edit: {
    color: "#fb923c",
    bg: "rgba(251, 146, 60, 0.06)",
    icon: Pencil,
    label: "Editing",
    prefix: "~",
    ansiColor: "#fb923c",
  },
  command: {
    color: "#9ca3af",
    bg: "rgba(156, 163, 175, 0.06)",
    icon: Terminal,
    label: "Executing",
    prefix: "$",
    ansiColor: "#9ca3af",
  },
  preview: {
    color: "#22d3ee",
    bg: "rgba(34, 211, 238, 0.06)",
    icon: Eye,
    label: "Previewing",
    ansiColor: "#22d3ee",
  },
  media: {
    color: "#f472b6",
    bg: "rgba(244, 114, 182, 0.06)",
    icon: Sparkles,
    label: "Generating",
    ansiColor: "#f472b6",
  },
  browser: {
    color: "#818cf8",
    bg: "rgba(129, 140, 248, 0.06)",
    icon: Globe,
    label: "Browsing",
    ansiColor: "#818cf8",
  },
  monologue: {
    color: "#a78bfa",
    bg: "rgba(167, 139, 250, 0.04)",
    icon: Brain,
    label: "Planning",
    ansiColor: "#c084fc",
  },
  generic: {
    color: "#9ca3af",
    bg: "rgba(156, 163, 175, 0.04)",
    icon: Wrench,
    label: "Working",
    ansiColor: "#9ca3af",
  },
};

/* ── Phase Derivation ───────────────────────────────────── */

export function derivePhase(step: string, toolName?: string | null): AgentPhase {
  if (step === "turn_started") return "planning";
  if (step === "agent_thinking" && (!toolName || toolName === "planner")) return "planning";
  if (step === "agent_tool_called" && toolName === "planner") return "planning";
  if (step === "agent_tool_result" && toolName === "planner") return "planning";
  if (step === "agent_thinking" && toolName === "coder") return "coding";
  if (step === "agent_tool_called" && toolName === "coder") return "coding";
  if (step === "agent_tool_result" && toolName === "coder") return "coding";
  if (step === "code_generated" || step === "generating_code") return "coding";
  if (step === "agent_tool_called" && toolName === "validator") return "validation";
  if (step === "agent_tool_result" && toolName === "validator") return "validation";
  if (step === "validation_failed") return "validation";
  if (step === "agent_tool_called" && toolName === "executor") return "execution";
  if (step === "agent_tool_result" && toolName === "executor") return "execution";
  if (step === "turn_complete") return "complete";
  if (step === "turn_error" || step === "turn_aborted") return "error";
  return "unknown";
}

/* ── Detection ─────────────────────────────────────────── */

export function detectActionCategory(step: string, stepLabel: string, text: string): ActionCategory {
  const normalized = `${step} ${stepLabel} ${text}`.toLowerCase();

  if (/\bsearch\b|\bweb_search\b|\btavily\b|\blookup\b|\bquery\b/.test(normalized)) return "search";
  if (/\bscrap\b|\bcrawl\b/.test(normalized)) return "browser";
  if (/\bfile_created\b|\bcreate file\b|\bfile created\b|\bnew file\b|\bwriting.*to\b/.test(normalized)) return "file_create";
  if (/\bedit\b|\bmodify\b|\bpatch\b|\bupdate file\b|\breplac\b/.test(normalized)) return "file_edit";
  if (/\bwrite\b|\bsave\b|\boutput\b|\bgenerat.*file\b/.test(normalized)) return "file_write";
  if (/\bread\b|\bfetch\b|\bload\b|\bget file\b/.test(normalized)) return "file_read";
  if (/\bterminal\b|\bexecute\b|\brun\b|\bshell\b|\bcommand\b|\bbuild\b|\bnpm\b|\bnpx\b|\bdocker\b|\bmake\b|\bgit\b/.test(normalized)) return "command";
  if (/\bnavigat\b|\bbrowser\b|\bclick\b|\bscreenshot\b|\bviewport\b/.test(normalized)) return "browser";
  if (/\bimage\b|\bvideo\b|\bmanim\b|\brender\b|\bffmpeg\b|\bgenerat.*media\b/.test(normalized)) return "media";
  if (/\bpreview\b|\bscene\b|\bviewport\b|\bdisplay\b/.test(normalized)) return "preview";
  if (/\bthink\b|\breason\b|\bplan\b|\bdraft\b|\banalyz\b|\breflect\b/.test(normalized)) return "think";
  if (step === "monologue" || step === "intent" || step === "turn_started" || step === "turn_complete") return "monologue";

  return "generic";
}

/* ── Extraction ───────────────────────────────────────── */

function extractFilePath(text: string): string | undefined {
  const match = text.match(/[`"']([^`"'\n]+\.(?:md|tsx|ts|js|jsx|json|css|html|py|rs|go|java|txt))[`"']/i);
  if (match) return match[1];
  const pathMatch = text.match(/(?:file|path)\s*:?\s*[`"']?([^`"'\n]+)[`"']?/i);
  if (pathMatch) return pathMatch[1].trim().slice(0, 80);
  return undefined;
}

function extractCommand(text: string): string | undefined {
  const match = text.match(/(?:running|execute|run|command):?\s*[`"']?([^`"'\n]{3,80})[`"']?/i);
  if (match) return match[1].trim();
  const shellMatch = text.match(/(?:^|\n)\$\s*([^\n]{3,80})/);
  if (shellMatch) return shellMatch[1].trim();
  return undefined;
}

function extractSearchQuery(text: string): string | undefined {
  const match = text.match(/(?:search|query|looking for|find)\s*:?\s*[`"']([^`"']+)[`"']/i);
  if (match) return match[1].trim().slice(0, 100);
  return undefined;
}

function extractContext(text: string, type: ActionCategory): string {
  const normalized = text.trim();
  if (!normalized) return "";

  if (type === "command") {
    const cmd = extractCommand(text);
    if (cmd) return cmd.slice(0, 70);
  }
  if (type === "search") {
    const query = extractSearchQuery(text);
    if (query) return query;
  }
  if (type.startsWith("file_")) {
    const path = extractFilePath(text);
    if (path) return path;
  }

  if (normalized.length <= 50) return normalized;
  const firstSentence = normalized.split(/[.!?]/)[0];
  if (firstSentence && firstSentence.length > 10 && firstSentence.length < 80) {
    return firstSentence.trim();
  }
  return normalized.slice(0, 60) + (normalized.length > 60 ? "…" : "");
}

/* ── Build Actions ────────────────────────────────────── */

export function buildAgentActions(thoughts: ThoughtItem[]): AgentActionItem[] {
  return thoughts.map((t, idx) => {
    let stepLabel = t.step.replace(/_/g, " ");
    let status: ActionStatus = "completed";
    let durationMs: number | null = null;
    let detail: string | null = null;

    if (t.meta) {
      for (const meta of t.meta) {
        if (meta.startsWith("stepLabel:")) stepLabel = meta.substring("stepLabel:".length);
        if (meta.startsWith("status:")) {
          const s = meta.substring("status:".length);
          if (s === "streaming" || s === "running") status = "running";
          else if (s === "failed") status = "failed";
          else if (s === "pending") status = "pending";
        }
        if (meta.startsWith("durationMs:")) durationMs = parseInt(meta.substring("durationMs:".length), 10);
        if (meta.startsWith("detail:")) detail = meta.substring("detail:".length);
      }
    }

    const type = detectActionCategory(t.step, stepLabel, t.text);
    const context = extractContext(t.text, type);
    const config = CATEGORY_CONFIG[type];

    return {
      id: `${t.step}-${idx}-${t.timestamp || Date.now()}`,
      type,
      label: config.label,
      context,
      detail: detail || null,
      status,
      durationMs,
      text: t.text,
      timestamp: t.timestamp,
      command: type === "command" ? extractCommand(t.text) : undefined,
      filePath: type.startsWith("file_") ? extractFilePath(t.text) : undefined,
      searchQuery: type === "search" ? extractSearchQuery(t.text) : undefined,
    };
  });
}

/* ── Phase Grouping ───────────────────────────────────── */

interface PhaseGroup {
  phase: AgentPhase;
  actions: AgentActionItem[];
  status: ActionStatus;
}

export function groupActionsIntoPhases(actions: AgentActionItem[], thoughts: ThoughtItem[]): PhaseGroup[] {
  const groups = new Map<AgentPhase, PhaseGroup>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const thought = thoughts[i];
    const phase = derivePhase(thought?.step ?? "unknown", thought?.toolName ?? null);

    if (!groups.has(phase)) {
      groups.set(phase, { phase, actions: [], status: "completed" });
    }
    const group = groups.get(phase)!;
    group.actions.push(action);
    if (action.status === "running" || action.status === "pending") {
      group.status = "running";
    } else if (action.status === "failed" && group.status !== "running") {
      group.status = "failed";
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const orderA = PHASE_CONFIG[a.phase].order;
    const orderB = PHASE_CONFIG[b.phase].order;
    return orderA - orderB;
  });
}

/* ── Sub-components ───────────────────────────────────── */

export function StatusIcon({ status }: { status: ActionStatus | "success" | "error" }) {
  switch (status) {
    case "success":
    case "completed":
      return <CheckCircle2 className="h-3 w-3 text-emerald-400/70" />;
    case "error":
    case "failed":
      return <AlertCircle className="h-3 w-3 text-red-400/70" />;
    case "running":
    case "pending":
      return <Loader2 className="h-3 w-3 animate-spin text-white/50" />;
    default:
      return null;
  }
}

export function TerminalCommand({ command, isStreaming }: { command: string; isStreaming?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 font-mono text-[11px]">
      <span className="text-white/30 select-none">$</span>
      <span className="text-white/70">{command}</span>
      {isStreaming && (
        <span className="inline-block h-3.5 w-1.5 bg-white/40 animate-pulse rounded-sm" />
      )}
    </div>
  );
}

export function FilePathBadge({ path, operation }: { path: string; operation: "create" | "read" | "write" | "edit" }) {
  const colorMap = {
    create: "text-emerald-400/80 bg-emerald-400/8 border-emerald-400/15",
    read: "text-blue-400/80 bg-blue-400/8 border-blue-400/15",
    write: "text-sky-400/80 bg-sky-400/8 border-sky-400/15",
    edit: "text-orange-400/80 bg-orange-400/8 border-orange-400/15",
  };
  const iconMap = { create: "+", read: "◆", write: "◆", edit: "~" };

  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono border ${colorMap[operation]}`}>
      <span className="opacity-50 select-none">{iconMap[operation]}</span>
      <span className="truncate max-w-[200px]">{path}</span>
    </span>
  );
}

export function SearchQueryBadge({ query }: { query: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/8 px-1.5 py-0.5 text-[10px] font-medium text-amber-400/70 border border-amber-400/15">
      <Search className="h-2.5 w-2.5" />
      <span className="truncate max-w-[200px]">{query}</span>
    </span>
  );
}

/* ── Phase Bar ─────────────────────────────────────────── */

export function PhasePill({
  phase,
  status,
  isActive,
  actionCount,
  onClick,
}: {
  phase: AgentPhase;
  status: ActionStatus;
  isActive: boolean;
  actionCount: number;
  onClick?: () => void;
}) {
  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  const isRunning = status === "running" || status === "pending";
  const isFailed = status === "failed";
  const isCompleted = status === "completed";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200 ${
        isActive
          ? "border-white/[0.10] bg-white/[0.06] text-white/80"
          : isCompleted
            ? "border-white/[0.04] bg-white/[0.02] text-white/40 hover:bg-white/[0.04] hover:text-white/60"
            : isFailed
              ? "border-red-400/15 bg-red-400/6 text-red-300/60 hover:bg-red-400/10"
              : "border-white/[0.04] bg-white/[0.02] text-white/40 hover:bg-white/[0.04]"
      }`}
    >
      <div className="relative flex h-3.5 w-3.5 items-center justify-center">
        {isRunning && (
          <div
            className="absolute h-3.5 w-3.5 rounded-full animate-ping opacity-20"
            style={{ backgroundColor: config.color }}
          />
        )}
        <Icon
          className={`h-3 w-3 transition-all ${isActive ? "opacity-100" : "opacity-50"}`}
          style={{ color: isFailed ? "#f87171" : config.color }}
        />
      </div>
      <span>{config.label}</span>
      {actionCount > 1 && (
        <span className="text-[10px] text-white/20 ml-0.5">{actionCount}</span>
      )}
      {isCompleted && !isActive && (
        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400/40 ml-0.5" />
      )}
      {isFailed && (
        <AlertCircle className="h-2.5 w-2.5 text-red-400/60 ml-0.5" />
      )}
    </button>
  );
}

/* ── Action Row ─────────────────────────────────────────── */

function ActionRow({
  action,
  isExpanded,
  onToggleExpand,
}: {
  action: AgentActionItem;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const config = CATEGORY_CONFIG[action.type];
  const Icon = config.icon;
  const isActive = action.status === "running" || action.status === "pending";

  return (
    <button
      type="button"
      onClick={onToggleExpand}
      className="group relative flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-all duration-200 hover:bg-white/[0.04] active:scale-[0.995]"
    >
      {/* Category icon */}
      <div className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center">
        {isActive && (
          <div
            className="absolute h-5 w-5 rounded-full animate-ping opacity-15"
            style={{ backgroundColor: config.color }}
          />
        )}
        <Icon
          className={`h-3.5 w-3.5 transition-all duration-300 ${isActive ? "opacity-100" : "opacity-50"}`}
          style={{ color: config.color }}
        />
      </div>

      {/* Content */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <span
          className={`shrink-0 text-[12.5px] font-medium transition-colors duration-200 ${isActive ? "text-white/85" : "text-white/55"}`}
        >
          {config.label}
        </span>
        {action.context && (
          <>
            <span className="shrink-0 text-[12px] text-white/15 select-none">·</span>
            <span className="truncate text-[11.5px] text-white/35 font-mono">
              {action.type === "command" && action.command ? (
                <span className="flex items-center gap-1">
                  <span className="text-white/20">$</span>
                  <span className="truncate">{action.command.slice(0, 45)}</span>
                </span>
              ) : action.type === "search" && action.searchQuery ? (
                <SearchQueryBadge query={action.searchQuery} />
              ) : action.type.startsWith("file_") && action.filePath ? (
                <FilePathBadge
                  path={action.filePath}
                  operation={action.type === "file_create" ? "create" : action.type === "file_read" ? "read" : action.type === "file_write" ? "write" : "edit"}
                />
              ) : (
                action.context
              )}
            </span>
          </>
        )}
      </div>

      {/* Right side */}
      <div className="flex shrink-0 items-center gap-1.5">
        {action.durationMs != null && action.durationMs > 0 && (
          <span className="text-[10px] font-mono text-white/20">
            {action.durationMs < 1000 ? `${action.durationMs}ms` : `${(action.durationMs / 1000).toFixed(1)}s`}
          </span>
        )}
        {action.status === "running" && (
          <Loader2 className="h-3 w-3 animate-spin text-white/30" />
        )}
        {action.status === "failed" && (
          <AlertCircle className="h-3 w-3 text-red-400/50" />
        )}
        <ChevronRight className={`h-3 w-3 text-white/15 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
      </div>
    </button>
  );
}

/* ── Rich Action Row with Expandable Tool Results ──────── */

function RichActionRow({
  action,
  rawResult,
}: {
  action: AgentActionItem;
  rawResult?: import("../../stores/chat/types").ToolRawResult | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex flex-col">
      <ActionRow
        action={action}
        isExpanded={expanded}
        onToggleExpand={() => setExpanded(!expanded)}
      />
      {expanded && rawResult && (
        <div className="px-2 pb-2">
          <div className="rounded-xl border border-white/[0.04] bg-white/[0.015] p-3 mt-0.5">
            <ToolResultCard rawResult={rawResult} compact />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */

export function AgentActionStream({ thoughts, isThinking = false }: AgentActionStreamProps) {
  const [expandedPhase, setExpandedPhase] = useState<string | null>(null);
  const agentToolLog = useChatStore((state) => state.agentToolLog);

  const actions = useMemo(() => buildAgentActions(thoughts), [thoughts]);
  const phases = useMemo(() => groupActionsIntoPhases(actions, thoughts), [actions, thoughts]);

  // Map actions to their rich tool results from the agent tool log
  const actionRawResults = useMemo(() => {
    const map = new Map<string, import("../../stores/chat/types").ToolRawResult | null>();
    for (const action of actions) {
      // Match by tool name: action type (search, file_create, etc.) maps to tool name (web_search, coder, etc.)
      const entry = agentToolLog.find((log) => {
        if (log.tool === action.type) return true;
        if (action.type === "search" && log.tool === "web_search") return true;
        if (action.type === "command" && log.tool === "executor") return true;
        if (action.type === "file_create" && log.tool === "coder") return true;
        if (action.type === "media" && log.tool === "executor") return true;
        if (action.type === "preview" && log.tool === "executor") return true;
        return false;
      });
      map.set(action.id, entry?.rawResult ?? null);
    }
    return map;
  }, [actions, agentToolLog]);

  const visiblePhase = useMemo(() => {
    if (expandedPhase !== null) {
      const found = phases.find((p) => p.phase === expandedPhase);
      if (found) return expandedPhase;
    }
    const runningIdx = phases.findIndex((p) => p.status === "running" || p.status === "pending");
    if (runningIdx >= 0) return phases[runningIdx].phase;
    if (phases.length > 0 && phases[phases.length - 1].phase === "complete") return phases[phases.length - 1].phase;
    return phases.length > 0 ? phases[phases.length - 1].phase : null;
  }, [phases, expandedPhase]);

  const visiblePhaseGroup = visiblePhase ? phases.find((p) => p.phase === visiblePhase) : null;

  const handlePhaseClick = useCallback(
    (phaseId: string) => {
      setExpandedPhase((prev) => (prev === phaseId ? null : phaseId));
    },
    []
  );

  const handleActionClick = useCallback(
    (phaseId: string) => {
      handlePhaseClick(phaseId);
    },
    [handlePhaseClick]
  );

  if (thoughts.length === 0 && !isThinking) return null;

  return (
    <div className="my-3 select-none">
      {/* Phase Bar */}
      {phases.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          {phases.map((phaseGroup) => (
            <PhasePill
              key={phaseGroup.phase}
              phase={phaseGroup.phase}
              status={phaseGroup.status}
              isActive={phaseGroup.phase === visiblePhase}
              actionCount={phaseGroup.actions.length}
              onClick={() => handlePhaseClick(phaseGroup.phase)}
            />
          ))}
        </div>
      )}

      {/* Current phase expanded actions */}
      {visiblePhaseGroup && (
        <div className="relative overflow-hidden rounded-2xl border border-white/[0.04] bg-white/[0.01] transition-all duration-300">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.03]">
            <span
              className="text-[10px] font-medium uppercase tracking-wider"
              style={{ color: PHASE_CONFIG[visiblePhaseGroup.phase].color, opacity: 0.7 }}
            >
              {PHASE_CONFIG[visiblePhaseGroup.phase].label}
            </span>
            <span className="text-[10px] text-white/20">
              {visiblePhaseGroup.actions.length} action
              {visiblePhaseGroup.actions.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="relative flex flex-col gap-0.5 px-0.5 py-1">
            {visiblePhaseGroup.actions.map((action) => (
              <RichActionRow
                key={action.id}
                action={action}
                rawResult={actionRawResults.get(action.id) ?? null}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
