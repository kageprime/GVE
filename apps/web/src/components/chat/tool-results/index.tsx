import type { ToolRawResult } from "../../../stores/chat/types";
import { SearchResultCard } from "./SearchResultCard";
import { FilePlanCard } from "./FilePlanCard";
import { CodePreviewCard } from "./CodePreviewCard";
import { ValidationReportCard } from "./ValidationReportCard";
import { ExecutionResultCard } from "./ExecutionResultCard";

interface ToolResultCardProps {
  rawResult: ToolRawResult;
  compact?: boolean;
}

export function ToolResultCard({ rawResult, compact = false }: ToolResultCardProps) {
  switch (rawResult.type) {
    case "search":
      return <SearchResultCard data={rawResult} compact={compact} />;
    case "plan":
      return <FilePlanCard data={rawResult} />;
    case "code":
      return <CodePreviewCard data={rawResult} />;
    case "validation":
      return <ValidationReportCard data={rawResult} />;
    case "execution":
      return <ExecutionResultCard data={rawResult} />;
    default:
      return null;
  }
}

export * from "./SearchResultCard";
export * from "./FilePlanCard";
export * from "./CodePreviewCard";
export * from "./ValidationReportCard";
export * from "./ExecutionResultCard";
