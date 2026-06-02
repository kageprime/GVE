import type { SessionMessage } from "../../stores";
import type { ThoughtItem, DisplayMessage, SceneVersionRecord } from "./chatTypes";

const RUNTIME_DIAGNOSTIC_PATTERNS = [
  "Generated through LangGraph",
  "orchestration pipeline",
  "local fallback pipeline",
  "Runtime: degraded",
  "Runtime recovery skipped",
  "sandbox provisioning constraints",
  "Runtime execution timed out",
  "Generated via",
  "Failure details:"
];

function looksLikeRuntimeDiagnostic(content: string): boolean {
  const normalized = String(content ?? "").trim();
  if (!normalized) {
    return false;
  }

  if (/\b(generated scene code|live preview|media preview|re-run this scene|preview is running in degraded mode)\b/i.test(normalized)) {
    return false;
  }

  const matchCount = RUNTIME_DIAGNOSTIC_PATTERNS.reduce(
    (count, pattern) => (normalized.includes(pattern) ? count + 1 : count),
    0
  );

  if (matchCount >= 2) {
    return true;
  }

  if (/^failure details:/i.test(normalized) || /^runtime recovery skipped/i.test(normalized)) {
    return true;
  }

  return false;
}

function buildAnimationDescription(promptContext: string | undefined, sceneId: string | undefined): string {
  const prompt = String(promptContext ?? "").trim().replace(/\s+/g, " ");
  if (prompt.length > 0) {
    const normalized = prompt.replace(/[.?!]+$/, "");
    return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}.`;
  }

  if (sceneId) {
    return `Generated animation scene ${sceneId}.`;
  }

  return "Generated animation scene.";
}

export function getAssistantDisplayContent(
  content: string,
  promptContext: string | undefined,
  sceneId: string | undefined
): string {
  if (!looksLikeRuntimeDiagnostic(content)) {
    return content;
  }

  return buildAnimationDescription(promptContext, sceneId);
}

export function getMetaValue(meta: string[] | undefined, prefix: string): string | null {
  if (!Array.isArray(meta)) {
    return null;
  }

  const matched = meta.find((entry) => entry.startsWith(prefix));
  if (!matched) {
    return null;
  }

  const parsed = matched.slice(prefix.length).trim();
  return parsed || null;
}

export function hasMetaFlag(meta: string[] | undefined, value: string): boolean {
  return Array.isArray(meta) && meta.includes(value);
}

function toThought(message: SessionMessage): ThoughtItem {
  return {
    text: message.content,
    step: message.meta?.[0] ?? message.kind ?? "thought",
    timestamp: Date.parse(message.createdAt),
    meta: message.meta,
    toolName: getMetaValue(message.meta, "toolName:") ?? getMetaValue(message.meta, "tool:") ?? null,
  };
}

function isTrivialThought(thought: ThoughtItem): boolean {
  const step = thought.step;
  if (step !== "turn_started" && step !== "turn_complete") return false;
  const hasDetail = thought.meta?.some((m) => m.startsWith("detail:")) ?? false;
  const hasStepLabel = thought.meta?.some((m) => m.startsWith("stepLabel:")) ?? false;
  return !hasDetail && !hasStepLabel;
}

export function buildDisplayMessages(messages: SessionMessage[]): DisplayMessage[] {
  const displayMessages: DisplayMessage[] = [];
  const assistantIndexByMessageId = new Map<string, number>();
  const assistantIndexByRequestId = new Map<string, number>();
  const deferredThoughtsByMessageId = new Map<string, ThoughtItem[]>();
  const deferredThoughtsByRequestId = new Map<string, ThoughtItem[]>();
  const orphanThoughts: ThoughtItem[] = [];
  let fallbackAssistantIndex: number | null = null;
  let latestUserPrompt: string | undefined;

  const pushDeferredThought = (bucket: Map<string, ThoughtItem[]>, key: string, thought: ThoughtItem) => {
    const existing = bucket.get(key);
    if (existing) {
      const isDuplicate = existing.some(
        (t) => t.step === thought.step && t.text === thought.text
      );
      if (!isDuplicate) {
        existing.push(thought);
      }
      return;
    }
    bucket.set(key, [thought]);
  };

  const attachThought = (index: number | null, thought: ThoughtItem): boolean => {
    if (index === null || index < 0 || index >= displayMessages.length) {
      return false;
    }
    const existing = displayMessages[index].thoughts;
    const isDuplicate = existing.some(
      (t) => t.step === thought.step && t.text === thought.text
    );
    if (isDuplicate) {
      return true;
    }
    displayMessages[index].thoughts.push(thought);
    return true;
  };

  const attachDeferredToAssistant = (index: number, messageId: string, requestId: string | null) => {
    const deferredByMessage = deferredThoughtsByMessageId.get(messageId);
    if (deferredByMessage?.length) {
      for (const thought of deferredByMessage) {
        const isDuplicate = displayMessages[index].thoughts.some(
          (t) => t.step === thought.step && t.text === thought.text
        );
        if (!isDuplicate) {
          displayMessages[index].thoughts.push(thought);
        }
      }
      deferredThoughtsByMessageId.delete(messageId);
    }

    if (requestId) {
      const deferredByRequest = deferredThoughtsByRequestId.get(requestId);
      if (deferredByRequest?.length) {
        for (const thought of deferredByRequest) {
          const isDuplicate = displayMessages[index].thoughts.some(
            (t) => t.step === thought.step && t.text === thought.text
          );
          if (!isDuplicate) {
            displayMessages[index].thoughts.push(thought);
          }
        }
        deferredThoughtsByRequestId.delete(requestId);
      }
    }

    if (orphanThoughts.length > 0) {
      for (const thought of orphanThoughts) {
        const isDuplicate = displayMessages[index].thoughts.some(
          (t) => t.step === thought.step && t.text === thought.text
        );
        if (!isDuplicate) {
          displayMessages[index].thoughts.push(thought);
        }
      }
      orphanThoughts.length = 0;
    }
  };

  for (const message of messages) {
    if (message.role === "thought" || message.kind === "thought") {
      const thought = toThought(message);
      // Skip pure lifecycle thoughts (turn_started/turn_complete with no detail).
      // These add noise for simple chat responses where no agent work happened.
      if (isTrivialThought(thought)) continue;

      const thoughtMessageId = getMetaValue(message.meta, "messageId:");
      const thoughtRequestId = getMetaValue(message.meta, "requestId:");

      if (thoughtMessageId && assistantIndexByMessageId.has(thoughtMessageId)) {
        attachThought(assistantIndexByMessageId.get(thoughtMessageId) ?? null, thought);
        continue;
      }

      if (thoughtRequestId && assistantIndexByRequestId.has(thoughtRequestId)) {
        attachThought(assistantIndexByRequestId.get(thoughtRequestId) ?? null, thought);
        continue;
      }

      if (thoughtMessageId) {
        pushDeferredThought(deferredThoughtsByMessageId, thoughtMessageId, thought);
        continue;
      }

      if (thoughtRequestId) {
        pushDeferredThought(deferredThoughtsByRequestId, thoughtRequestId, thought);
        continue;
      }

      if (attachThought(fallbackAssistantIndex, thought)) {
        continue;
      }

      orphanThoughts.push(thought);
      continue;
    }

    const sceneId = getMetaValue(message.meta, "scene:") ?? undefined;
    const requestId = getMetaValue(message.meta, "requestId:");
    const skill = getMetaValue(message.meta, "skill:") ?? undefined;
    const assistantSource = (
      getMetaValue(message.meta, "assistantSource:")
      ?? getMetaValue(message.meta, "source:")
      ?? undefined
    );
    const assistantWarning = hasMetaFlag(message.meta, "assistantWarning:true");
    const errorCode = getMetaValue(message.meta, "error:") ?? undefined;

    if (message.role === "user") {
      const prompt = String(message.content ?? "").trim();
      if (prompt) {
        latestUserPrompt = prompt;
      }
    }

    // Display deduplication safety net: skip exact duplicate messages within 30s
    // OR messages sharing the same requestId (catches cross-ID duplicates).
    const isDuplicate = displayMessages.some((dm) => {
      if (dm.message.role !== message.role) return false;
      if (dm.message.content !== message.content) return false;
      const timeDiff = Math.abs(Date.parse(dm.message.createdAt) - Date.parse(message.createdAt));
      if (timeDiff < 30_000) return true;
      // Also deduplicate if both messages share the same requestId meta tag
      const dmRequestId = getMetaValue(dm.message.meta, "requestId:");
      return Boolean(dmRequestId && dmRequestId === requestId);
    });
    if (isDuplicate) continue;

    displayMessages.push({
      message,
      thoughts: [],
      sceneId,
      promptContext: message.role === "assistant" ? latestUserPrompt : undefined,
      skill,
      assistantSource,
      assistantWarning,
      errorCode
    });

    const currentIndex = displayMessages.length - 1;

    if (message.role === "assistant") {
      assistantIndexByMessageId.set(message.id, currentIndex);
      if (requestId) {
        assistantIndexByRequestId.set(requestId, currentIndex);
      }

      attachDeferredToAssistant(currentIndex, message.id, requestId);
      fallbackAssistantIndex = currentIndex;
      continue;
    }

    if (message.role === "user") {
      fallbackAssistantIndex = null;
    }
  }

  const unmatchedGroups: ThoughtItem[][] = [
    ...Array.from(deferredThoughtsByMessageId.values()),
    ...Array.from(deferredThoughtsByRequestId.values()),
    orphanThoughts.length > 0 ? orphanThoughts : []
  ].filter(group => group.length > 0);

  for (const group of unmatchedGroups) {
    group.sort((a, b) => a.timestamp - b.timestamp);
    const lastTimestamp = group[group.length - 1].timestamp;

    displayMessages.push({
      message: {
        id: `synthetic-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: "",
        kind: "message",
        createdAt: new Date(lastTimestamp).toISOString(),
        updatedAt: new Date(lastTimestamp).toISOString(),
        meta: ["synthetic:true"]
      },
      thoughts: [...group],
      promptContext: undefined
    });
  }

  displayMessages.sort((a, b) => Date.parse(a.message.createdAt) - Date.parse(b.message.createdAt));

  return displayMessages;
}

export function buildMessageVersionMap(sceneVersions: SceneVersionRecord[]): Map<string, SceneVersionRecord> {
  const versionsByMessageId = new Map<string, SceneVersionRecord>();

  for (const version of sceneVersions) {
    const messageId = typeof version.messageId === "string" ? version.messageId.trim() : "";
    if (!messageId) {
      continue;
    }

    versionsByMessageId.set(messageId, version);
  }

  return versionsByMessageId;
}

export function buildMessageVersionListMap(sceneVersions: SceneVersionRecord[]): Map<string, SceneVersionRecord[]> {
  const versionsByMessageId = new Map<string, SceneVersionRecord[]>();

  for (const version of sceneVersions) {
    const messageId = typeof version.messageId === "string" ? version.messageId.trim() : "";
    if (!messageId) {
      continue;
    }

    const existing = versionsByMessageId.get(messageId);
    if (existing) {
      existing.push(version);
      continue;
    }

    versionsByMessageId.set(messageId, [version]);
  }

  for (const versions of versionsByMessageId.values()) {
    versions.sort((left, right) => {
      const leftVersion = Number(left.version ?? 0);
      const rightVersion = Number(right.version ?? 0);
      if (leftVersion !== rightVersion) {
        return rightVersion - leftVersion;
      }

      const leftUpdatedAt = Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0;
      const rightUpdatedAt = Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0;
      return rightUpdatedAt - leftUpdatedAt;
    });
  }

  return versionsByMessageId;
}

export function buildUniqueSceneIdVersionMap(sceneVersions: SceneVersionRecord[]): Map<string, SceneVersionRecord> {
  const versionsBySceneId = new Map<string, SceneVersionRecord[]>();

  for (const version of sceneVersions) {
    const sceneId = typeof version.sceneId === "string" ? version.sceneId.trim() : "";
    if (!sceneId) {
      continue;
    }

    const existing = versionsBySceneId.get(sceneId);
    if (existing) {
      existing.push(version);
      continue;
    }

    versionsBySceneId.set(sceneId, [version]);
  }

  const uniqueBySceneId = new Map<string, SceneVersionRecord>();

  for (const [sceneId, versions] of versionsBySceneId.entries()) {
    if (versions.length === 1) {
      uniqueBySceneId.set(sceneId, versions[0]);
    }
  }

  return uniqueBySceneId;
}
