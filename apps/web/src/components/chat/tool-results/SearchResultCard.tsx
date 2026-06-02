import { useState } from "react";
import { Search, ExternalLink, Globe, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { SearchToolResult } from "../../../stores/chat/types";

interface SearchResultCardProps {
  data: SearchToolResult;
  compact?: boolean;
}

function getFavicon(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return "";
  }
}

function highlightQuery(text: string, query: string): string {
  if (!query || !text) return text;
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  let result = text;
  for (const term of terms) {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    result = result.replace(regex, "<mark class=\"bg-amber-400/20 text-amber-300 px-0.5 rounded\">$1</mark>");
  }
  return result;
}

function SearchResultItem({
  result,
  query,
  index,
}: {
  result: NonNullable<SearchToolResult["results"]>[number];
  query: string;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const favicon = getFavicon(result.url);
  const hostname = (() => {
    try {
      return new URL(result.url).hostname.replace(/^www\./, "");
    } catch {
      return result.url;
    }
  })();

  return (
    <div className="group flex gap-3 rounded-xl border border-white/[0.03] bg-white/[0.01] p-3 transition-all hover:bg-white/[0.03] hover:border-white/[0.06]">
      {/* Favicon / Thumbnail */}
      <div className="shrink-0 mt-0.5">
        {result.image ? (
          <img
            src={result.image}
            alt=""
            className="h-10 w-10 rounded-lg object-cover border border-white/[0.06]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03]">
            {favicon ? (
              <img src={favicon} alt="" className="h-5 w-5" loading="lazy" />
            ) : (
              <Globe className="h-4 w-4 text-white/20" />
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 text-[13px] font-medium text-sky-300/90 hover:text-sky-300 transition-colors truncate"
          >
            {result.title}
          </a>
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-white/15 hover:text-white/40 transition-colors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        <div className="flex items-center gap-1.5 mt-0.5">
          <span className="text-[10px] text-white/25 font-mono truncate">{hostname}</span>
          {result.score != null && (
            <span
              className={`shrink-0 inline-flex items-center rounded px-1 py-0 text-[9px] font-mono font-medium ${
                result.score >= 0.85
                  ? "bg-emerald-400/10 text-emerald-400/70"
                  : result.score >= 0.7
                  ? "bg-amber-400/10 text-amber-400/70"
                  : "bg-white/5 text-white/30"
              }`}
            >
              {Math.round((result.score ?? 0) * 100)}
            </span>
          )}
        </div>

        <div className="mt-1.5">
          <p
            className="text-[11.5px] text-white/40 leading-relaxed line-clamp-2"
            dangerouslySetInnerHTML={{
              __html: expanded
                ? highlightQuery(result.snippet, query)
                : highlightQuery(result.snippet.slice(0, 200), query),
            }}
          />
          {result.snippet.length > 200 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-1 flex items-center gap-0.5 text-[10px] text-white/25 hover:text-white/50 transition-colors"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> Less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> More
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchResultCard({ data, compact = false }: SearchResultCardProps) {
  const [showAll, setShowAll] = useState(false);
  const results = data.results ?? [];
  const visibleResults = compact && !showAll ? results.slice(0, 3) : results;
  const hasMore = compact && results.length > 3;

  return (
    <div className="flex flex-col gap-2">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-5 w-5 items-center justify-center rounded bg-amber-400/8">
          <Search className="h-3 w-3 text-amber-400/60" />
        </div>
        <span className="text-[11px] text-white/50 font-medium">
          Search — {results.length} result{results.length !== 1 ? "s" : ""}
        </span>
        <span className="text-[10px] text-white/20 font-mono truncate max-w-[180px]">
          "{data.query}"
        </span>
      </div>

      {/* AI Overview */}
      {data.answer && (
        <div className="rounded-xl border border-white/[0.04] bg-gradient-to-r from-amber-400/[0.03] to-transparent p-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="h-3 w-3 text-amber-400/50" />
            <span className="text-[10px] font-medium text-amber-400/50 uppercase tracking-wider">AI Overview</span>
          </div>
          <p className="text-[11.5px] text-white/55 leading-relaxed">{data.answer}</p>
        </div>
      )}

      {/* Results */}
      <div className="flex flex-col gap-1.5">
        {visibleResults.map((result, i) => (
          <SearchResultItem key={i} result={result} query={data.query} index={i} />
        ))}
      </div>

      {/* Show more */}
      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="self-center flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.02] px-3 py-1 text-[10px] text-white/40 hover:bg-white/[0.04] hover:text-white/60 transition-all"
        >
          {showAll ? (
            <>
              <ChevronUp className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show {results.length - 3} more
            </>
          )}
        </button>
      )}
    </div>
  );
}
