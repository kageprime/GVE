import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./create-app.js";

describe("pipeline HTTP (plan + execute)", () => {
  let baseUrl: string;
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    const app = await createApp();
    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.once("error", reject);
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /healthz returns orchestration metadata", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status?: string; orchestration?: string };
    expect(body.status).toBe("ok");
    expect(body.orchestration).toBe("multi-agent");
  });

  it("POST /api/v1/tasks/plan then /execute runs multi-agent stubs without LLM", async () => {
    const planRes = await fetch(`${baseUrl}/api/v1/tasks/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "create a simple 3d rotating cube scene",
        preferences: { skill: "threejs", quality: "draft" }
      })
    });
    expect(planRes.status).toBe(200);
    const plan = (await planRes.json()) as {
      planId: string;
      summary: string;
      tasks: Array<{ id: string; action: string; status: string; command: string; dependsOn: string[] }>;
    };
    expect(plan.planId).toMatch(/^plan-/);
    expect(plan.tasks.length).toBeGreaterThanOrEqual(7);
    const first = plan.tasks[0];
    expect(first?.action).toBe("parse_intent");
    if (!first) throw new Error("expected first task");
    const execRes = await fetch(`${baseUrl}/api/v1/tasks/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId: plan.planId,
        task: first
      })
    });
    expect(execRes.status).toBe(200);
    const executed = (await execRes.json()) as {
      planId: string;
      taskId: string;
      status: string;
      output: string;
    };
    expect(executed.planId).toBe(plan.planId);
    expect(executed.taskId).toBe(first.id);
    expect(executed.status).toBe("completed");
    expect(executed.output).toContain("Intent parsed");
  });
});
