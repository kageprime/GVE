import type { UndoRedoResponse, VersionListResponse } from './types.js';
import { requestJson } from './api-helpers.js';

export async function undoScene(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Undo request failed", 0);
}

export async function redoScene(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/redo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Redo request failed", 0);
}

export async function previousArtifact(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/artifacts/previous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Previous artifact request failed", 0);
}

export async function nextArtifact(sessionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/artifacts/next`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, "Next artifact request failed", 0);
}

export async function listVersions(sessionId: string): Promise<VersionListResponse> {
  return requestJson<VersionListResponse>(`/api/v1/sessions/${sessionId}/versions`, {
    method: "GET"
  }, "Version list request failed");
}

export async function selectVersion(sessionId: string, versionId: string): Promise<UndoRedoResponse> {
  return requestJson<UndoRedoResponse>(`/api/v1/sessions/${sessionId}/versions/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ versionId })
  }, "Version selection request failed", 0);
}
