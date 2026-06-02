import { useState } from "react";
import { FileCode, Copy, Check, Code2, ChevronDown, ChevronUp } from "lucide-react";
import type { CodeToolResult } from "../../../stores/chat/types";

interface CodePreviewCardProps {
  data: CodeToolResult;
}

function getLanguageColor(lang: string): string {
  const colors: Record<string, string> = {
    threejs: "#38bdf8",
    p5js: "#f472b6",
    d3js: "#fb923c",
    animejs: "#a78bfa",
    javascript: "#f7df1e",
    typescript: "#3178c6",
  };
  return colors[lang] ?? "#9ca3af";
}

export function CodePreviewCard({ data }: CodePreviewCardProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const color = getLanguageColor(data.language);
  const displayCode = expanded ? data.snippet : data.snippet.slice(0, 600);
  const hasMore = data.snippet.length > 600;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-sky-400/8">
            <FileCode className="h-3 w-3 text-sky-400/60" />
          </div>
          <span className="text-[11px] text-white/50 font-medium">Generated Code</span>
          <span
            className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded"
            style={{ color, backgroundColor: `${color}15` }}
          >
            {data.language}
          </span>
          <span className="text-[10px] text-white/20 font-mono">{data.lines} lines</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/30 hover:text-white/50 hover:bg-white/[0.04] transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400/60" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Fix badge */}
      {data.isFix && (
        <div className="flex items-center gap-1.5 rounded-lg border border-orange-400/10 bg-orange-400/[0.03] px-2 py-1">
          <Code2 className="h-3 w-3 text-orange-400/50" />
          <span className="text-[10px] text-orange-300/60">Fix applied</span>
          {data.fixReason && (
            <span className="text-[9px] text-white/25 truncate ml-1">{data.fixReason.slice(0, 80)}</span>
          )}
        </div>
      )}

      {/* Code block */}
      <div className="relative rounded-xl border border-white/[0.04] bg-black/60 overflow-hidden">
        <pre className="p-3 overflow-x-auto text-[11px] font-mono leading-relaxed">
          <code className="text-white/60 whitespace-pre">{displayCode}</code>
        </pre>
        {hasMore && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-black/80 to-transparent pointer-events-none" />
        )}
      </div>

      {/* Expand / Collapse */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="self-center flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 text-[10px] text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-all"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Collapse
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show full ({data.snippet.length} chars)
            </>
          )}
        </button>
      )}
    </div>
  );
}
