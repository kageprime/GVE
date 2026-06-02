import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronDown } from "lucide-react";
import type { ThoughtItem } from "./MessageComponents";
import type { AgentToolLogEntry } from "../../stores/chat/types";
import { useChatStore } from "../../stores";
import {
  PhasePill,
  derivePhase,
  PHASE_CONFIG,
  buildAgentActions,
  groupActionsIntoPhases,
  type AgentPhase,
} from "./AgentActionStream";
import { AgentTimeline } from "./AgentTimeline";

interface AgentDeckInlineProps {
  thoughts: ThoughtItem[];
  isRunning?: boolean;
}

export function AgentDeckInline({ thoughts, isRunning = false }: AgentDeckInlineProps) {
  const agentToolLog = useChatStore((state) => state.agentToolLog);
  const thinkingText = useChatStore((state) => state.thinkingText);
  const thinkingStep = useChatStore((state) => state.thinkingStep);

  const [expanded, setExpanded] = useState(false);
  const [focusedPhase, setFocusedPhase] = useState<AgentPhase | null>(null);

  const actions = useMemo(() => buildAgentActions(thoughts), [thoughts]);
  const phases = useMemo(() => groupActionsIntoPhases(actions, thoughts), [actions, thoughts]);

  const filteredThoughts = useMemo(() => {
    if (!focusedPhase) return thoughts;
    return thoughts.filter(
      (thought) => derivePhase(thought.step, thought.toolName) === focusedPhase
    );
  }, [thoughts, focusedPhase]);

  const handlePhaseClick = useCallback(
    (phaseId: AgentPhase) => {
      if (focusedPhase === phaseId && expanded) {
        setExpanded(false);
        setFocusedPhase(null);
      } else {
        setFocusedPhase(phaseId);
        setExpanded(true);
      }
    },
    [focusedPhase, expanded]
  );

  const handleClose = useCallback(() => {
    setExpanded(false);
    setFocusedPhase(null);
  }, []);

  if (thoughts.length === 0 && !isRunning) return null;

  return (
    <div className="my-2 select-none">
      <div className="flex flex-wrap items-center gap-1.5">
        {phases.map((phaseGroup) => (
          <PhasePill
            key={phaseGroup.phase}
            phase={phaseGroup.phase}
            status={phaseGroup.status}
            isActive={phaseGroup.phase === focusedPhase}
            actionCount={phaseGroup.actions.length}
            onClick={() => handlePhaseClick(phaseGroup.phase)}
          />
        ))}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="mt-2 overflow-hidden"
          >
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.01]">
              <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.04]">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-medium uppercase tracking-wider"
                    style={{ color: focusedPhase ? PHASE_CONFIG[focusedPhase]?.color ?? "#9ca3af" : "#9ca3af", opacity: 0.7 }}
                  >
                    {focusedPhase ? PHASE_CONFIG[focusedPhase]?.label ?? "Timeline" : "Timeline"}
                  </span>
                  <ChevronDown className="h-3 w-3 text-white/20" />
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex items-center justify-center h-5 w-5 rounded-md text-white/30 hover:text-white/60 hover:bg-white/[0.04] transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              <div className="max-h-[320px]">
                <AgentTimeline
                  thoughts={filteredThoughts}
                  toolLog={agentToolLog}
                  isRunning={isRunning}
                  thinkingText={thinkingText}
                  thinkingStep={thinkingStep}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
