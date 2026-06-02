import { useState, useRef, useCallback, useMemo, useEffect, memo } from "react";
import {
  Folder,
  FileCode,
  FileJson,
  FileText,
  FileType,
  File as FileIcon,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Terminal,
  CheckCircle2,
  XCircle,
  Loader2,
  Maximize2,
  Minimize2,
  AlertCircle,
  Code2,
  Layers,
  Search,
  Globe,
  Clock,
  Activity,
} from "lucide-react";
import { useChatStore } from "../../stores";
import type { AgentFileEntry, AgentToolLogEntry } from "../../stores/chat/types";
import type { MediaLifecycleStage } from "../../stores/chat/types";
import type { ThoughtItem } from "./MessageComponents";
import { useConsoleState, type ConsoleTab } from "./useConsoleState";
import { buildAgentActions, CATEGORY_CONFIG, type AgentActionItem, StatusIcon } from "./AgentActionStream";
import { SearchResultCard } from "./tool-results";

/* ── Helpers ─────────────────────────────────────────── */

function fileIconForName(name: string) {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  switch (ext) {
    case "js":
    case "jsx":
    case "ts":
    case "tsx":
      return <FileCode className="h-3 w-3 text-yellow-400/80" />;
    case "py":
      return <FileCode className="h-3 w-3 text-blue-400/80" />;
    case "css":
    case "scss":
      return <FileText className="h-3 w-3 text-purple-400/80" />;
    case "json":
      return <FileJson className="h-3 w-3 text-orange-400/80" />;
    case "md":
      return <FileText className="h-3 w-3 text-white/60" />;
    case "html":
      return <FileType className="h-3 w-3 text-red-400/80" />;
    default:
      return <FileIcon className="h-3 w-3 text-white/40" />;
  }
}

interface TreeNodeData {
  name: string;
  path: string;
  kind: "file" | "dir";
  children: Record<string, TreeNodeData>;
}

function buildCompactTree(paths: string[]): TreeNodeData[] {
  const root: Record<string, TreeNodeData> = {};
  for (const filePath of paths) {
    const parts = filePath.split("/");
    let currentMap = root;
    let accumulatedPath = "";
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumulatedPath = accumulatedPath ? accumulatedPath + "/" + part : part;
      const isFile = i === parts.length - 1;
      if (!currentMap[part]) {
        currentMap[part] = {
          name: part,
          path: accumulatedPath,
          kind: isFile ? "file" : "dir",
          children: {},
        };
      }
      if (isFile) {
        currentMap[part].kind = "file";
        currentMap[part].path = filePath;
      }
      currentMap = currentMap[part].children;
    }
  }
  return Object.values(root).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function TreeNode({ node, depth = 0 }: { node: TreeNodeData; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const indent = depth * 12;

  if (node.kind === "file") {
    return (
      <div
        className="flex items-center gap-1.5 py-0.5 text-[11px] font-mono text-[#7ee787]/80 hover:text-[#7ee787] transition-colors"
        style={{ paddingLeft: indent + 4 }}
      >
        {fileIconForName(node.name)}
        <span className="truncate">{node.name}</span>
      </div>
    );
  }

  const childNodes = Object.values(node.children).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1 py-0.5 text-left text-[11px] text-white/50 transition hover:text-[#56d364]"
        style={{ paddingLeft: indent + 4 }}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Folder className="h-3 w-3 shrink-0 text-white/40" />
        <span className="font-medium">{node.name}</span>
      </button>
      {expanded &&
        childNodes.map((child) => (
          <TreeNode key={child.path} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}

/* ── CRT Styling ─────────────────────────────────────── */

function CRTScanlines() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 opacity-[0.03]"
      style={{
        background:
          "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.25) 2px, rgba(0,0,0,0.25) 4px)",
      }}
    />
  );
}

function CRTGlow({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <CRTScanlines />
    </div>
  );
}

/* ── Tab Bar ─────────────────────────────────────────── */

const TAB_CONFIG: Record<
  ConsoleTab,
  { label: string; icon: React.ElementType; glow: string }
> = {
  files: { label: "Files", icon: Folder, glow: "shadow-[#7ee787]/20" },
  terminal: { label: "Terminal", icon: Terminal, glow: "shadow-[#79c0ff]/20" },
  code: { label: "Code", icon: Code2, glow: "shadow-[#56d364]/20" },
  browser: { label: "Browser", icon: Search, glow: "shadow-[#fbbf24]/20" },
};

function TabBar({
  activeTab,
  onTabChange,
  availableTabs,
  runningCount,
}: {
  activeTab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  availableTabs: ConsoleTab[];
  runningCount: number;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-white/[0.06] bg-black/60 px-2 py-1">
      {availableTabs.map((tab) => {
        const cfg = TAB_CONFIG[tab];
        const Icon = cfg.icon;
        const isActive = tab === activeTab;
        const isTerminal = tab === "terminal";
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`
              flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-all relative
              ${
                isActive
                  ? "bg-white/[0.06] text-[#79c0ff] shadow-[0_0_8px_rgba(121,192,255,0.08)]"
                  : "text-white/40 hover:bg-white/[0.03] hover:text-white/60"
              }
            `}
          >
            <Icon className="h-3 w-3" />
            <span>{cfg.label}</span>
            {isTerminal && runningCount > 0 && (
              <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse ml-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Window Contents ─────────────────────────────────── */

function FilesWindow({ files }: { files: AgentFileEntry[] }) {
  const [filesOpen, setFilesOpen] = useState(true);
  const tree = useMemo(() => buildCompactTree(files.map((f) => f.path)), [files]);

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="rounded-md border border-white/[0.04] bg-black/30 p-2">
        <button
          type="button"
          onClick={() => setFilesOpen(!filesOpen)}
          className="flex w-full items-center gap-1.5 text-left text-[11px] text-[#7ee787]/70 hover:text-[#7ee787] transition"
        >
          {filesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span className="font-mono uppercase tracking-wider">File System</span>
          <span className="ml-auto text-white/20">{files.length} file{files.length !== 1 ? "s" : ""}</span>
        </button>
        {filesOpen && (
          <div className="mt-1 pl-1">
            {tree.map((node) => (
              <TreeNode key={node.path} node={node} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Terminal Window (Primary Hub) ──────────────────── */

interface TerminalActionLogProps {
  actions: AgentActionItem[];
  toolLog: AgentToolLogEntry[];
  focusedActionId: string | null;
  onActionClick: (action: AgentActionItem) => void;
}

function formatTimestamp(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function TerminalActionLog({ actions, toolLog, focusedActionId, onActionClick }: TerminalActionLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Build unified timeline: merge actions with tool log entries
  const timeline = useMemo(() => {
    type TimelineEntry =
      | { kind: "action"; id: string; action: AgentActionItem; tool: null; timestamp: number }
      | { kind: "tool"; id: string; action: null; tool: AgentToolLogEntry; timestamp: number };

    const merged: TimelineEntry[] = actions.map((action) => ({
      kind: "action" as const,
      id: action.id,
      action,
      tool: null,
      timestamp: action.timestamp || 0,
    }));

    // Add tool log entries that don't have corresponding actions
    toolLog.forEach((tool) => {
      const existing = merged.find((m) => m.kind === "tool" && m.tool?.id === tool.id);
      if (!existing) {
        merged.push({
          kind: "tool" as const,
          id: `tool-${tool.id}`,
          action: null,
          tool,
          timestamp: new Date(tool.timestamp).getTime(),
        });
      }
    });

    return merged.sort((a, b) => a.timestamp - b.timestamp);
  }, [actions, toolLog]);

  // Auto-scroll to focused action
  useEffect(() => {
    if (focusedActionId && scrollRef.current) {
      const el = scrollRef.current.querySelector(`[data-action-id="${focusedActionId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [focusedActionId]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div ref={scrollRef} className="flex flex-col gap-0">
      {/* Terminal header */}
      <div className="flex items-center gap-2 border-b border-white/[0.04] bg-black/40 px-3 py-1.5">
        <Activity className="h-3 w-3 text-[#79c0ff]/60" />
        <span className="text-[10px] font-mono uppercase tracking-wider text-white/30">
          Agent Activity Log
        </span>
        <span className="ml-auto text-[10px] font-mono text-white/20">
          {actions.length} actions · {toolLog.length} tools
        </span>
      </div>

      <div className="flex flex-col">
        {timeline.length === 0 && (
          <div className="flex h-32 items-center justify-center text-[11px] text-white/20 font-mono">
            No agent activity recorded yet.
          </div>
        )}

        {timeline.map((entry, idx) => {
          if (entry.kind === "action" && entry.action) {
            const action = entry.action;
            const config = CATEGORY_CONFIG[action.type];
            const Icon = config.icon;
            const isFocused = focusedActionId === action.id;
            const isExpanded = expandedIds.has(action.id);

            return (
              <div
                key={`act-${idx}-${action.id}`}
                data-action-id={action.id}
                className={`
                  flex flex-col border-b border-white/[0.03] transition-colors
                  ${isFocused ? "bg-[#79c0ff]/[0.03]" : "hover:bg-white/[0.01]"}
                `}
              >
                <button
                  type="button"
                  onClick={() => {
                    toggleExpanded(action.id);
                    onActionClick(action);
                  }}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left"
                >
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                    <Icon className="h-3 w-3" style={{ color: config.color }} />
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-white/70">
                        {action.label}
                      </span>
                      {action.context && (
                        <span className="truncate text-[10px] text-white/30">
                          {action.context}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[10px] font-mono text-white/15">
                        {formatTimestamp(action.timestamp)}
                      </span>
                      {action.durationMs != null && action.durationMs > 0 && (
                        <span className="flex items-center gap-0.5 text-[10px] font-mono text-white/20">
                          <Clock className="h-2.5 w-2.5" />
                          {action.durationMs}ms
                        </span>
                      )}
                      <StatusIcon status={action.status} />
                    </div>
                  </div>

                  <div className="mt-0.5 shrink-0">
                    <ChevronRight
                      className={`h-3 w-3 text-white/15 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-2 pl-9">
                    <div
                      className="rounded-md border border-white/[0.04] px-3 py-2.5 text-[11px] leading-relaxed"
                      style={{ backgroundColor: config.bg }}
                    >
                      <div className="mb-1.5 flex items-center gap-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: config.color }}>
                          {action.label}
                        </span>
                        <span className="text-[10px] font-mono text-white/20">#{action.id}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-white/60">{action.text}</p>
                      {action.detail && (
                        <div className="mt-2 overflow-x-auto rounded bg-black/30 px-2 py-1.5 font-mono text-[10px] text-white/30">
                          {action.detail}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          }

          // Tool-only entry
          if (entry.kind === "tool" && entry.tool) {
            const tool = entry.tool;
            return (
              <div
                key={`tool-${idx}-${tool.id}`}
                className="flex items-start gap-2 border-b border-white/[0.03] px-3 py-2 hover:bg-white/[0.01]"
              >
                <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {tool.status === "success" ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-400/60" />
                  ) : tool.status === "error" ? (
                    <XCircle className="h-3 w-3 text-red-400/60" />
                  ) : (
                    <Loader2 className="h-3 w-3 animate-spin text-amber-400/60" />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-[11px] font-medium text-white/50">{tool.tool}</span>
                  {tool.output && (
                    <span className="truncate text-[10px] text-white/20">{tool.output}</span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-white/15">{tool.durationMs}ms</span>
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}

function CodeWindow({ code }: { code?: string | null }) {
  if (!code) {
    return (
      <div className="flex h-32 items-center justify-center text-[11px] text-white/20 font-mono">
        No code to display.
      </div>
    );
  }

  return (
    <div className="overflow-auto p-3">
      <pre className="text-[11px] font-mono leading-relaxed text-[#d1d5db]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function BrowserWindow({ toolLog, urls }: { toolLog: import("../../stores/chat/types").AgentToolLogEntry[]; urls: string[] }) {
  // Extract all search results from tool log
  const searchEntries = toolLog.filter(
    (entry) => entry.rawResult?.type === "search"
  );

  if (searchEntries.length === 0 && urls.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-[11px] text-white/20 font-mono">
        No search results to display.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-3 max-h-[500px] overflow-y-auto scrollbar">
      {/* Rich search results from tool log */}
      {searchEntries.map((entry, idx) => (
        <div key={idx} className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 mb-1">
            <Search className="h-3 w-3 text-amber-400/40" />
            <span className="text-[10px] text-white/30 font-mono">
              {entry.tool} · {(entry.durationMs / 1000).toFixed(1)}s
            </span>
          </div>
          {entry.rawResult && <SearchResultCard data={entry.rawResult as any} compact={false} />}
        </div>
      ))}

      {/* Legacy URL list fallback */}
      {urls.length > 0 && searchEntries.length === 0 && (
        <div className="flex flex-col gap-1.5">
          {urls.map((url, idx) => {
            let hostname = url;
            try {
              hostname = new URL(url).hostname.replace(/^www\./, "");
            } catch { /* keep raw */ }
            return (
              <a
                key={idx}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-md border border-white/[0.04] bg-white/[0.02] px-2.5 py-2 text-[11px] transition-colors hover:bg-white/[0.04] hover:border-[#fbbf24]/20 group"
              >
                <Globe className="h-3 w-3 shrink-0 text-[#fbbf24]/50 group-hover:text-[#fbbf24]/70" />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-[#79c0ff]/80">{hostname}</span>
                  <span className="truncate text-[10px] text-white/20">{url}</span>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-white/15 group-hover:text-white/30" />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main AgentConsole ───────────────────────────────── */

export interface AgentConsoleProps {
  files: AgentFileEntry[];
  toolLog: AgentToolLogEntry[];
  thoughts: ThoughtItem[];
  code?: string | null;
  skill?: string | null;
  sceneId?: string | null;
  versionId?: string | null;
  streaming?: boolean;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaStatusStage?: MediaLifecycleStage;
  mediaStatusText?: string | null;
  outputKind?: "code" | "media" | null;
  searchUrls?: string[];
  activeTab?: ConsoleTab;
  onTabChange?: (tab: ConsoleTab) => void;
  isLatest?: boolean;
  focusedActionId?: string | null;
}

const AgentConsoleInner = memo(function AgentConsoleInner({
  files,
  toolLog,
  thoughts,
  code,
  streaming,
  searchUrls = [],
  activeTab: controlledTab,
  onTabChange,
  isLatest = false,
  focusedActionId = null,
}: AgentConsoleProps) {
  const hasFiles = files.length > 0;
  const hasTools = toolLog.length > 0;
  const hasCode = Boolean(code);
  const hasBrowser = searchUrls.length > 0 || toolLog.some((t) => t.rawResult?.type === "search");
  const hasActions = thoughts.length > 0;

  const defaultTab: ConsoleTab = hasActions || hasTools ? "terminal"
    : hasFiles ? "files"
    : hasBrowser ? "browser"
    : hasCode ? "code"
    : "terminal";

  const internal = useConsoleState(defaultTab);
  const { openWorkspace } = useChatStore();

  const availableTabs = useMemo<ConsoleTab[]>(() => {
    const tabs: ConsoleTab[] = [];
    if (hasActions || hasTools) tabs.push("terminal");
    if (hasFiles) tabs.push("files");
    if (hasCode) tabs.push("code");
    if (hasBrowser) tabs.push("browser");
    return tabs;
  }, [hasActions, hasTools, hasFiles, hasCode, hasBrowser]);

  // Controlled tab state: use prop if provided, otherwise internal state
  const setTab = useCallback((tab: ConsoleTab) => {
    onTabChange?.(tab);
    internal.setTab(tab);
  }, [onTabChange, internal.setTab]);

  const activeTab = controlledTab ?? (availableTabs.includes(internal.state.activeTab) ? internal.state.activeTab : availableTabs[0] ?? "terminal");

  // When focusedActionId changes, switch to terminal tab
  useEffect(() => {
    if (focusedActionId && activeTab !== "terminal") {
      setTab("terminal");
    }
  }, [focusedActionId, activeTab, setTab]);

  const runningCount = useMemo(() => {
    const actionRunning = thoughts.filter(t => {
      const meta = t.meta?.find(m => m.startsWith("status:"));
      return meta?.includes("running");
    }).length;
    const toolRunning = toolLog.filter(t => t.status === "running").length;
    return actionRunning + toolRunning;
  }, [thoughts, toolLog]);

  const agentActions = useMemo(() => buildAgentActions(thoughts), [thoughts]);

  // Early return only after all hooks have been called
  if (availableTabs.length === 0) return null;

  // Collapsed mini-bar
  if (internal.state.isCollapsed) {
    return (
      <button
        type="button"
        onClick={internal.toggleCollapsed}
        className="group mt-3 flex w-full items-center gap-2 rounded-xl border border-white/[0.06] bg-black/40 px-3 py-2 text-left transition-all hover:border-[#79c0ff]/20 hover:bg-black/60"
      >
        <Layers className="h-3.5 w-3.5 text-[#79c0ff]/50" />
        <span className="text-[11px] font-medium text-white/50 font-mono">AGENT CONSOLE</span>
        <span className="ml-auto flex items-center gap-1.5">
          {runningCount > 0 && (
            <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
          )}
          {(hasActions || hasTools) && <span className="text-[10px] text-white/30">{thoughts.length + toolLog.length}A</span>}
          {hasFiles && <span className="text-[10px] text-white/30">{files.length}F</span>}
          {hasBrowser && <Search className="h-3 w-3 text-white/20" />}
        </span>
        <span className="text-[10px] text-white/20">Click to expand</span>
      </button>
    );
  }

  return (
    <div
      className={`
        card-glass card-glass-accent group relative mt-3 overflow-hidden
        transition-all duration-300
        ${internal.state.isExpanded ? "shadow-[0_0_24px_rgba(0,0,0,0.5)]" : ""}
      `}
    >
      <CRTGlow>
        {/* Header bar */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-black/60 px-3 py-2">
          <Terminal className="h-3.5 w-3.5 text-[#79c0ff]/60" />
          <span className="text-[11px] font-bold font-mono uppercase tracking-[0.1em] text-[#79c0ff]/70">
            Agent Console
          </span>

          {/* Header stats */}
          <div className="ml-auto flex items-center gap-2">
            {runningCount > 0 && (
              <span className="flex items-center gap-1 rounded bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-mono text-amber-400/70">
                <span className="flex h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                {runningCount} running
              </span>
            )}
            {(hasActions || hasTools) && (
              <span className="rounded bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-mono text-white/30">
                {thoughts.length + toolLog.length}A
              </span>
            )}
            {hasFiles && (
              <span className="rounded bg-white/[0.03] px-1.5 py-0.5 text-[9px] font-mono text-white/30">
                {files.length}F
              </span>
            )}
            <button
              type="button"
              onClick={internal.toggleExpanded}
              className="flex items-center rounded-md p-1 text-white/20 transition hover:bg-white/[0.04] hover:text-white/50"
              title={internal.state.isExpanded ? "Collapse" : "Expand"}
            >
              {internal.state.isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => openWorkspace()}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-white/30 transition hover:bg-white/[0.04] hover:text-white/60"
            >
              <ExternalLink className="h-3 w-3" />
              Open
            </button>
            <button
              type="button"
              onClick={internal.toggleCollapsed}
              className="rounded-md p-1 text-white/20 transition hover:bg-white/[0.04] hover:text-white/50"
              title="Minimize"
            >
              <Minimize2 className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <TabBar activeTab={activeTab} onTabChange={setTab} availableTabs={availableTabs} runningCount={runningCount} />

        {/* Window content */}
        <div className={internal.state.isExpanded ? "max-h-[600px] overflow-auto scrollbar" : "max-h-[320px] overflow-auto scrollbar"}>
          {activeTab === "files" && <FilesWindow files={files} />}
          {activeTab === "terminal" && (
            <TerminalActionLog
              actions={agentActions}
              toolLog={toolLog}
              focusedActionId={focusedActionId}
              onActionClick={(action) => {
                // Action is already in terminal, just ensure expanded
              }}
            />
          )}
          {activeTab === "code" && <CodeWindow code={code} />}
          {activeTab === "browser" && <BrowserWindow urls={searchUrls} toolLog={toolLog} />}
        </div>

        {/* Footer status line */}
        <div className="flex items-center gap-2 border-t border-white/[0.04] bg-black/60 px-3 py-1">
          <div className={`flex h-1.5 w-1.5 rounded-full ${runningCount > 0 ? "bg-amber-400 animate-pulse" : "bg-[#79c0ff]/60"}`} />
          <span className="text-[9px] font-mono uppercase tracking-wider text-white/25">
            {activeTab} · {runningCount > 0 ? `${runningCount} RUNNING` : "IDLE"} · {thoughts.length + toolLog.length} total
          </span>
        </div>
      </CRTGlow>
    </div>
  );
}, (prev, next) => {
  // Prevent re-renders during parent streaming when console props haven't meaningfully changed
  const prevSettled = !prev.streaming && prev.thoughts.length > 0;
  const nextSettled = !next.streaming && next.thoughts.length > 0;

  if (prevSettled && nextSettled) {
    return (
      prev.code === next.code &&
      prev.skill === next.skill &&
      prev.sceneId === next.sceneId &&
      prev.versionId === next.versionId &&
      prev.mediaUrl === next.mediaUrl &&
      prev.mediaType === next.mediaType &&
      prev.mediaStatusStage === next.mediaStatusStage &&
      prev.outputKind === next.outputKind &&
      prev.isLatest === next.isLatest &&
      prev.activeTab === next.activeTab &&
      prev.focusedActionId === next.focusedActionId &&
      (prev.searchUrls ?? []).length === (next.searchUrls ?? []).length &&
      (prev.searchUrls ?? []).every((u, i) => u === (next.searchUrls ?? [])[i])
    );
  }
  return false;
});

export function AgentConsole(props: AgentConsoleProps) {
  return <AgentConsoleInner {...props} />;
}
