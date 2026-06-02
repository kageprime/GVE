import { AlertTriangle, CheckCircle2, AlertCircle, Shield, ChevronDown, ChevronUp } from "lucide-react";
import type { ValidationToolResult } from "../../../stores/chat/types";

interface ValidationReportCardProps {
  data: ValidationToolResult;
}

function ScoreRing({ score }: { score: number }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? "#34d399" : score >= 60 ? "#fbbf24" : score >= 40 ? "#fb923c" : "#f87171";

  return (
    <div className="relative flex h-11 w-11 items-center justify-center shrink-0">
      <svg className="h-11 w-11 -rotate-90" viewBox="0 0 44 44">
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="3"
        />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
      </svg>
      <span className="absolute text-[10px] font-mono font-bold" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

export function ValidationReportCard({ data }: ValidationReportCardProps) {
  const hasErrors = data.errors.length > 0;
  const hasWarnings = data.warnings.length > 0;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Header with score */}
      <div className="flex items-center gap-3">
        <ScoreRing score={data.score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-white/30" />
            <span className="text-[11px] text-white/50 font-medium">Validation Report</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {hasErrors ? (
              <span className="flex items-center gap-1 text-[10px] text-red-300/50">
                <AlertTriangle className="h-2.5 w-2.5" />
                {data.errors.length} error{data.errors.length !== 1 ? "s" : ""}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-[10px] text-emerald-300/50">
                <CheckCircle2 className="h-2.5 w-2.5" />
                No errors
              </span>
            )}
            {hasWarnings && (
              <span className="flex items-center gap-1 text-[10px] text-amber-300/50">
                <AlertCircle className="h-2.5 w-2.5" />
                {data.warnings.length} warning{data.warnings.length !== 1 ? "s" : ""}
              </span>
            )}
            {data.canRetry && (
              <span className="text-[10px] text-orange-300/40">· Auto-fix enabled</span>
            )}
          </div>
        </div>
      </div>

      {/* Errors */}
      {hasErrors && (
        <div className="flex flex-col gap-1">
          {data.errors.map((err, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded-lg border border-red-400/[0.06] bg-red-400/[0.02] px-2 py-1.5"
            >
              <AlertTriangle className="h-3 w-3 text-red-400/40 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-red-300/50 leading-relaxed">{err.message}</p>
                {err.line && (
                  <span className="text-[9px] text-white/15 font-mono mt-0.5">Line {err.line}</span>
                )}
                {err.code && (
                  <span className="text-[9px] text-white/15 font-mono ml-1.5">{err.code}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <div className="flex flex-col gap-1">
          {data.warnings.map((warn, i) => (
            <div
              key={i}
              className="flex items-start gap-1.5 rounded-lg border border-amber-400/[0.06] bg-amber-400/[0.02] px-2 py-1.5"
            >
              <AlertCircle className="h-3 w-3 text-amber-400/40 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-amber-300/50 leading-relaxed">{warn.message}</p>
                {warn.line && (
                  <span className="text-[9px] text-white/15 font-mono mt-0.5">Line {warn.line}</span>
                )}
                {warn.code && (
                  <span className="text-[9px] text-white/15 font-mono ml-1.5">{warn.code}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
