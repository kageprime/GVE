import type { GenerateRequest, GenerateResponse, ModifyRequest, ModifyResponse, ChatTurnRequest, ChatTurnResponse, SessionMessage, TaskPlanResponse, TaskExecutionResponse, GveTask, GveTaskAction } from './types.js';
import { requestJson, USE_DEV_MOCKS } from './api-helpers.js';

function buildDevMock(input: GenerateRequest): GenerateResponse {
  const sessionId = input.sessionId ?? `session-${Date.now()}`;
  const sceneId = `scene-${Date.now()}`;
  const selectedSkill = input.preferences?.skill && input.preferences.skill !== "auto"
    ? input.preferences.skill
    : "threejs";
  const isManim = selectedSkill === "manim";
  const previewUrl = isManim
    ? "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
    : "about:blank";
  const outputKind: "code" | "media" = isManim ? "media" : "code";

  const codeBySkill: Record<string, string> = {
    threejs: [
      "// Dev fallback generated code",
      "const geometry = new THREE.BoxGeometry(1, 1, 1);",
      "const material = new THREE.MeshStandardMaterial({ color: 0x1d8cf8, metalness: 0.8, roughness: 0.2 });",
      "const cube = new THREE.Mesh(geometry, material);",
      "scene.add(cube);",
      "function animate() {",
      "  requestAnimationFrame(animate);",
      "  cube.rotation.x += 0.01;",
      "  cube.rotation.y += 0.01;",
      "  renderer.render(scene, camera);",
      "}",
      "animate();"
    ].join("\n"),
    p5js: [
      "// Dev fallback generated code",
      "function setup() {",
      "  createCanvas(800, 500);",
      "}",
      "function draw() {",
      "  background(244);",
      "  fill(64, 120, 255);",
      "  ellipse(width * 0.5, height * 0.5, 120, 120);",
      "}"
    ].join("\n"),
    d3js: [
      "// Dev fallback generated code",
      "const svg = d3.select(document.body).append('svg').attr('width', 640).attr('height', 360);",
      "svg.append('circle').attr('cx', 320).attr('cy', 180).attr('r', 72).attr('fill', '#4f8cf8');"
    ].join("\n"),
    animejs: [
      "// Dev fallback generated code",
      "const stage = document.getElementById('stage') || document.body;",
      "const dot = document.createElement('div');",
      "dot.style.width = '72px';",
      "dot.style.height = '72px';",
      "dot.style.borderRadius = '999px';",
      "dot.style.background = 'linear-gradient(135deg, #60a5fa, #34d399)';",
      "dot.style.margin = '120px auto';",
      "stage.appendChild(dot);",
      "anime({ targets: dot, scale: [0.9, 1.12], duration: 1400, direction: 'alternate', loop: true, easing: 'easeInOutSine' });"
    ].join("\n"),
    manim: [
      "from manim import *",
      "",
      "class GVERichScene(Scene):",
      "    def construct(self):",
      "        title = Text(\"Terranet Rich Video\", weight=BOLD).scale(0.9)",
      "        subtitle = Text(\"Manim animation preview\", font_size=32).next_to(title, DOWN)",
      "        ring = Circle(radius=1.6, stroke_color=BLUE_E, stroke_width=10)",
      "        core = Dot(radius=0.22, color=TEAL_A)",
      "        pulse = always_redraw(lambda: Circle(radius=1.6 + 0.08 * np.sin(self.time * 2), stroke_color=BLUE_C, stroke_opacity=0.4))",
      "",
      "        self.play(FadeIn(title, shift=UP * 0.3), FadeIn(subtitle, shift=DOWN * 0.2), run_time=1.1)",
      "        self.play(Create(ring), FadeIn(core), run_time=1.2)",
      "        self.add(pulse)",
      "        self.play(Rotate(ring, angle=TAU, run_time=2.4, rate_func=smooth), core.animate.scale(1.4), run_time=2.4)",
      "        self.wait(0.6)"
    ].join("\n")
  };
  const selectedCode: string = (codeBySkill[selectedSkill] ?? codeBySkill.threejs) as string;

  return {
    sceneId,
    previewUrl,
    skill: selectedSkill,
    outputKind,
    mediaType: isManim ? "video/mp4" : null,
    mediaUrl: isManim ? previewUrl : null,
    explanation: "Dev fallback response: connect a backend endpoint to replace this mock output.",
    sessionId,
    sceneVersion: 1,
    versionCount: 1,
    sceneState: {
      sessionId,
      sceneId,
      versionCount: 1,
      versionPointer: 0,
      revisionCount: 1,
      revisionPointer: 0,
      artifactCount: 1,
      artifactPointer: 0,
      currentArtifactId: "artifact-1",
      canUndo: false,
      canRedo: false,
      canPreviousArtifact: false,
      canNextArtifact: false,
      currentScene: {
        versionId: "version-1",
        version: 1,
        artifactId: "artifact-1",
        artifactVersion: 1,
        sceneId,
        code: selectedCode,
        previewUrl,
        skill: selectedSkill,
        outputKind,
        mediaType: isManim ? "video/mp4" : null,
        mediaUrl: isManim ? previewUrl : null,
        explanation: "Dev fallback response: connect a backend endpoint to replace this mock output.",
        source: "fallback",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      versions: [
        {
          versionId: "version-1",
          version: 1,
          artifactId: "artifact-1",
          artifactVersion: 1,
          sceneId,
          code: selectedCode,
          previewUrl,
          skill: selectedSkill,
          outputKind,
          mediaType: isManim ? "video/mp4" : null,
          mediaUrl: isManim ? previewUrl : null,
          explanation: "Dev fallback response: connect a backend endpoint to replace this mock output.",
          source: "fallback",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ],
      artifacts: [
        {
          artifactId: "artifact-1",
          title: sceneId,
          revisionCount: 1,
          revisionPointer: 0,
          isCurrent: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          latestSceneId: sceneId,
          latestSkill: selectedSkill
        }
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    code: `${selectedCode}\n${isManim ? "#" : "//"} Original prompt: ${input.query}`
  };
}

function isConversationOnlyQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (/^(hi|hey|hello|yo|sup|hiya|good\s+(morning|afternoon|evening))\b/.test(normalized)) {
    return true;
  }

  if (/(what can (you|u) do|what do you do|how can you help|help me|what can i do here|what should i ask)/.test(normalized)) {
    return true;
  }

  if (/(thanks|thank you|cool|nice|okay|ok|got it|sounds good|hey there|hello there|how are you|who are you|what is your name|tell me a joke|can we chat|let's chat|lets chat)/.test(normalized)) {
    return true;
  }

  return !/\b(create|make|build|generate|design|draw|sketch|render|animate|modify|change|update|edit|explain|describe|walkthrough|scene|visual|image|3d|2d|canvas|diagram|chart|graph|data|cube|sphere|particle|color|rotation|spin|orbit|layout|lighting|material|shader|threejs|p5js|d3js|animejs|anime|manim|video|timeline|tween|easing|mermaid)\b/.test(
    normalized
  );
}

function buildDevChatMock(sessionId: string, content: string): ChatTurnResponse {
  const now = new Date().toISOString();
  const userMessage: SessionMessage = {
    id: `message-user-${Date.now()}`,
    role: "user",
    content,
    kind: "input",
    meta: [],
    createdAt: now,
    updatedAt: now
  };

  const assistantMessage: SessionMessage = {
    id: `message-assistant-${Date.now()}`,
    role: "assistant",
    content:
      "Yes. You can talk to me directly, and I can still switch into scene generation or editing when you ask.",
    kind: "chat",
    meta: [],
    createdAt: now,
    updatedAt: now
  };

  return {
    sessionId,
    mode: "chat",
    intent: {
      rawQuery: content,
      intentType: "chat",
      targetDomain: "conversation",
      entities: [],
      constraints: [],
      confidence: 0.96,
      ambiguous: false,
      clarificationPrompt: null
    },
    userMessage,
    assistantMessage,
    sceneState: {
      sessionId,
      sceneId: null,
      versionCount: 0,
      versionPointer: -1,
      revisionCount: 0,
      revisionPointer: -1,
      artifactCount: 0,
      artifactPointer: -1,
      currentArtifactId: null,
      canUndo: false,
      canRedo: false,
      canPreviousArtifact: false,
      canNextArtifact: false,
      currentScene: null,
      versions: [],
      artifacts: [],
      createdAt: now,
      updatedAt: now,
      messages: [userMessage, assistantMessage],
      orchestrationTrace: [],
      status: "idle"
    },
    messages: [userMessage, assistantMessage],
    result: null
  };
}

function buildDevTaskPlan(input: GenerateRequest): TaskPlanResponse {
  const selectedSkill = input.preferences?.skill && input.preferences.skill !== "auto"
    ? input.preferences.skill
    : "threejs";
  const planId = `plan-${Date.now()}`;

  return {
    planId,
    summary: `7 executable tasks queued for ${selectedSkill} using ${input.preferences?.quality ?? "standard"} quality.`,
    tasks: [
      {
        id: "t1",
        title: "Parse Intent",
        description: "Extract action, entities, and constraints from natural language request.",
        action: "parse_intent",
        command: "router.intentParser.parse(request.query)",
        status: "pending",
        dependsOn: []
      },
      {
        id: "t2",
        title: "Select Skill",
        description: "Score available skills and choose best-fit runtime.",
        action: "select_skill",
        command: "router.skillSelector.rank(parsedIntent, capabilityIndex)",
        status: "pending",
        dependsOn: ["t1"]
      },
      {
        id: "t3",
        title: "Build Prompt Context",
        description: "Assemble skill capabilities, examples, and generation constraints.",
        action: "build_prompt",
        command: "agent.promptBuilder.create(parsedIntent, selectedSkill, sceneContext)",
        status: "pending",
        dependsOn: ["t1", "t2"]
      },
      {
        id: "t4",
        title: "Generate Code",
        description: "Invoke model with deterministic generation parameters.",
        action: "generate_code",
        command: "agent.codeGenerator.generate(prompt, { temperature: 0.2 })",
        status: "pending",
        dependsOn: ["t3"]
      },
      {
        id: "t5",
        title: "Validate Safety",
        description: "Run syntax, API, and security policy checks before execution.",
        action: "validate_code",
        command: "orchestrator.validator.runAll(generatedCode)",
        status: "pending",
        dependsOn: ["t4"]
      },
      {
        id: "t6",
        title: "Execute in Sandbox",
        description: "Execute validated code inside isolated Daytona sandbox.",
        action: "execute_code",
        command: "skillRuntime.execute(generatedCode, { timeout: 30000 })",
        status: "pending",
        dependsOn: ["t5"]
      },
      {
        id: "t7",
        title: "Sync Scene State",
        description: "Persist new version and broadcast update to connected clients.",
        action: "sync_state",
        command: "stateSync.broadcast(sceneStateDiff, sessionId)",
        status: "pending",
        dependsOn: ["t6"]
      }
    ]
  };
}

function buildDevTaskExecution(planId: string, task: GveTask): TaskExecutionResponse {
  const outputs: Record<GveTaskAction, string> = {
    parse_intent: "Intent parsed with confidence 0.94 and 4 entities extracted.",
    select_skill: "Skill selector scored threejs=0.97, animejs=0.88, p5js=0.62, d3js=0.18. Selected threejs.",
    build_prompt: "Prompt context assembled with templates, examples, and runtime constraints.",
    generate_code: "Code generation completed with 126 lines of JavaScript.",
    validate_code: "Validation passed: syntax, API whitelist, and security policy checks all green.",
    provision_sandbox: "Sandbox provisioned and configured with required runtime dependencies.",
    analyze_quality: "Code quality analysis completed. Performance and safety metrics evaluated.",
    autonomous_patching: "Autonomous patching applied. Code validated against safety policies and whitelist.",
    execute_code: "Sandbox execution succeeded. Preview artifact generated.",
    sync_state: "Scene state version committed and websocket broadcast dispatched."
  };

  const artifact = task.action === "execute_code" ? "preview://dev/mock-scene" : undefined;

  return {
    planId,
    taskId: task.id,
    status: "completed",
    output: outputs[task.action],
    artifact
  };
}

export async function generateVisual(input: GenerateRequest): Promise<GenerateResponse> {
  try {
    return await requestJson<GenerateResponse>("/api/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, "Generation request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevMock(input);
    }

    throw error;
  }
}

export async function analyzeQuality(sessionId: string): Promise<{ success: boolean; consensus: number }> {
  return await requestJson<{ success: boolean; consensus: number }>(`/api/v1/sessions/${sessionId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Quality analysis request failed");
}

export async function modifyVisual(input: ModifyRequest): Promise<ModifyResponse> {
  try {
    return await requestJson<ModifyResponse>(`/api/v1/sessions/${input.sessionId}/modify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instruction: input.instruction,
        runMode: input.runMode,
        codeOverride: input.codeOverride,
        preferences: input.preferences
      })
    }, "Scene modification request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevMock({
        query: input.instruction,
        sessionId: input.sessionId,
        preferences: input.preferences
      }) as ModifyResponse;
    }

    throw error;
  }
}

export async function sendSessionMessage(
  sessionId: string,
  input: ChatTurnRequest,
  signal?: AbortSignal
): Promise<ChatTurnResponse> {
  try {
    return await requestJson<ChatTurnResponse>(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal
    }, "Chat turn request failed", 0);
  } catch (error) {
    if (USE_DEV_MOCKS) {
      const normalizedPrompt = String(input.content ?? "").trim();
      const fallbackPrompt = normalizedPrompt || "Generate a scene from the attached image.";
      const userContent = normalizedPrompt || "Attached an image.";

      if (normalizedPrompt && isConversationOnlyQuery(normalizedPrompt)) {
        return buildDevChatMock(sessionId, normalizedPrompt);
      }

      const now = new Date().toISOString();
      const sessionResponse = buildDevMock({ query: fallbackPrompt, sessionId, preferences: input.preferences });

      return {
        sessionId,
        mode: "generate",
        intent: {
          rawQuery: fallbackPrompt,
          intentType: "create",
          targetDomain: "3d",
          entities: [],
          constraints: [],
          confidence: 0.94,
          ambiguous: false,
          clarificationPrompt: null
        },
        userMessage: {
          id: `message-user-${Date.now()}`,
          role: "user",
          content: userContent,
          kind: "input",
          meta: [],
          createdAt: now,
          updatedAt: now
        },
        assistantMessage: {
          id: `message-assistant-${Date.now()}`,
          role: "assistant",
          content: sessionResponse.explanation,
          kind: "generate",
          meta: [],
          createdAt: now,
          updatedAt: now
        },
        sceneState: sessionResponse.sceneState,
        messages: [],
        result: sessionResponse
      };
    }

    throw error;
  }
}

export async function planEngineTasks(input: GenerateRequest): Promise<TaskPlanResponse> {
  try {
    return await requestJson<TaskPlanResponse>("/api/v1/tasks/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }, "Task planning request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevTaskPlan(input);
    }

    throw error;
  }
}

export async function executeEngineTask(planId: string, task: GveTask): Promise<TaskExecutionResponse> {
  try {
    return await requestJson<TaskExecutionResponse>("/api/v1/tasks/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, task })
    }, "Task execution request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      await new Promise((resolve) => {
        window.setTimeout(resolve, 450);
      });
      return buildDevTaskExecution(planId, task);
    }

    throw error;
  }
}
