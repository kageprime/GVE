/**
 * Daytona Workspace Store — Shared session-level Daytona workspace handles.
 *
 * When SKILL_RUNTIME=daytona, the agent-turn-path provisions a Daytona
 * workspace. This store makes it available to sandbox_files, sandbox_shell,
 * and animation_manim tools without requiring a local Docker container.
 *
 * Each session's handle holds:
 *   - workspace  — the Daytona SDK workspace object
 *   - filesystem — SandboxFileSystem for file read/write via shell commands
 *   - process    — workspace.process.executeCommand binding
 *   - workspaceId — the Daytona sandbox ID
 */

export interface DaytonaWorkspaceHandle {
  workspaceId: string;
  workspace: any;
  filesystem: any;
  executeCommand(command: string, options?: { timeoutMs?: number }): Promise<string>;
  nativeFs: any; // Daytona SDK FileSystem instance
  sessionDir: string; // Session-scoped working directory inside the sandbox
}

const handles = new Map<string, DaytonaWorkspaceHandle>();

export function setWorkspace(sessionId: string, handle: DaytonaWorkspaceHandle): void {
  handles.set(sessionId, handle);
}

export function getWorkspace(sessionId: string): DaytonaWorkspaceHandle | undefined {
  return handles.get(sessionId);
}

export function hasWorkspace(sessionId: string): boolean {
  return handles.has(sessionId);
}

export function removeWorkspace(sessionId: string): void {
  handles.delete(sessionId);
}