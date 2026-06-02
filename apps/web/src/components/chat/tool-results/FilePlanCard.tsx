import { FileCode, Folder, CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react";
import type { PlanToolResult } from "../../../stores/chat/types";

interface FilePlanCardProps {
  data: PlanToolResult;
}

export function FilePlanCard({ data }: FilePlanCardProps) {
  const tasks = data.tasks ?? [];
  const completed = tasks.filter(t => t.status === "completed").length;
  const pending = tasks.filter(t => t.status === "pending").length;
  const failed = tasks.filter(t => t.status === "failed").length;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-violet-400/8">
          <Folder className="h-3 w-3 text-violet-400/60" />
        </div>
        <span className="text-[11px] text-white/50 font-medium">Execution Plan</span>
        <span className="text-[10px] text-white/20 font-mono ml-auto">{data.skill} · {data.quality}</span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1 text-[10px] text-white/30">
          <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400/50" />
          {completed} done
        </span>
        {pending > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-white/30">
            <ArrowRight className="h-2.5 w-2.5 text-amber-400/50" />
            {pending} pending
          </span>
        )}
        {failed > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-white/30">
            <AlertTriangle className="h-2.5 w-2.5 text-red-400/50" />
            {failed} failed
          </span>
        )}
      </div>

      {/* Tasks */}
      <div className="flex flex-col gap-1">
        {tasks.map((task, i) => (
          <div
            key={task.id}
            className="flex items-center gap-2 rounded-lg border border-white/[0.02] bg-white/[0.01] px-2 py-1.5"
          >
            <div className="flex h-4 w-4 items-center justify-center shrink-0">
              {task.status === "completed" ? (
                <CheckCircle2 className="h-3 w-3 text-emerald-400/50" />
              ) : task.status === "failed" ? (
                <AlertTriangle className="h-3 w-3 text-red-400/50" />
              ) : (
                <ArrowRight className="h-3 w-3 text-white/15" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-white/50 font-medium truncate">{task.title}</span>
                <span className="text-[9px] text-white/15 font-mono uppercase">{task.agent}</span>
              </div>
              <p className="text-[10px] text-white/25 truncate">{task.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Fallback notice */}
      {data.fallback && (
        <div className="flex items-start gap-1.5 rounded-lg border border-amber-400/10 bg-amber-400/[0.03] px-2 py-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-400/50 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <span className="text-[10px] text-amber-300/50">Skill fallback:</span>
            <span className="text-[10px] text-white/40 ml-1">{data.fallback.from} → {data.fallback.to}</span>
            <p className="text-[9px] text-white/20 mt-0.5">{data.fallback.reason}</p>
          </div>
        </div>
      )}
    </div>
  );
}
