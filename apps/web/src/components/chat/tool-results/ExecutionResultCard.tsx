import { useState } from "react";
import { Play, XCircle, Clock, Terminal, ImageIcon, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import type { ExecutionToolResult } from "../../../stores/chat/types";

interface ExecutionResultCardProps {
  data: ExecutionToolResult;
}

export function ExecutionResultCard({ data }: ExecutionResultCardProps) {
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className={`flex h-5 w-5 items-center justify-center rounded ${data.success ? "bg-emerald-400/8" : "bg-red-400/8"}`}>
          {data.success ? (
            <Play className="h-3 w-3 text-emerald-400/60" />
          ) : (
            <XCircle className="h-3 w-3 text-red-400/60" />
          )}
        </div>
        <span className="text-[11px] text-white/50 font-medium">
          {data.success ? "Execution Complete" : "Execution Failed"}
        </span>
        {data.durationMs != null && data.durationMs > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-white/20 font-mono ml-auto">
            <Clock className="h-2.5 w-2.5" />
            {(data.durationMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>

      {/* Preview */}
      {data.previewUrl && (
        <a
          href={data.previewUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="group relative flex items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.01] aspect-video overflow-hidden hover:border-white/[0.10] transition-colors"
        >
          <ImageIcon className="h-6 w-6 text-white/10" />
          <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-white/40 backdrop-blur-sm">
            <ExternalLink className="h-2.5 w-2.5" />
            Preview
          </div>
        </a>
      )}

      {/* Media */}
      {data.mediaUrl && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] overflow-hidden">
          <video
            src={data.mediaUrl}
            controls
            className="w-full aspect-video"
            preload="metadata"
          />
        </div>
      )}

      {/* Error */}
      {!data.success && data.error && (
        <div className="rounded-lg border border-red-400/[0.08] bg-red-400/[0.03] px-3 py-2">
          <p className="text-[11px] text-red-300/50 font-mono leading-relaxed whitespace-pre-wrap">{data.error}</p>
        </div>
      )}

      {/* Logs */}
      {data.logs && data.logs.length > 0 && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1 self-start rounded-md px-1.5 py-0.5 text-[10px] text-white/30 hover:text-white/50 hover:bg-white/[0.03] transition-colors"
          >
            <Terminal className="h-2.5 w-2.5" />
            {showLogs ? (
              <>
                <ChevronUp className="h-3 w-3" /> Hide logs ({data.logs.length})
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3" /> Show logs ({data.logs.length})
              </>
            )}
          </button>
          {showLogs && (
            <div className="rounded-lg border border-white/[0.04] bg-black/60 p-2.5 max-h-48 overflow-y-auto">
              {data.logs.map((log, i) => (
                <p key={i} className="text-[10px] text-white/30 font-mono leading-relaxed">
                  {log}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
