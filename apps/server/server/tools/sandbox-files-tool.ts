/**
 * SandboxFilesTool — File operations inside Docker or Daytona sandboxes.
 *
 * When SKILL_RUNTIME=daytona, files are read/written via the Daytona
 * SandboxFileSystem (shell commands). Otherwise, writes go directly
 * to the Docker-mounted host workspace.
 */

import { readFile, writeFile, mkdir, readdir, stat, rm } from "fs/promises";
import { join, dirname, relative } from "path";
import { Tool } from "./Tool.js";
import { toolMetadata, methodMetadata, openapiSchema } from "./decorators.js";
import { ensureSandboxRunning } from "../sandbox/manager.js";

async function getWorkspacePath(sessionId: string): Promise<string | null> {
  const container = await ensureSandboxRunning({ sessionId }).catch(() => null);
  if (!container) return null;
  return container.workspacePath;
}

/**
 * Check if a Daytona workspace is provisioned for this session.
 * If so, return the SandboxFileSystem for Daytona-backed operations.
 * Returns null if Docker should be used instead.
 */
async function getDaytonaFilesystem(
  sessionId: string
): Promise<{
  filesystem: any;
  executeCommand: (cmd: string, opts?: { timeoutMs?: number }) => Promise<string>;
  nativeFs: any;
  sessionDir: string;
} | null> {
  try {
    const { getWorkspace } = await import(
      "../sandbox/daytona-workspace-store.js"
    );
    const ws = getWorkspace(sessionId);
    if (ws?.filesystem) {
      return {
        filesystem: ws.filesystem,
        executeCommand: ws.executeCommand,
        nativeFs: ws.nativeFs,
        sessionDir: ws.sessionDir ?? "/home/user/projects",
      };
    }
  } catch {
    // Daytona store not available — use Docker
  }
  return null;
}

function resolveSafePath(base: string, target: string): string | null {
  const resolved = join(base, target);
  // Ensure the resolved path stays within the base workspace
  const relativePath = relative(base, resolved);
  if (relativePath.startsWith("..") || relativePath.startsWith("/")) {
    return null;
  }
  return resolved;
}

@toolMetadata(
  "Sandbox Files",
  "Create, read, edit, and manage files inside the sandboxed workspace. All paths are relative to /workspace.",
  { weight: 15, visible: true, is_core: true }
)
export class SandboxFilesTool extends Tool {
  @methodMetadata("Read File", "Read the contents of a file in the sandbox.")
  @openapiSchema({
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a file in the sandbox workspace.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          file_path: {
            type: "string",
            description: "Relative path to the file inside /workspace (e.g. 'animations/scene.html').",
          },
          offset: {
            type: "number",
            description: "Line offset to start reading from (0-indexed).",
            default: 0,
          },
          limit: {
            type: "number",
            description: "Maximum lines to read.",
            default: 500,
          },
        },
        required: ["session_id", "file_path"],
      },
    },
  })
  async readFile(args: {
    session_id: string;
    file_path: string;
    offset?: number;
    limit?: number;
  }) {
    // Try Daytona first
    const daytona = await getDaytonaFilesystem(args.session_id);
    if (daytona) {
      const result = await daytona.filesystem.readFile(args.file_path);
      if (!result.success) {
        return this.failResponse(`Failed to read file: ${result.error ?? "File not found"}`);
      }
      const content = result.content ?? "";
      const lines = content.split("\n");
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 500;
      const slice = lines.slice(offset, offset + limit).join("\n");
      return this.successResponse({
        file_path: args.file_path,
        content: slice,
        total_lines: lines.length,
        offset,
        has_more: lines.length > offset + limit,
      });
    }

    const workspace = await getWorkspacePath(args.session_id);
    if (!workspace) {
      return this.failResponse(`No active sandbox for session ${args.session_id}`);
    }

    const safePath = resolveSafePath(workspace, args.file_path);
    if (!safePath) {
      return this.failResponse("Invalid file path: path traversal detected.");
    }

    try {
      const content = await readFile(safePath, "utf-8");
      const lines = content.split("\n");
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 500;
      const slice = lines.slice(offset, offset + limit).join("\n");

      return this.successResponse({
        file_path: args.file_path,
        content: slice,
        total_lines: lines.length,
        offset,
        has_more: lines.length > offset + limit,
      });
    } catch (err: any) {
      return this.failResponse(`Failed to read file: ${err.message}`);
    }
  }

  @methodMetadata("Write File", "Create or overwrite a file in the sandbox.")
  @openapiSchema({
    type: "function",
    function: {
      name: "write_file",
      description: "Write content to a file in the sandbox workspace. Creates parent directories if needed.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          file_path: {
            type: "string",
            description: "Relative path inside /workspace (e.g. 'index.html').",
          },
          content: {
            type: "string",
            description: "The file content to write.",
          },
        },
        required: ["session_id", "file_path", "content"],
      },
    },
  })
  async writeFile(args: { session_id: string; file_path: string; content: string }) {
    // Try Daytona first
    const daytona = await getDaytonaFilesystem(args.session_id);
    if (daytona) {
      const result = await daytona.filesystem.writeFile(
        args.file_path,
        args.content
      );
      if (result.success) {
        return this.successResponse({
          file_path: args.file_path,
          written: true,
          bytes: Buffer.byteLength(args.content, "utf-8"),
        });
      }
      return this.failResponse(
        `Failed to write file: ${result.error ?? "Unknown error"}`
      );
    }

    const workspace = await getWorkspacePath(args.session_id);
    if (!workspace) {
      return this.failResponse(`No active sandbox for session ${args.session_id}`);
    }

    const safePath = resolveSafePath(workspace, args.file_path);
    if (!safePath) {
      return this.failResponse("Invalid file path: path traversal detected.");
    }

    try {
      await mkdir(dirname(safePath), { recursive: true });
      await writeFile(safePath, args.content, "utf-8");

      return this.successResponse({
        file_path: args.file_path,
        written: true,
        bytes: Buffer.byteLength(args.content, "utf-8"),
      });
    } catch (err: any) {
      return this.failResponse(`Failed to write file: ${err.message}`);
    }
  }

  @methodMetadata("Edit File", "Replace a specific string in a file with another string.")
  @openapiSchema({
    type: "function",
    function: {
      name: "str_replace",
      description: "Replace an exact string in a file with new content. The old_string must match exactly (including whitespace).",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          file_path: {
            type: "string",
            description: "Relative path inside /workspace.",
          },
          old_string: {
            type: "string",
            description: "The exact text to replace. Must match the file content precisely.",
          },
          new_string: {
            type: "string",
            description: "The replacement text.",
          },
        },
        required: ["session_id", "file_path", "old_string", "new_string"],
      },
    },
  })
  async strReplace(args: {
    session_id: string;
    file_path: string;
    old_string: string;
    new_string: string;
  }) {
    // Try Daytona first
    const daytona = await getDaytonaFilesystem(args.session_id);
    if (daytona?.nativeFs) {
      const safePath = resolveSafePath(daytona.sessionDir, args.file_path);
      if (!safePath) {
        return this.failResponse("Invalid file path: path traversal detected.");
      }
      try {
        const buffer = await daytona.nativeFs.downloadFile(safePath);
        const content = buffer.toString("utf-8");
        const occurrences = content.split(args.old_string).length - 1;
        if (occurrences === 0) {
          return this.failResponse(
            `old_string not found in ${args.file_path}. The content may have changed.`
          );
        }
        if (occurrences > 1) {
          return this.failResponse(
            `old_string appears ${occurrences} times in ${args.file_path}. Provide more context to make it unique.`
          );
        }
        const newContent = content.replace(args.old_string, args.new_string);
        await daytona.nativeFs.uploadFile(Buffer.from(newContent, "utf-8"), safePath);
        return this.successResponse({
          file_path: args.file_path,
          replaced: true,
          replacements: 1,
        });
      } catch (err: any) {
        return this.failResponse(`Failed to edit file: ${err.message}`);
      }
    }

    // Fallback: Docker local filesystem
    const workspace = await getWorkspacePath(args.session_id);
    if (!workspace) {
      return this.failResponse(`No active sandbox for session ${args.session_id}`);
    }

    const safePath = resolveSafePath(workspace, args.file_path);
    if (!safePath) {
      return this.failResponse("Invalid file path: path traversal detected.");
    }

    try {
      const content = await readFile(safePath, "utf-8");
      const occurrences = content.split(args.old_string).length - 1;

      if (occurrences === 0) {
        return this.failResponse(
          `old_string not found in ${args.file_path}. The content may have changed.`
        );
      }

      if (occurrences > 1) {
        return this.failResponse(
          `old_string appears ${occurrences} times in ${args.file_path}. Provide more context to make it unique.`
        );
      }

      const newContent = content.replace(args.old_string, args.new_string);
      await writeFile(safePath, newContent, "utf-8");

      return this.successResponse({
        file_path: args.file_path,
        replaced: true,
        replacements: 1,
      });
    } catch (err: any) {
      return this.failResponse(`Failed to edit file: ${err.message}`);
    }
  }

  @methodMetadata("List Files", "List files and directories in the sandbox workspace.")
  @openapiSchema({
    type: "function",
    function: {
      name: "list_files",
      description: "List files in a directory within the sandbox workspace.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          dir_path: {
            type: "string",
            description: "Relative directory path inside /workspace. Use '.' for root.",
            default: ".",
          },
          recursive: {
            type: "boolean",
            description: "List recursively.",
            default: false,
          },
        },
        required: ["session_id"],
      },
    },
  })
  async listFiles(args: { session_id: string; dir_path?: string; recursive?: boolean }) {
    // Try Daytona first
    const daytona = await getDaytonaFilesystem(args.session_id);
    if (daytona) {
      const dirPath = args.dir_path ?? ".";
      if (args.recursive) {
        const output = await daytona
          .executeCommand(
            `find "${dirPath}" -maxdepth 3 -not -path '*/.npm*' -not -path '*node_modules*' 2>/dev/null | head -200`
          )
          .catch(() => "");
        const files = output
          .split("\n")
          .filter((l) => l.trim())
          .map((l) => ({
            path: l.trim(),
            type: "file",
          }));
        return this.successResponse({
          dir_path: dirPath,
          files,
          count: files.length,
        });
      }
      const output = await daytona
        .executeCommand(
          `ls -1A "${dirPath}" 2>/dev/null | head -100`
        )
        .catch(() => "");
      const files = output
        .split("\n")
        .filter((l) => l.trim())
        .map((name) => ({ name, type: "file" }));
      return this.successResponse({
        dir_path: dirPath,
        files,
        count: files.length,
      });
    }

    const workspace = await getWorkspacePath(args.session_id);
    if (!workspace) {
      return this.failResponse(`No active sandbox for session ${args.session_id}`);
    }

    const safePath = resolveSafePath(workspace, args.dir_path ?? ".");
    if (!safePath) {
      return this.failResponse("Invalid directory path: path traversal detected.");
    }

    try {
      const entries = await readdir(safePath, { withFileTypes: true });
      const files = entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "directory" : "file",
      }));

      if (args.recursive) {
        // Simple recursive listing (depth-limited)
        const recursiveFiles: Array<{ path: string; type: string }> = [];
        async function walk(dir: string, prefix: string) {
          const items = await readdir(dir, { withFileTypes: true });
          for (const item of items) {
            const rel = prefix ? `${prefix}/${item.name}` : item.name;
            if (item.isDirectory()) {
              recursiveFiles.push({ path: rel, type: "directory" });
              if (recursiveFiles.length < 200) {
                await walk(join(dir, item.name), rel);
              }
            } else {
              recursiveFiles.push({ path: rel, type: "file" });
            }
          }
        }
        await walk(safePath, "");
        return this.successResponse({
          dir_path: args.dir_path ?? ".",
          files: recursiveFiles,
          count: recursiveFiles.length,
        });
      }

      return this.successResponse({
        dir_path: args.dir_path ?? ".",
        files,
        count: files.length,
      });
    } catch (err: any) {
      return this.failResponse(`Failed to list files: ${err.message}`);
    }
  }

  @methodMetadata("Delete File", "Delete a file or directory in the sandbox.")
  @openapiSchema({
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file or directory in the sandbox workspace.",
      parameters: {
        type: "object",
        properties: {
          session_id: {
            type: "string",
            description: "The session ID whose sandbox to target.",
          },
          file_path: {
            type: "string",
            description: "Relative path inside /workspace to delete.",
          },
        },
        required: ["session_id", "file_path"],
      },
    },
  })
  async deleteFile(args: { session_id: string; file_path: string }) {
    // Try Daytona first
    const daytona = await getDaytonaFilesystem(args.session_id);
    if (daytona?.nativeFs) {
      const safePath = resolveSafePath(daytona.sessionDir, args.file_path);
      if (!safePath) {
        return this.failResponse("Invalid file path: path traversal detected.");
      }
      try {
        await daytona.nativeFs.deleteFile(safePath, true);
        return this.successResponse({
          file_path: args.file_path,
          deleted: true,
        });
      } catch (err: any) {
        return this.failResponse(`Failed to delete: ${err.message}`);
      }
    }

    // Fallback: Docker local filesystem
    const workspace = await getWorkspacePath(args.session_id);
    if (!workspace) {
      return this.failResponse(`No active sandbox for session ${args.session_id}`);
    }

    const safePath = resolveSafePath(workspace, args.file_path);
    if (!safePath) {
      return this.failResponse("Invalid file path: path traversal detected.");
    }

    try {
      await rm(safePath, { recursive: true, force: true });
      return this.successResponse({
        file_path: args.file_path,
        deleted: true,
      });
    } catch (err: any) {
      return this.failResponse(`Failed to delete: ${err.message}`);
    }
  }
}
