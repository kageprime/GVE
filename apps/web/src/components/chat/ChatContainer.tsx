import { useMemo, useRef, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { UserMessage, AIMessage, type ChatArtifactCard } from "./MessageComponents";
import { CinematicPlayer } from "./meta/CinematicPlayer";
import { Composer } from "./Composer";
import { useChatStore } from "../../stores";
import type { ThoughtItem, DisplayMessage, SceneVersionRecord } from "./chatTypes";
import { buildDisplayMessages, buildMessageVersionMap, buildMessageVersionListMap, buildUniqueSceneIdVersionMap, getMetaValue, hasMetaFlag, getAssistantDisplayContent } from "./chatHelpers";
import { useMessageSync, useSendMessage } from "../../hooks/queries";
import { createClientMessageId, dedupeMessages } from "../../stores/chat/helpers";
import { WelcomeScreen } from "./WelcomeScreen";


export function ChatContainer() {
  const chatRef = useRef<HTMLDivElement>(null);
  const isMetaVariant = true;
  const {
    sessions,
    activeSessionId,
    messages,
    taskProgressBySession,
    connectionState,
    sessionsError,
    isBootstrapping,
    isSending,
    agentFiles,
    agentToolLog,
    activeRequestId,
    thinkingText,
    thinkingStep,
    composerValue,
    composerImage,
    panelOpen,
    panelView,
    setComposerValue,
    setComposerImage,
    clearComposerImage,
    createNewSession: startDraftSession,
    stopTurn,
    openPanel,
    closePanel,
    openTheaterMode,
    activeArtifactId,
    pendingApproval,
    sendApprovalResponse,
  } = useChatStore();

  // Server-state hooks
  const sendMutation = useSendMessage();
  const { isFetching: messagesFetching } = useMessageSync(activeSessionId);

  // Safety: force isSending reset if a turn hangs so the UI never stays stuck.
  // Set to 120s to allow agent recovery + LLM debug sessions to complete.
  // Resets on each WebSocket activity so a long-running turn with events doesn't
  // get prematurely killed.
  const sendingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!isSending) {
      if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current);
      sendingTimeoutRef.current = null;
      return;
    }
    const startTimer = () => {
      if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current);
      sendingTimeoutRef.current = setTimeout(() => {
        useChatStore.getState().setIsSending(false);
        useChatStore.getState().setActiveRequestId(null);
        useChatStore.getState().setThinking(null, "turn_timeout");
      }, 120_000);
    };
    startTimer();
    return () => {
      if (sendingTimeoutRef.current) clearTimeout(sendingTimeoutRef.current);
    };
  }, [isSending, thinkingText, thinkingStep]);

  const createNewSession = async (initialPrompt?: string) => {
    try {
      const session = await startDraftSession();
      if (initialPrompt) {
        setComposerValue(initialPrompt);
        // Send the prompt immediately after creating the session so the user
        // doesn't have to press Enter again.
        if (!isPendingRef.current && !sendMutation.isPending) {
          isPendingRef.current = true;
          const requestId = `req-ws-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const clientMessageId = createClientMessageId("user");
          sendMutation.mutate({
            content: initialPrompt,
            mode: "generate",
            requestId,
            clientMessageId,
          }, {
            onSettled: () => {
              isPendingRef.current = false;
            }
          });
        }
      }
      return session;
    } catch (err) {
      console.error("Failed to create new session:", err);
      return null;
    }
  };

  const activeSession = (sessions || []).find(s => s?.sessionId === activeSessionId);
  const activeMessages = useMemo(
    () => (activeSessionId ? (messages[activeSessionId] ?? []) : []),
    [activeSessionId, messages]
  );
  const activeTaskProgress = activeSessionId ? taskProgressBySession[activeSessionId] ?? null : null;
  const isWorkspaceVisible = panelOpen && (panelView === "preview" || panelView === "code");

  const displayMessages = useMemo(() => {
    const built = buildDisplayMessages(dedupeMessages(activeMessages));
    // Attach live agent-mode files + tool log to the last assistant message when streaming
    if (isSending && (agentFiles.length > 0 || agentToolLog.length > 0)) {
      for (let i = built.length - 1; i >= 0; i--) {
        if (built[i]!.message.role === "assistant") {
          built[i] = { ...built[i]!, agentFiles, agentToolLog };
          break;
        }
      }
    }
    return built;
  }, [activeMessages, isSending, agentFiles, agentToolLog]);
  const sceneVersions = useMemo(
    () => (activeSession?.sceneVersions ?? []).filter((version): version is SceneVersionRecord => {
      return Boolean(version && typeof version.versionId === "string");
    }),
    [activeSession?.sceneVersions]
  );
  const versionsByMessageId = useMemo(
    () => buildMessageVersionMap(sceneVersions),
    [sceneVersions]
  );
  const versionsListByMessageId = useMemo(
    () => buildMessageVersionListMap(sceneVersions),
    [sceneVersions]
  );
  const uniqueVersionsBySceneId = useMemo(
    () => buildUniqueSceneIdVersionMap(sceneVersions),
    [sceneVersions]
  );

  // Show inline thinking bubble when agent is active.
  // - If the last message is already from the assistant AND belongs to the current request: attach thought to it
  // - If last message is from user or chat is empty: render a standalone thinking bubble
  const lastDisplayMsg = displayMessages[displayMessages.length - 1];
  const lastMsgIsAssistant = lastDisplayMsg?.message.role === "assistant";
  const lastMsgRequestId = lastMsgIsAssistant ? getMetaValue(lastDisplayMsg?.message.meta, "requestId:") : null;
  const lastMsgIsSynthetic = lastMsgIsAssistant && hasMetaFlag(lastDisplayMsg?.message.meta, "synthetic:true");
  const lastMsgBelongsToCurrentTurn = Boolean(lastMsgRequestId && activeRequestId && lastMsgRequestId === activeRequestId) || lastMsgIsSynthetic;
  const lastAssistantIsThinking = isSending && lastMsgBelongsToCurrentTurn;

  // Calculate thinking duration from thoughts
  const getThinkingDuration = useCallback((thoughts: ThoughtItem[]) => {
    if (thoughts.length < 2) return 0;
    const first = thoughts[0]?.timestamp ?? 0;
    const last = thoughts[thoughts.length - 1]?.timestamp ?? 0;
    return last - first;
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    const container = chatRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldStickToBottom = distanceFromBottom < 120;

    if (shouldStickToBottom) {
      container.scrollTop = container.scrollHeight;
    }
  }, [displayMessages, thinkingText]);

  // No panel auto-open; inline artifact cards within messages handle preview display

  // Mutation lock to prevent double-submit under React StrictMode or rapid clicks.
  const isPendingRef = useRef(false);

  const handleSend = async () => {
    if (!composerValue.trim() && !composerImage) return;
    if (isPendingRef.current || sendMutation.isPending) return;
    isPendingRef.current = true;

    // If no active session (e.g. welcome screen), create one first
    if (!activeSessionId) {
      await createNewSession();
      // activeSessionId is now set in Zustand; mutationFn will read it
    }
    const requestId = `req-ws-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const clientMessageId = createClientMessageId("user");
    sendMutation.mutate({
      content: composerValue,
      mode: "generate",
      imageUrl: composerImage?.previewUrl,
      imageData: composerImage?.dataBase64,
      requestId,
      clientMessageId,
    }, {
      onSettled: () => {
        isPendingRef.current = false;
      }
    });
  };

  const handleStop = () => {
    stopTurn();
  };

  const handleMessageSceneAction = async (action: 'code' | 'preview', versionId: string) => {
    const normalizedVersionId = String(versionId ?? '').trim();
    if (!normalizedVersionId) {
      return;
    }

    const currentVersionId = activeSession?.currentScene?.versionId ?? null;
    const isAlreadyActive = isWorkspaceVisible && panelView === action && currentVersionId === normalizedVersionId;

    if (isAlreadyActive) {
      closePanel();
      return;
    }

    if (action === 'preview') {
      openTheaterMode(normalizedVersionId);
    } else {
      openPanel(action);
    }
  };



  // Split view functionality removed
  const debugLayout =
    typeof window !== "undefined"
    && new URLSearchParams(window.location.search).get("chatDebug") === "1";

  const providers = useChatStore((state) => state.providers);
  const activeProviderId = useChatStore((state) => state.activeProviderId);
  const setActiveProvider = useChatStore((state) => state.setActiveProvider);

  return (
    <>
      {/* LEFT AGENT */}
      <aside
        className={`relative z-20 flex h-full min-h-0 w-full min-w-0 flex-1 flex-col p-0 transition-all duration-300 ease-out ${debugLayout ? "outline outline-2 outline-fuchsia-500/70" : ""}`}
      >
        <div className={`relative flex h-full min-h-0 flex-1 overflow-hidden rounded-none bg-transparent shadow-none ${debugLayout ? "outline outline-2 outline-cyan-400/70" : ""}`}>
          <div className="relative z-10 flex h-full w-full flex-1 flex-col pt-0">
            {sessionsError && (
              <div className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 lg:mx-auto lg:max-w-3xl">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-red-400">
                  <circle cx="12" cy="12" r="10" /><line x1="12" x2="12" y1="8" y2="12" /><line x1="12" x2="12.01" y1="16" y2="16" />
                </svg>
                <span className="flex-1">{sessionsError}</span>
                <button
                  type="button"
                  onClick={() => useChatStore.setState({ sessionsError: null })}
                  className="shrink-0 rounded p-1 text-red-400 transition hover:bg-red-500/20 hover:text-red-200"
                  aria-label="Dismiss error"
                  title="Dismiss"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </div>
            )}

            {/* Messages */}
            <div
              className="flex min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto scroll-smooth scrollbar px-0 py-0"
              ref={chatRef}
            >
          <div className={`flex w-full flex-col gap-4 px-3 py-3 lg:gap-5 lg:py-8 ${activeSession ? 'max-w-3xl mx-auto' : 'items-center justify-center min-h-full'}`}>
            {!activeSession ? (
              <WelcomeScreen
                isBootstrapping={isBootstrapping}
                error={sessionsError}
                onCreate={createNewSession}
              />
            ) : (
              <>
                <div className="flex-1 min-h-[40px]" />
                {messagesFetching && displayMessages.length === 0 && (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-white/30" />
                    <span className="text-[13px] text-white/40">Loading conversation...</span>
                  </div>
                )}
          {displayMessages.map(({ message, thoughts, sceneId, promptContext, skill, assistantSource, assistantWarning, errorCode, agentFiles: msgAgentFiles, agentToolLog: msgAgentToolLog }, index) => {
            const isLast = index === displayMessages.length - 1;
            const isLatest = isLast;
            const thinkingDuration = getThinkingDuration(thoughts);
            const matchedVersion = message.role === 'assistant'
              ? (versionsByMessageId.get(message.id)
                ?? (sceneId ? uniqueVersionsBySceneId.get(sceneId) : undefined)
                ?? undefined)
              : undefined;
            const isLiveStreaming = isLast && lastAssistantIsThinking && !message.content;
            const liveScene = (isLiveStreaming || isLast) ? activeSession?.currentScene : null;
            const resolvedSceneId = matchedVersion?.sceneId ?? sceneId ?? liveScene?.sceneId;
            const resolvedVersionId = matchedVersion?.versionId ?? liveScene?.versionId ?? null;
            const isPreviewActive = Boolean(
              isWorkspaceVisible
              && panelView === 'preview'
              && resolvedVersionId
              && activeSession?.currentScene?.versionId === resolvedVersionId
            );
            const isCodeActive = Boolean(
              isWorkspaceVisible
              && panelView === 'code'
              && resolvedVersionId
              && activeSession?.currentScene?.versionId === resolvedVersionId
            );

            const messageVersionCandidates = message.role === 'assistant'
              ? (versionsListByMessageId.get(message.id)
                ?? (resolvedSceneId
                  ? sceneVersions.filter((version) => version.sceneId === resolvedSceneId)
                  : []))
              : [];

            const dedupedVersionCandidates = messageVersionCandidates.filter((version, candidateIndex, allVersions) => {
              return allVersions.findIndex((candidate) => candidate.versionId === version.versionId) === candidateIndex;
            });

            const artifactCards: ChatArtifactCard[] = dedupedVersionCandidates.slice(0, 4).map((version) => {
              const rawPreviewUrl = String(version.mediaUrl ?? version.previewUrl ?? "").trim();
              const previewUrl = rawPreviewUrl && rawPreviewUrl !== "about:blank" ? rawPreviewUrl : null;

              return {
                versionId: version.versionId,
                sceneId: version.sceneId,
                versionLabel: `v${version.version ?? 0}`,
                skill: version.skill,
                outputKind: version.outputKind,
                mediaType: version.mediaType,
                previewUrl,
                isPreviewActive: Boolean(
                  activeArtifactId === version.versionId
                ),
                isCodeActive: Boolean(
                  isWorkspaceVisible
                  && panelView === 'code'
                  && activeSession?.currentScene?.versionId === version.versionId
                ),
                onPreview: () => {
                  void handleMessageSceneAction('preview', version.versionId);
                },
                onCode: () => {
                  void handleMessageSceneAction('code', version.versionId);
                }
              };
            });

            const isSynthetic = hasMetaFlag(message.meta, "synthetic:true");
            const turnFailed = isSynthetic && !isSending && Boolean(sessionsError);
            
            const displayContent = turnFailed 
              ? "The agent encountered a critical error before completing the response." 
              : (message.role === "assistant"
                ? getAssistantDisplayContent(message.content, promptContext, resolvedSceneId)
                : message.content);
            const displayErrorCode = turnFailed ? "Turn Incomplete" : errorCode;
            const displayAssistantWarning = turnFailed ? true : assistantWarning;

            if (message.role === "user") {
              return (
                <UserMessage
                  key={message.id || `msg-user-${index}`}
                  content={message.content}
                  timestamp={Date.parse(message.createdAt)}
                />
              );
            }

            return (
              <AIMessage
                key={message.id || `msg-ai-${index}`}
                content={displayContent}
                timestamp={Date.parse(message.createdAt)}
                isThinking={isLast && lastAssistantIsThinking && !message.content}
                thinkingText={isLast && lastAssistantIsThinking ? thinkingText : undefined}
                thinkingStep={isLast && lastAssistantIsThinking ? thinkingStep : undefined}
                thoughts={thoughts}
                thinkingDuration={thinkingDuration}
                sceneId={resolvedSceneId}
                skill={skill}
                assistantSource={assistantSource}
                assistantWarning={displayAssistantWarning}
                errorCode={displayErrorCode}
                meta={message.meta}
                isPreviewActive={isPreviewActive}
                isCodeActive={isCodeActive}
                onSceneCode={resolvedVersionId
                  ? () => {
                      void handleMessageSceneAction('code', resolvedVersionId);
                    }
                  : undefined}
                onScenePreview={resolvedVersionId
                  ? () => {
                      void handleMessageSceneAction('preview', resolvedVersionId);
                    }
                  : undefined}
                artifactCards={artifactCards}
                sceneCode={matchedVersion?.code ?? liveScene?.code ?? null}
                sceneSkill={matchedVersion?.skill ?? liveScene?.skill ?? null}
                sceneVersionId={resolvedVersionId}
                onSceneExpand={resolvedVersionId
                  ? () => {
                      void handleMessageSceneAction('preview', resolvedVersionId);
                    }
                  : undefined}
                mediaUrl={matchedVersion?.mediaUrl ?? null}
                mediaType={matchedVersion?.mediaType ?? null}
                outputKind={matchedVersion?.outputKind ?? null}
                mediaStatusStage={isLast ? (activeTaskProgress?.mediaStage ?? 'idle') : (matchedVersion?.mediaUrl ? 'ready' : 'idle')}
                mediaStatusText={isLast ? (activeTaskProgress?.mediaStatusText ?? null) : null}
                messageKind={message.kind ?? null}
                agentFiles={msgAgentFiles}
                agentToolLog={msgAgentToolLog}
                isLatest={isLatest}
              />
            );
          })}


              </>
            )}

          </div>

        </div>

            {/* Agent Approval Gate */}
            {pendingApproval && pendingApproval.sessionId === activeSessionId && (
              <div className="shrink-0 w-full px-3 max-w-3xl mx-auto pb-2">
                <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-amber-400/60 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-amber-200/90">Agent approval required</p>
                    <p className="mt-0.5 text-[12px] text-amber-200/60 leading-relaxed">
                      {pendingApproval.description || `Step: ${pendingApproval.step}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => sendApprovalResponse(false)}
                      className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => sendApprovalResponse(true)}
                      className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-[12px] font-medium text-emerald-300 transition hover:bg-emerald-500/30"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Input */}
            <div className="shrink-0 pb-4 lg:pb-8 pt-2">
              <div className="w-full">
                <div className={`relative w-full px-3 max-w-3xl mx-auto ${debugLayout ? "outline outline-2 outline-amber-300/80" : ""}`}>
                <Composer
                  value={composerValue}
                  onChange={setComposerValue}
                  onSubmit={handleSend}
                  attachedImage={composerImage}
                  onImageSelected={setComposerImage}
                  onRemoveImage={clearComposerImage}
                  isSending={isSending}
                  onStop={handleStop}
                  placeholder="Send a message..."
                  providers={providers}
                  activeProviderId={activeProviderId}
                  onProviderChange={setActiveProvider}
                  connectionState={connectionState}
                />
                <div className="mt-2 text-center text-[11px] text-white/30 hidden lg:block">
                  Press Enter to send, Shift+Enter for new line
                </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Cinematic Theater Mode Overlay */}
      <CinematicPlayer />
    </>
  );
}

