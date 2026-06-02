import type {
  SkillCatalogResponse,
  ProviderListResponse,
  CreateSessionResponse,
  SessionListResponse,
  SessionSceneState,
  SessionMessagesResponse,
} from './types.js';
import { requestJson, USE_DEV_MOCKS, resolveWebSocketUrl } from './api-helpers.js';

function buildDevSession(sessionId?: string): CreateSessionResponse {
  const resolvedSessionId = sessionId ?? `session-${Date.now()}`;
  const now = new Date().toISOString();

  return {
    sessionId: resolvedSessionId,
    websocketUrl: resolveWebSocketUrl("/ws"),
    sceneState: {
      sessionId: resolvedSessionId,
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
      updatedAt: now
    }
  };
}

export async function listSkills(): Promise<SkillCatalogResponse> {
  try {
    return await requestJson<SkillCatalogResponse>("/api/v1/skills", { method: "GET" }, "Skill catalog request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        skills: [
          {
            id: "threejs",
            name: "Three.js Renderer",
            version: "0.160.0",
            description: "3D scene generation with lighting, materials, and camera controls.",
            domainFocus: ["3d", "animation"],
            capabilities: ["primitive", "material", "lighting", "animation", "camera"],
            executionReliability: 0.94,
            warmPoolAvailability: 0.82,
            safeDefault: true
          },
          {
            id: "p5js",
            name: "p5.js Sketcher",
            version: "1.9.0",
            description: "Expressive 2D motion, sketches, particles, and interactive visuals.",
            domainFocus: ["2d", "animation"],
            capabilities: ["canvas", "drawing", "interaction", "animation", "particles"],
            executionReliability: 0.91,
            warmPoolAvailability: 0.76,
            safeDefault: true
          },
          {
            id: "d3js",
            name: "D3.js Visualizer",
            version: "7.9.0",
            description: "Data-driven charts, diagrams, and structured visual layouts.",
            domainFocus: ["data-viz", "diagram"],
            capabilities: ["scales", "axes", "layout", "binding", "transition"],
            executionReliability: 0.89,
            warmPoolAvailability: 0.72,
            safeDefault: true
          },
          {
            id: "animejs",
            name: "Anime.js Animator",
            version: "3.2.2",
            description: "High-fidelity DOM/SVG motion graphics using timeline-based animation.",
            domainFocus: ["animation", "2d", "motion-graphics"],
            capabilities: ["timeline", "easing", "stagger", "svg", "interaction"],
            executionReliability: 0.9,
            warmPoolAvailability: 0.74,
            safeDefault: true
          },
          {
            id: "manim",
            name: "Manim Video Composer",
            version: "0.18.1",
            description: "Python-based cinematic animation rendering for rich educational and narrative videos.",
            domainFocus: ["animation", "2d", "motion-graphics"],
            capabilities: ["video", "timeline", "easing", "typography", "camera"],
            executionReliability: 0.86,
            warmPoolAvailability: 0.62,
            safeDefault: false
          }
        ]
      };
    }

    throw error;
  }
}

export async function listProviders(): Promise<ProviderListResponse> {
  try {
    return await requestJson<ProviderListResponse>("/api/v1/providers", { method: "GET" }, "Providers list request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { providers: [{ id: "auto", name: "Auto (Recommended)", state: "healthy" }] };
    }
    throw error;
  }
}

export async function createSession(sessionId?: string): Promise<CreateSessionResponse> {
  try {
    return await requestJson<CreateSessionResponse>("/api/v1/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionId ? { sessionId } : {})
    }, "Session creation request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return buildDevSession(sessionId);
    }

    throw error;
  }
}

export async function listSessions(): Promise<SessionListResponse> {
  try {
    return await requestJson<SessionListResponse>("/api/v1/sessions", { method: "GET" }, "Session list request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { sessions: [] };
    }

    throw error;
  }
}

export async function deleteSession(sessionId: string): Promise<{ success: boolean }> {
  try {
    return await requestJson<{ success: boolean }>(`/api/v1/sessions/${sessionId}`, {
      method: "DELETE"
    }, "Session delete request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { success: true };
    }
    throw error;
  }
}

export async function updateSession(
  sessionId: string,
  updates: Partial<SessionSceneState>
): Promise<{ success: boolean; session?: SessionSceneState }> {
  try {
    return await requestJson<{ success: boolean; session?: SessionSceneState }>(`/api/v1/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    }, "Session update request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { success: true };
    }
    throw error;
  }
}

export async function listSessionMessages(sessionId: string): Promise<SessionMessagesResponse> {
  try {
    return await requestJson<SessionMessagesResponse>(`/api/v1/sessions/${sessionId}/messages`, {
      method: "GET"
    }, "Session messages request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { sessionId, messages: [] };
    }

    throw error;
  }
}
