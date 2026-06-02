import type { SandboxExecutionRequest, SandboxExecutionResponse, SandboxStatus, ToolRegistryResponse, CreateApiKeyResponse, ListApiKeysResponse, DeleteApiKeyResponse } from './types.js';
import { requestJson, USE_DEV_MOCKS } from './api-helpers.js';

export async function installTool(toolId: string): Promise<{ success: boolean; message: string }> {
  try {
    return await requestJson<{ success: boolean; message: string }>("/api/v1/sandbox/tools/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolId })
    }, "Tool installation failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return { success: true, message: `Tool ${toolId} installed (dev mock)` };
    }
    throw error;
  }
}

export async function executeInSandbox(request: SandboxExecutionRequest): Promise<SandboxExecutionResponse> {
  try {
    return await requestJson<SandboxExecutionResponse>("/api/v1/sandbox/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    }, "Sandbox execution failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        success: true,
        executionId: `dev-exec-${Date.now()}`,
        previewUrl: null,
        artifacts: [],
        metrics: {
          durationMs: 120,
          memoryPeakMb: 48,
          cpuAvgPercent: 15,
          fpsAvg: 60,
          fpsMin: 58,
          fpsMax: 62,
          frameCount: 720,
          errorCount: 0,
          warningCount: 0,
          renderTimeMs: 80
        },
        logs: [{ level: "info", message: "Dev mock sandbox execution completed.", timestamp: new Date().toISOString() }],
        error: null,
        errorDetails: null
      };
    }
    throw error;
  }
}

export async function getSandboxStatus(sessionId: string): Promise<SandboxStatus> {
  try {
    return await requestJson<SandboxStatus>(`/api/v1/sessions/${sessionId}/sandbox/status`, {
      method: "GET"
    }, "Sandbox status request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        status: "completed",
        containerId: "dev-container-001",
        resources: { cpuPercent: 5, memoryUsedMb: 32, diskUsedMb: 10 },
        toolsInstalled: ["three", "p5.js"],
        uptimeSeconds: 300
      };
    }
    throw error;
  }
}

export async function listTools(): Promise<ToolRegistryResponse> {
  try {
    return await requestJson<ToolRegistryResponse>("/api/v1/tools", {
      method: "GET"
    }, "Tool registry request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        tools: [
          {
            id: "three",
            name: "Three.js",
            version: "0.160.0",
            description: "3D graphics rendering library",
            installCommand: "npm install three",
            cdnUrl: "https://unpkg.com/three@0.160.0/build/three.min.js",
            category: "visual",
            reputation: "official",
            sizeEstimateMb: 2.5
          },
          {
            id: "p5",
            name: "p5.js",
            version: "1.9.0",
            description: "Creative coding and 2D sketching library",
            installCommand: "npm install p5",
            cdnUrl: "https://unpkg.com/p5@1.9.0/lib/p5.min.js",
            category: "visual",
            reputation: "official",
            sizeEstimateMb: 1.8
          }
        ],
        categories: ["visual", "audio", "utility"]
      };
    }
    throw error;
  }
}

export async function createApiKey(name: string, scopes?: string[]): Promise<CreateApiKeyResponse> {
  try {
    return await requestJson<CreateApiKeyResponse>("/api/v1/auth/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || "Unnamed Key", scopes: scopes ?? ["*"] })
    }, "API key creation failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        data: {
          id: "dev-key-001",
          name: name || "Unnamed Key",
          key: "sk-dev-mock-xxxxxxxxxxxx",
          scopes: scopes ?? ["*"],
          created_at: new Date().toISOString()
        },
        error: null
      };
    }
    throw error;
  }
}

export async function listApiKeys(): Promise<ListApiKeysResponse> {
  try {
    return await requestJson<ListApiKeysResponse>("/api/v1/auth/api-keys", {
      method: "GET"
    }, "API key list request failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        data: [
          {
            id: "dev-key-001",
            userId: "dev-user-001",
            name: "Default Dev Key",
            scopes: ["*"],
            createdAt: new Date().toISOString()
          }
        ],
        error: null
      };
    }
    throw error;
  }
}

export async function deleteApiKey(id: string): Promise<DeleteApiKeyResponse> {
  try {
    return await requestJson<DeleteApiKeyResponse>(`/api/v1/auth/api-keys/${id}`, {
      method: "DELETE"
    }, "API key deletion failed");
  } catch (error) {
    if (USE_DEV_MOCKS) {
      return {
        data: { deleted: true },
        error: null
      };
    }
    throw error;
  }
}
