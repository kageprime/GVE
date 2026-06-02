import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  Terminal,
  Clock,
  ArrowDownToLine,
} from "lucide-react";
import type { AgentToolLogEntry } from "../../stores/chat/types";
import type { ThoughtItem } from "./MessageComponents";
import {
  buildAgentActions,
  CATEGORY_CONFIG,
  type AgentActionItem,
  StatusIcon,
  TerminalCommand,
  FilePathBadge,
  SearchQueryBadge,
} from "./AgentActionStream";

function formatTimestamp(ts?: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function useScrollControl(isRunning: boolean, entryCount: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const prevEntryCountRef = useRef(entryCount);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 40;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setShowJumpButton(!atBottom && entryCount > 0);
    if (!atBottom && autoScrollEnabled) {
      setAutoScrollEnabled(false);
    }
  }, [entryCount, autoScrollEnabled]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !autoScrollEnabled) return;
    if (entryCount > prevEntryCountRef.current || isRunning) {
      el.scrollTop = el.scrollHeight;
    }
    prevEntryCountRef.current = entryCount;
  }, [entryCount, isRunning, autoScrollEnabled]);

  const jumpToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScrollEnabled(true);
    setShowJumpButton(false);
  }, []);

  return { scrollRef, showJumpButton, handleScroll, jumpToBottom };
}

function useTypingAnimation(text: string | null, isActive: boolean, speed: number = 8) {
  const [displayText, setDisplayText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isActive || !text) {
      setDisplayText(text || "");
      setIsTyping(false);
      return;
    }

    setIsTyping(true);
    let index = 0;
    let current = "";

    const typeNext = () => {
      if (index >= text.length) {
        setDisplayText(text);
        setIsTyping(false);
        return;
      }
      const char = text[index];
      current += char;
      setDisplayText(current);
      index++;
      let delay = speed;
      if ('.!?,;:'.includes(char)) {
        delay = speed + Math.random() * 30 + 20;
      } else {
        delay = speed + Math.random() * 3;
      }
      timeoutRef.current = setTimeout(typeNext, delay);
    };

    typeNext();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [text, isActive, speed]);

  return { displayText, isTyping };
}

export function AgentTimeline({
  thoughts,
  toolLog,
  isRunning,
  thinkingText,
  thinkingStep,
}: {
  thoughts: ThoughtItem[];
  toolLog: AgentToolLogEntry[];
  isRunning: boolean;
  thinkingText: string | null;
  thinkingStep: string;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const agentActions = useMemo(() => buildAgentActions(thoughts), [thoughts]);

  const allEntries = useMemo(() => {
    const entries: Array<
      | { kind: "action"; item: AgentActionItem }
      | { kind: "tool"; item: AgentToolLogEntry }
      | { kind: "live"; text: string; step: string }
    > = [];

    agentActions.forEach((action) => {
      entries.push({ kind: "action", item: action });
    });

    toolLog.forEach((tool) => {
      const hasAction = agentActions.some(
        (a) => a.text.includes(tool.tool) || tool.output.includes(a.context)
      );
      if (!hasAction) {
        entries.push({ kind: "tool", item: tool });
      }
    });

    if (isRunning && thinkingText) {
      entries.push({ kind: "live", text: thinkingText, step: thinkingStep });
    }

    return entries;
  }, [agentActions, toolLog, isRunning, thinkingText, thinkingStep]);

  const { scrollRef, showJumpButton, handleScroll, jumpToBottom } = useScrollControl(
    isRunning,
    allEntries.length
  );

  const liveEntry = allEntries[allEntries.length - 1];
  const isLiveThinking = liveEntry?.kind === "live";
  const { displayText: typedThinkingText, isTyping } = useTypingAnimation(
    isLiveThinking ? liveEntry.text : null,
    isRunning,
    4
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="relative flex h-full flex-col overflow-auto scrollbar"
    >
      {allEntries.length > 0 && (
        <div className="absolute left-[19px] top-[10px] bottom-[10px] w-[1.5px] rounded-full bg-white/[0.04]" />
      )}

      {allEntries.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-white/20">
          <Terminal className="h-7 w-7 text-white/10" />
          <span className="text-[11px] font-mono">No agent activity yet.</span>
        </div>
      )}

      {allEntries.map((entry, idx) => {
        if (entry.kind === "action") {
          const action = entry.item;
          const config = CATEGORY_CONFIG[action.type];
          const Icon = config.icon;
          const isExpanded = expandedIds.has(action.id);
          const isActive = action.status === "running" || action.status === "pending";

          return (
            <motion.div
              key={`act-${idx}-${action.id}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.3) }}
              className={`flex flex-col border-b border-white/[0.02] transition-colors hover:bg-white/[0.01] ${
                isActive ? "bg-white/[0.015]" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => toggleExpanded(action.id)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left"
              >
                <div className="relative z-10 mt-0.5 flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                  {isActive ? (
                    <div
                      className="h-[9px] w-[9px] rounded-full animate-pulse"
                      style={{
                        backgroundColor: config.color,
                        boxShadow: `0 0 8px ${config.color}60`,
                      }}
                    />
                  ) : (
                    <div
                      className="h-[7px] w-[7px] rounded-full"
                      style={{
                        backgroundColor: config.color,
                        boxShadow: `0 0 5px ${config.color}40`,
                      }}
                    />
                  )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: isActive ? `${config.color}cc` : "rgba(255,255,255,0.7)" }}
                    >
                      {action.label}
                    </span>
                    {action.context && (
                      <span className="truncate text-[10px] text-white/30 font-mono">
                        {action.type === "command" && action.command ? (
                          <TerminalCommand command={action.command} />
                        ) : action.type === "search" && action.searchQuery ? (
                          <SearchQueryBadge query={action.searchQuery} />
                        ) : action.type.startsWith("file_") && action.filePath ? (
                          <FilePathBadge
                            path={action.filePath}
                            operation={
                              action.type === "file_create"
                                ? "create"
                                : action.type === "file_read"
                                  ? "read"
                                  : action.type === "file_write"
                                    ? "write"
                                    : "edit"
                            }
                          />
                        ) : (
                          action.context
                        )}
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
                    {isActive && (
                      <span className="text-[10px] font-mono animate-pulse" style={{ color: config.color }}>
                        RUNNING
                      </span>
                    )}
                    {action.status === "failed" && (
                      <span className="text-[10px] font-mono text-red-400/60">FAILED</span>
                    )}
                    <StatusIcon status={action.status} />
                  </div>
                </div>

                <div className="mt-0.5 shrink-0">
                  <ChevronRight
                    className={`h-3 w-3 text-white/15 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`}
                  />
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-2 pl-[33px]">
                      <div
                        className="rounded-md border border-white/[0.04] px-3 py-2.5 text-[11px] leading-relaxed"
                        style={{ backgroundColor: config.bg }}
                      >
                        <div className="mb-1.5 flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5" style={{ color: config.color }} />
                          <span
                            className="text-[10px] font-medium uppercase tracking-wider"
                            style={{ color: config.color }}
                          >
                            {action.label}
                          </span>
                          <span className="text-[10px] font-mono text-white/20">#{action.id}</span>
                        </div>

                        {action.command && (
                          <div className="mb-1">
                            <TerminalCommand command={action.command} />
                          </div>
                        )}
                        {action.filePath && (
                          <div className="mb-1">
                            <FilePathBadge
                              path={action.filePath}
                              operation={
                                action.type === "file_create"
                                  ? "create"
                                  : action.type === "file_read"
                                    ? "read"
                                    : action.type === "file_write"
                                      ? "write"
                                      : "edit"
                              }
                            />
                          </div>
                        )}
                        {action.searchQuery && (
                          <div className="mb-1">
                            <SearchQueryBadge query={action.searchQuery} />
                          </div>
                        )}

                        <p className="whitespace-pre-wrap text-white/60">{action.text}</p>
                        {action.detail && (
                          <div className="mt-2 overflow-x-auto rounded bg-black/30 px-2 py-1.5 font-mono text-[10px] text-white/30">
                            {action.detail}
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        }

        if (entry.kind === "tool") {
          const tool = entry.item;
          return (
            <motion.div
              key={`tool-${idx}-${tool.id}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: Math.min(idx * 0.03, 0.3) }}
              className="flex items-start gap-2.5 border-b border-white/[0.02] px-3 py-2 hover:bg-white/[0.01]"
            >
              <div className="relative z-10 mt-0.5 flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                <div
                  className="h-[7px] w-[7px] rounded-full"
                  style={{
                    backgroundColor:
                      tool.status === "success" ? "#34d399" : tool.status === "error" ? "#f87171" : "#fbbf24",
                    boxShadow:
                      tool.status === "success"
                        ? "0 0 5px #34d39940"
                        : tool.status === "error"
                          ? "0 0 5px #f8717140"
                          : "0 0 5px #fbbf2440",
                  }}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[11px] font-medium text-white/50">{tool.tool}</span>
                {tool.output && (
                  <span className="truncate text-[10px] text-white/20">{tool.output}</span>
                )}
              </div>
              <span className="text-[10px] font-mono text-white/15">{tool.durationMs}ms</span>
            </motion.div>
          );
        }

        if (entry.kind === "live") {
          return (
            <motion.div
              key={`live-${idx}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-start gap-2.5 border-b border-white/[0.02] bg-amber-400/[0.02] px-3 py-2"
            >
              <div className="relative z-10 mt-0.5 flex h-[14px] w-[14px] shrink-0 items-center justify-center">
                <div className="flex items-center gap-[2px]">
                  <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse" />
                  <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: "150ms" }} />
                  <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[11px] font-medium text-white/60">{entry.step}</span>
                <span className="text-[10px] text-white/30 font-mono">
                  {typedThinkingText}
                  {isTyping && (
                    <span className="inline-block h-3 w-1 bg-amber-400/60 animate-pulse ml-0.5" />
                  )}
                </span>
              </div>
              <span className="text-[10px] font-mono text-amber-400/40">LIVE</span>
            </motion.div>
          );
        }

        return null;
      })}

      <AnimatePresence>
        {showJumpButton && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            type="button"
            onClick={jumpToBottom}
            className="sticky bottom-2 z-30 mx-auto flex items-center gap-1.5 rounded-full bg-[#0a0a0a]/90 border border-white/[0.08] px-3 py-1.5 text-[10px] font-mono text-white/60 shadow-lg backdrop-blur-sm hover:bg-white/[0.04] hover:text-white/80 transition-colors"
          >
            <ArrowDownToLine className="h-3 w-3" />
            Jump to live
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
