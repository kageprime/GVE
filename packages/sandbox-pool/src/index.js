import { Daytona } from "@daytonaio/sdk";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { toolRegistry } from "./tool-registry.js";
import { createSandboxFileSystem } from "./filesystem.js";
import { createBuildManager } from "./build-manager.js";
import { createArtifactStorage } from "./artifact-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parsePositiveIntEnv(rawValue, fallbackValue, minimum = 1) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.max(minimum, parsed);
}

function parseBoundedFloatEnv(rawValue, fallbackValue, minimum = 0, maximum = 1) {
  const parsed = Number.parseFloat(String(rawValue ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseBooleanEnv(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function parseOptionalStringEnv(rawValue, fallbackValue = null) {
  if (rawValue === undefined || rawValue === null) {
    return fallbackValue;
  }

  const normalized = String(rawValue).trim();
  return normalized.length > 0 ? normalized : fallbackValue;
}

function isRetryableProvisionError(error) {
  const message = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  const retryablePatterns = [
    "502",
    "503",
    "504",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "connection reset",
    "connection refused",
    "connection error",
    "eai_again",
    "enotfound",
    "getaddrinfo",
    "dns",
    "enetunreach",
    "timeout",
    "not ready",
    "temporarily unavailable"
  ];

  return retryablePatterns.some((pattern) => message.includes(pattern));
}

const MIN_ACQUIRE_ATTEMPT_WINDOW_MS = 1200;

function getRemainingBudgetMs(turnDeadlineAtMs) {
  if (!Number.isFinite(turnDeadlineAtMs)) {
    return Number.POSITIVE_INFINITY;
  }

  return turnDeadlineAtMs - Date.now();
}

function createAcquireBudgetError(remainingMs, context = "provisioning") {
  const error = new Error(
    `Daytona acquire budget exhausted before ${context}. remaining=${Math.max(0, Math.floor(remainingMs))}ms.`
  );
  error.code = "ACQUIRE_BUDGET_EXHAUSTED";
  return error;
}

function isAcquireBudgetExhaustedError(error) {
  return String(error?.code ?? "").toUpperCase() === "ACQUIRE_BUDGET_EXHAUSTED";
}

function capCreateTimeoutSeconds(defaultTimeoutSeconds, remainingBudgetMs) {
  if (!Number.isFinite(remainingBudgetMs)) {
    return defaultTimeoutSeconds;
  }

  const safetyAdjustedMs = Math.max(0, Math.floor(remainingBudgetMs) - 250);
  if (safetyAdjustedMs < MIN_ACQUIRE_ATTEMPT_WINDOW_MS) {
    return 0;
  }

  const cappedSeconds = Math.floor(safetyAdjustedMs / 1000);
  return Math.max(1, Math.min(defaultTimeoutSeconds, cappedSeconds));
}

function delayMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function average(list) {
  if (!Array.isArray(list) || list.length === 0) {
    return 0;
  }

  const total = list.reduce((sum, value) => sum + value, 0);
  return total / list.length;
}

function round(value, precision = 2) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}

function percent(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }

  return (numerator / denominator) * 100;
}

export class SandboxPoolManager {
  constructor() {
    this.directCreateTimeoutSec = parsePositiveIntEnv(
      process.env.DAYTONA_DIRECT_CREATE_TIMEOUT_SECONDS,
      10,
      3
    );
    this.fallbackCreateTimeoutSec = parsePositiveIntEnv(
      process.env.DAYTONA_FALLBACK_CREATE_TIMEOUT_SECONDS,
      25,
      5
    );
    this.directCreateImage = parseOptionalStringEnv(
      process.env.DAYTONA_DIRECT_CREATE_IMAGE,
      null
    );
    this.directCreateImageManim = parseOptionalStringEnv(
      process.env.DAYTONA_DIRECT_CREATE_IMAGE_MANIM,
      null
    );
    this.prewarmSize = parsePositiveIntEnv(
      process.env.DAYTONA_PREWARM_SIZE,
      1,
      0
    );
    // Idle sandbox TTL: evict pool entries older than this (ms). 0 = disabled.
    // Reduced from 300s to 60s default to prevent disk quota exhaustion.
    this.idleSandboxTtlMs = parsePositiveIntEnv(
      process.env.DAYTONA_IDLE_SANDBOX_TTL_SECONDS,
      60,
      10
    ) * 1000;
    // Liveness ping timeout before sending the full execution payload.
    // Increased from 800ms to 2000ms to be more forgiving for slower networks
    this.livenessPingTimeoutMs = parsePositiveIntEnv(
      process.env.DAYTONA_LIVENESS_PING_TIMEOUT_MS,
      2000,
      500
    );
    this.prewarmReplenishThreshold = parseBoundedFloatEnv(
      process.env.DAYTONA_PREWARM_REPLENISH_THRESHOLD,
      1,
      0.05,
      1
    );
    this.prewarmCheckIntervalSec = parsePositiveIntEnv(
      process.env.DAYTONA_PREWARM_CHECK_INTERVAL_SECONDS,
      15,
      5
    );
    this.acquireRetryAttempts = parsePositiveIntEnv(
      process.env.DAYTONA_ACQUIRE_RETRY_ATTEMPTS,
      2,
      1
    );
    this.acquireRetryBaseDelayMs = parsePositiveIntEnv(
      process.env.DAYTONA_ACQUIRE_RETRY_BASE_DELAY_MS,
      250,
      50
    );
    this.directCreateSkipBudgetMs = parsePositiveIntEnv(
      process.env.DAYTONA_DIRECT_SKIP_BUDGET_MS,
      4000,
      1200
    );
    this.metricsWindowSize = parsePositiveIntEnv(
      process.env.DAYTONA_METRICS_WINDOW_SIZE,
      120,
      20
    );
    this.metricsLogEvery = parsePositiveIntEnv(
      process.env.DAYTONA_METRICS_LOG_EVERY,
      20,
      1
    );
    this.directCircuitFailureThreshold = parsePositiveIntEnv(
      process.env.DAYTONA_DIRECT_CIRCUIT_BREAKER_THRESHOLD,
      3,
      1
    );
    this.directCircuitWindowMs = parsePositiveIntEnv(
      process.env.DAYTONA_DIRECT_CIRCUIT_BREAKER_WINDOW_MS,
      120_000,
      1_000
    );
    this.directCircuitCooldownMs = parsePositiveIntEnv(
      process.env.DAYTONA_DIRECT_CIRCUIT_BREAKER_COOLDOWN_MS,
      90_000,
      1_000
    );
    this.deleteIdleOnShutdown = parseBooleanEnv(
      process.env.DAYTONA_DELETE_IDLE_ON_SHUTDOWN,
      true
    );
    this.idleSandboxes = [];
    this.pendingWarmups = 0;
    this.closed = false;
    this.lastAcquireDiagnostics = null;
    // Track ALL provisioned workspace IDs (including failed ones) for orphan cleanup
    this.provisionedWorkspaces = new Map(); // workspaceId -> { workspace, createdAt, deleted }
    // Global orphan cleanup interval (ms). 0 = disabled.
    this.orphanCleanupIntervalMs = parsePositiveIntEnv(
      process.env.DAYTONA_ORPHAN_CLEANUP_INTERVAL_SECONDS,
      300,
      60
    ) * 1000;
    this.orphanCleanupMaxAgeMs = parsePositiveIntEnv(
      process.env.DAYTONA_ORPHAN_MAX_AGE_SECONDS,
      3600,
      300
    ) * 1000;
    this._directFailureTimestamps = [];
    this._directCircuitOpenUntilMs = 0;
    this.metrics = {
      acquireAttemptsTotal: 0,
      acquireSuccessTotal: 0,
      acquireFailuresTotal: 0,
      externalFirstTrySuccessTotal: 0,
      externalFirstTryFailureTotal: 0,
      onDemandAcquireAttemptsTotal: 0,
      onDemandAcquireSuccessTotal: 0,
      onDemandAcquireFailureTotal: 0,
      onDemandFirstAttemptSuccessTotal: 0,
      directAttemptedTotal: 0,
      directFirstAttemptSuccessTotal: 0,
      retryRecoveredSuccessTotal: 0,
      directAcquires: 0,
      fallbackAcquires: 0,
      prewarmAcquires: 0,
      prewarmProvisionSuccessTotal: 0,
      prewarmProvisionFailureTotal: 0,
      releaseReturnedToPoolTotal: 0,
      releaseDeletedTotal: 0,
      maintenanceRunsTotal: 0,
      allAcquireDurationsMs: [],
      directAcquireDurationsMs: [],
      fallbackAcquireDurationsMs: [],
      prewarmAcquireDurationsMs: [],
      lastAcquireAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      lastMaintenanceAt: null,
      directBudgetSkipTotal: 0,
      directCircuitOpenEventsTotal: 0,
      directCircuitSkipTotal: 0,
      livenessPingAttemptsTotal: 0,
      livenessPingFailureTotal: 0,
      idleTtlEvictionTotal: 0,
      // Per-skill metrics
      perSkillAcquires: new Map(),
      perSkillPrewarmHits: new Map()
    };

    this._startMaintenanceLoop();
    this._startOrphanCleanupLoop();
  }

  _resolveDirectCreateImageForSkill(skillId = "unknown") {
    if (skillId === "manim") {
      return this.directCreateImageManim ?? this.directCreateImage;
    }

    return this.directCreateImage;
  }

  _isSandboxImageCompatible(sandboxImageRef, requestedImageRef) {
    if (!requestedImageRef) {
      return true;
    }

    return sandboxImageRef === requestedImageRef;
  }

  _startMaintenanceLoop() {
    if (this.closed) {
      return;
    }

    if (this.prewarmSize <= 0 || this.prewarmCheckIntervalSec <= 0) {
      return;
    }

    // Skip prewarm entirely if no Daytona credentials are configured
    const hasCredentials = Boolean(
      process.env.DAYTONA_API_KEY ||
      process.env.DAYTONA_API_TOKEN ||
      process.env.DAYTONA_JWT ||
      process.env.DAYTONA_TOKEN ||
      process.env.DAYTONA_SERVER_URL ||
      process.env.DAYTONA_API_URL
    );
    if (!hasCredentials) {
      console.log("[Daytona] No credentials configured; prewarm disabled.");
      this.prewarmSize = 0;
      return;
    }

    const intervalMs = this.prewarmCheckIntervalSec * 1000;
    this._maintenanceTimer = setInterval(() => {
      this.metrics.maintenanceRunsTotal += 1;
      this.metrics.lastMaintenanceAt = new Date().toISOString();
      this._evictStaleSandboxes("maintenance");
      this._ensurePrewarmCapacity("maintenance", { force: false });
    }, intervalMs);

    if (typeof this._maintenanceTimer.unref === "function") {
      this._maintenanceTimer.unref();
    }

    this._ensurePrewarmCapacity("startup", { force: true });
  }

  _startOrphanCleanupLoop() {
    if (this.closed || this.orphanCleanupIntervalMs <= 0) {
      return;
    }
    // Only run if credentials are available
    const hasCredentials = Boolean(
      process.env.DAYTONA_API_KEY ||
      process.env.DAYTONA_API_TOKEN ||
      process.env.DAYTONA_JWT ||
      process.env.DAYTONA_TOKEN
    );
    if (!hasCredentials) return;

    this._orphanCleanupTimer = setInterval(() => {
      void this._cleanupOrganizationOrphans();
    }, this.orphanCleanupIntervalMs);

    if (typeof this._orphanCleanupTimer.unref === "function") {
      this._orphanCleanupTimer.unref();
    }
  }

  /**
   * List and delete sandboxes in the organization that are older than
   * orphanCleanupMaxAgeMs and not tracked in our pool. This prevents
   * disk quota exhaustion from leaked sandboxes (failed creates, crashes, etc).
   */
  async _cleanupOrganizationOrphans() {
    try {
      const daytona = await this._getDaytonaClient();
      const orgId = process.env.DAYTONA_ORGANIZATION_ID || process.env.DAYTONA_ORG_ID || null;
      const qs = new URLSearchParams({ limit: "100" });
      if (orgId) qs.set("organizationId", orgId);

      const response = await fetch(`https://app.daytona.io/api/sandbox?${qs.toString()}`, {
        headers: {
          Authorization: `Bearer ${process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_TOKEN || ""}`,
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) return;

      const payload = await response.json();
      const items = Array.isArray(payload) ? payload : (payload.items || []);
      const nowMs = Date.now();
      let deleted = 0;

      for (const item of items) {
        const id = item.id || item.sandboxId;
        if (!id) continue;

        // Skip if it's currently in our idle pool
        if (this.idleSandboxes.some((s) => s.workspaceId === id)) continue;

        // Skip if it's recently provisioned and still tracked
        const tracked = this.provisionedWorkspaces.get(id);
        if (tracked && !tracked.deleted && (nowMs - tracked.createdAt) < this.orphanCleanupMaxAgeMs) {
          continue;
        }

        const createdAt = item.createdAt || item.created_at;
        const ageMs = createdAt ? nowMs - new Date(createdAt).getTime() : Number.POSITIVE_INFINITY;
        if (ageMs > this.orphanCleanupMaxAgeMs) {
          try {
            await daytona.delete({ id });
            deleted += 1;
            if (tracked) tracked.deleted = true;
          } catch (err) {
            // Best-effort
          }
        }
      }

      if (deleted > 0) {
        console.log(`[Daytona][OrphanCleanup] Deleted ${deleted} orphaned sandbox(es).`);
      }
    } catch (err) {
      // Silently fail — orphan cleanup is best-effort
    }
  }

  _pushRollingMetric(list, value) {
    if (!Array.isArray(list) || !Number.isFinite(value)) {
      return;
    }

    list.push(value);
    if (list.length > this.metricsWindowSize) {
      list.splice(0, list.length - this.metricsWindowSize);
    }
  }

  _recordAcquireSuccess(mode, durationMs) {
    const normalizedDuration = Math.max(0, Number(durationMs) || 0);
    this.metrics.acquireSuccessTotal += 1;
    this.metrics.lastAcquireAt = new Date().toISOString();
    this._pushRollingMetric(this.metrics.allAcquireDurationsMs, normalizedDuration);

    if (mode === "direct") {
      this.metrics.directAcquires += 1;
      this._pushRollingMetric(this.metrics.directAcquireDurationsMs, normalizedDuration);
    } else if (mode === "fallback") {
      this.metrics.fallbackAcquires += 1;
      this._pushRollingMetric(this.metrics.fallbackAcquireDurationsMs, normalizedDuration);
    } else if (mode === "prewarm") {
      this.metrics.prewarmAcquires += 1;
      this._pushRollingMetric(this.metrics.prewarmAcquireDurationsMs, normalizedDuration);
    }

    this._maybeLogMetricsSummary();
  }

  _recordAcquireFailure(error, durationMs) {
    this.metrics.acquireFailuresTotal += 1;
    this.metrics.lastFailureAt = new Date().toISOString();
    this.metrics.lastFailureReason = truncateForLog(error instanceof Error ? error.message : String(error));
    const elapsed = Math.max(0, Number(durationMs) || 0);
    console.warn(
      `[Daytona][Metrics] Acquire failure #${this.metrics.acquireFailuresTotal} after ${elapsed}ms: ${this.metrics.lastFailureReason}`
    );
  }

  _buildMetricsSnapshot() {
    const acquireSuccessTotal = this.metrics.acquireSuccessTotal;
    const prewarmHitRatePct = round(percent(this.metrics.prewarmAcquires, acquireSuccessTotal));
    const fallbackRatePct = round(percent(this.metrics.fallbackAcquires, acquireSuccessTotal));
    const externalFirstTryTotal = this.metrics.externalFirstTrySuccessTotal + this.metrics.externalFirstTryFailureTotal;
    const externalFirstTrySuccessRatePct = round(percent(this.metrics.externalFirstTrySuccessTotal, externalFirstTryTotal));
    const onDemandFirstAttemptSuccessRatePct = round(
      percent(this.metrics.onDemandFirstAttemptSuccessTotal, this.metrics.onDemandAcquireAttemptsTotal)
    );
    const directFirstAttemptSuccessRatePct = round(
      percent(this.metrics.directFirstAttemptSuccessTotal, this.metrics.directAttemptedTotal)
    );
    const retryRecoveredSuccessRatePct = round(
      percent(this.metrics.retryRecoveredSuccessTotal, this.metrics.onDemandAcquireSuccessTotal)
    );

    return {
      acquireAttemptsTotal: this.metrics.acquireAttemptsTotal,
      acquireSuccessTotal,
      acquireFailuresTotal: this.metrics.acquireFailuresTotal,
      externalFirstTrySuccessTotal: this.metrics.externalFirstTrySuccessTotal,
      externalFirstTryFailureTotal: this.metrics.externalFirstTryFailureTotal,
      externalFirstTryTotal,
      externalFirstTrySuccessRatePct,
      onDemandAcquireAttemptsTotal: this.metrics.onDemandAcquireAttemptsTotal,
      onDemandAcquireSuccessTotal: this.metrics.onDemandAcquireSuccessTotal,
      onDemandAcquireFailureTotal: this.metrics.onDemandAcquireFailureTotal,
      onDemandFirstAttemptSuccessTotal: this.metrics.onDemandFirstAttemptSuccessTotal,
      onDemandFirstAttemptSuccessRatePct,
      retryRecoveredSuccessTotal: this.metrics.retryRecoveredSuccessTotal,
      retryRecoveredSuccessRatePct,
      directAttemptedTotal: this.metrics.directAttemptedTotal,
      directFirstAttemptSuccessTotal: this.metrics.directFirstAttemptSuccessTotal,
      directFirstAttemptSuccessRatePct,
      directAcquires: this.metrics.directAcquires,
      fallbackAcquires: this.metrics.fallbackAcquires,
      prewarmAcquires: this.metrics.prewarmAcquires,
      prewarmHitRatePct,
      fallbackRatePct,
      rollingWindowSize: this.metricsWindowSize,
      avgAcquireMs: round(average(this.metrics.allAcquireDurationsMs), 1),
      avgDirectAcquireMs: round(average(this.metrics.directAcquireDurationsMs), 1),
      avgFallbackAcquireMs: round(average(this.metrics.fallbackAcquireDurationsMs), 1),
      avgPrewarmAcquireMs: round(average(this.metrics.prewarmAcquireDurationsMs), 1),
      prewarmProvisionSuccessTotal: this.metrics.prewarmProvisionSuccessTotal,
      prewarmProvisionFailureTotal: this.metrics.prewarmProvisionFailureTotal,
      releaseReturnedToPoolTotal: this.metrics.releaseReturnedToPoolTotal,
      releaseDeletedTotal: this.metrics.releaseDeletedTotal,
      maintenanceRunsTotal: this.metrics.maintenanceRunsTotal,
      idleSandboxes: this.idleSandboxes.length,
      pendingWarmups: this.pendingWarmups,
      configuredPrewarmSize: this.prewarmSize,
      prewarmReplenishThreshold: this.prewarmReplenishThreshold,
      prewarmCheckIntervalSec: this.prewarmCheckIntervalSec,
      acquireRetryAttempts: this.acquireRetryAttempts,
      acquireRetryBaseDelayMs: this.acquireRetryBaseDelayMs,
      directCircuitFailureThreshold: this.directCircuitFailureThreshold,
      directCircuitWindowMs: this.directCircuitWindowMs,
      directCircuitCooldownMs: this.directCircuitCooldownMs,
      directCircuitOpen: this._isDirectCircuitOpen(),
      directCircuitOpenUntil: this._directCircuitOpenUntilMs > Date.now()
        ? new Date(this._directCircuitOpenUntilMs).toISOString()
        : null,
      directBudgetSkipTotal: this.metrics.directBudgetSkipTotal,
      directCircuitSkipTotal: this.metrics.directCircuitSkipTotal,
      directCircuitOpenEventsTotal: this.metrics.directCircuitOpenEventsTotal,
      lastAcquireAt: this.metrics.lastAcquireAt,
      lastFailureAt: this.metrics.lastFailureAt,
      lastFailureReason: this.metrics.lastFailureReason,
      lastMaintenanceAt: this.metrics.lastMaintenanceAt,
      livenessPingAttemptsTotal: this.metrics.livenessPingAttemptsTotal,
      livenessPingFailureTotal: this.metrics.livenessPingFailureTotal,
      idleTtlEvictionTotal: this.metrics.idleTtlEvictionTotal,
      idleSandboxTtlMs: this.idleSandboxTtlMs,
      livenessPingTimeoutMs: this.livenessPingTimeoutMs
    };
  }

  _maybeLogMetricsSummary(force = false) {
    if (!force && this.metrics.acquireSuccessTotal > 0 && this.metrics.acquireSuccessTotal % this.metricsLogEvery !== 0) {
      return;
    }

    const snapshot = this._buildMetricsSnapshot();
    console.log(
      `[Daytona][Metrics] acquires=${snapshot.acquireSuccessTotal}/${snapshot.acquireAttemptsTotal} failures=${snapshot.acquireFailuresTotal} prewarmHit=${snapshot.prewarmHitRatePct}% fallbackRate=${snapshot.fallbackRatePct}% avgMs=${snapshot.avgAcquireMs} directAvgMs=${snapshot.avgDirectAcquireMs} fallbackAvgMs=${snapshot.avgFallbackAcquireMs} idle=${snapshot.idleSandboxes}/${snapshot.configuredPrewarmSize}`
    );
  }

  getMetricsSnapshot() {
    return this._buildMetricsSnapshot();
  }

  getLastAcquireDiagnostics() {
    return this.lastAcquireDiagnostics;
  }

  _isDirectCircuitOpen(nowMs = Date.now()) {
    return this._directCircuitOpenUntilMs > nowMs;
  }

  _pruneDirectFailures(nowMs = Date.now()) {
    const oldestAllowed = nowMs - this.directCircuitWindowMs;
    this._directFailureTimestamps = this._directFailureTimestamps.filter((ts) => ts >= oldestAllowed);
  }

  _recordDirectCreateFailure(nowMs = Date.now(), diagnostics = null) {
    this._pruneDirectFailures(nowMs);
    this._directFailureTimestamps.push(nowMs);

    if (!this._isDirectCircuitOpen(nowMs) && this._directFailureTimestamps.length >= this.directCircuitFailureThreshold) {
      this._directCircuitOpenUntilMs = nowMs + this.directCircuitCooldownMs;
      this.metrics.directCircuitOpenEventsTotal += 1;
      const openUntilIso = new Date(this._directCircuitOpenUntilMs).toISOString();
      console.warn(
        `[Daytona][CircuitBreaker] Opened direct create circuit for ${this.directCircuitCooldownMs}ms after ${this._directFailureTimestamps.length} failures. Open until ${openUntilIso}.`
      );
      if (diagnostics?.direct) {
        diagnostics.direct.circuitOpened = true;
        diagnostics.direct.circuitOpenUntil = openUntilIso;
      }
    }
  }

  _recordDirectCreateSuccess(nowMs = Date.now()) {
    this._pruneDirectFailures(nowMs);
    this._directFailureTimestamps = [];
  }

  _prepareAcquireDiagnostics({ skillId, reason, turnDeadlineAtMs, acquireStartedAt }) {
    const initialRemainingBudgetMs = getRemainingBudgetMs(turnDeadlineAtMs);
    return {
      skillId,
      reason,
      startedAt: new Date(acquireStartedAt).toISOString(),
      startedAtMs: acquireStartedAt,
      initialRemainingBudgetMs: Number.isFinite(initialRemainingBudgetMs)
        ? Math.max(0, Math.floor(initialRemainingBudgetMs))
        : null,
      turnDeadlineAtMs: Number.isFinite(turnDeadlineAtMs) ? Number(turnDeadlineAtMs) : null,
      retryAttempts: 0,
      retryDelaysMs: [],
      directAttemptedAny: false,
      prewarmHit: false,
      success: null,
      acquireDurationMs: null,
      completedAt: null,
      creationMode: null,
      source: "ondemand",
      direct: {
        attempted: false,
        skipped: false,
        skipReason: null,
        timeoutSec: null,
        durationMs: null,
        error: null,
        circuitOpenAtStart: this._isDirectCircuitOpen(),
        circuitOpened: false,
        circuitOpenUntil: this._isDirectCircuitOpen() ? new Date(this._directCircuitOpenUntilMs).toISOString() : null
      },
      fallback: {
        attempted: false,
        skipped: false,
        skipReason: null,
        timeoutSec: null,
        durationMs: null,
        error: null
      }
    };
  }

  _finalizeAcquireDiagnostics(diagnostics, { success, creationMode = null, acquireDurationMs = null }) {
    if (!diagnostics) {
      return;
    }

    diagnostics.success = Boolean(success);
    diagnostics.creationMode = creationMode;
    diagnostics.source = creationMode ?? diagnostics.source;
    diagnostics.internalFirstAttempt = Number(diagnostics.retryAttempts ?? 0) <= 1;
    diagnostics.acquireDurationMs = Number.isFinite(acquireDurationMs)
      ? Math.max(0, Math.floor(acquireDurationMs))
      : diagnostics.acquireDurationMs;
    diagnostics.completedAt = new Date().toISOString();
    this.lastAcquireDiagnostics = diagnostics;
  }

  /**
   * Lightweight DNS pre-flight check.  Resolves the Daytona API hostname
   * before attempting a full HTTP create call so we can fail fast (< 3 s)
   * instead of waiting for the SDK's 20 s HTTP timeout when DNS is down.
   */
  async _checkDnsHealth(timeoutMs = 3000) {
    const hostname = this._daytonaHostname ?? "app.daytona.io";
    try {
      await Promise.race([
        dns.lookup(hostname),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`DNS pre-flight timed out after ${timeoutMs}ms for ${hostname}`)), timeoutMs)
        )
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async _resolveOrganizationId() {
    const existing = process.env.DAYTONA_ORGANIZATION_ID
      || process.env.DAYTONA_ORG_ID
      || process.env.DAYTONA_ORG;
    if (existing && existing.trim()) {
      process.env.DAYTONA_ORGANIZATION_ID = existing.trim();
      return;
    }

    // Daytona accepts either an API key or a JWT token in the Bearer header
    const apiKey = process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_TOKEN;
    const jwt = process.env.DAYTONA_JWT || process.env.DAYTONA_TOKEN;
    const token = (apiKey || jwt || "").trim();
    if (!token) return;

    const apiBase = (process.env.DAYTONA_API_URL || process.env.DAYTONA_SERVER_URL || "https://app.daytona.io/api")
      .replace(/\/+$/, "");

    try {
      const response = await fetch(`${apiBase}/organizations`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (response.ok) {
        const payload = await response.json();
        // Daytona list responses are typically { items: [...] } or just [...]
        const orgs = Array.isArray(payload) ? payload : (payload.items || []);
        const org = orgs[0];
        const orgId = org?.id ?? org?.organizationId ?? null;
        if (orgId && String(orgId).trim()) {
          process.env.DAYTONA_ORGANIZATION_ID = String(orgId).trim();
          console.log(`[Daytona] Auto-resolved organization ID via API: ${process.env.DAYTONA_ORGANIZATION_ID}`);
        } else {
          console.warn("[Daytona] API returned organizations list but no id field found in first entry.");
        }
      } else {
        const errText = await response.text().catch(() => "unknown");
        console.warn(`[Daytona] Organization API returned ${response.status}, trying sandbox fallback...`);
        await this._resolveOrganizationIdFromSandbox(apiBase, token);
      }
    } catch (err) {
      console.warn("[Daytona] Failed to auto-resolve organization ID from API, trying sandbox fallback:", err.message);
      await this._resolveOrganizationIdFromSandbox(apiBase, token);
    }
  }

  async _resolveOrganizationIdFromSandbox(apiBase, token) {
    try {
      const sandboxResponse = await fetch(`${apiBase}/sandbox?limit=1`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (!sandboxResponse.ok) {
        const text = await sandboxResponse.text().catch(() => "unknown");
        console.warn(`[Daytona] Sandbox fallback API error ${sandboxResponse.status}: ${text}`);
        return;
      }

      const payload = await sandboxResponse.json();
      const items = Array.isArray(payload) ? payload : payload.items || [];
      if (items.length === 0) {
        console.warn("[Daytona] No sandboxes found in fallback. Cannot infer organization ID.");
        return;
      }

      const orgId = items[0]?.organizationId ?? null;
      if (orgId && String(orgId).trim()) {
        process.env.DAYTONA_ORGANIZATION_ID = String(orgId).trim();
        console.log(`[Daytona] Auto-resolved organization ID via sandbox fallback: ${process.env.DAYTONA_ORGANIZATION_ID}`);
      } else {
        console.warn("[Daytona] Sandbox missing organizationId field:", JSON.stringify(Object.keys(items[0])));
      }
    } catch (err) {
      console.warn("[Daytona] Sandbox fallback failed:", err.message);
    }
  }

  async _getDaytonaClient() {
    if (!this.daytona) {
      try {
        await this._resolveOrganizationId();
        this.daytona = new Daytona();
        // Extract hostname for DNS pre-flight checks
        try {
          const targetUrl = process.env.DAYTONA_TARGET_URL || process.env.DAYTONA_SERVER_URL || "";
          if (targetUrl) {
            this._daytonaHostname = new URL(targetUrl).hostname;
          }
        } catch { /* best-effort hostname extraction */ }
      } catch (err) {
        console.error("[Daytona] Initialization Failed:", err.message);
        throw err;
      }
    }
    return this.daytona;
  }

  async _provisionWorkspace({ skillId = "unknown", reason = "acquire", turnDeadlineAtMs = null, diagnostics = null } = {}) {
    const daytona = await this._getDaytonaClient();

    // DNS pre-flight: skip both direct and fallback paths early when DNS is
    // unreachable — avoids burning 40+ seconds on two HTTP timeouts.
    const dnsHealthy = await this._checkDnsHealth();
    if (!dnsHealthy) {
      const dnsError = new Error(
        `DNS pre-flight failed for Daytona API. Skipping workspace provisioning (skill=${skillId}, reason=${reason}).`
      );
      console.warn(`[Daytona] ${dnsError.message}`);
      if (diagnostics?.direct) {
        diagnostics.direct.skipped = true;
        diagnostics.direct.skipReason = "dns_preflight_failed";
        diagnostics.direct.error = dnsError.message;
      }
      if (diagnostics?.fallback) {
        diagnostics.fallback.skipped = true;
        diagnostics.fallback.skipReason = "dns_preflight_failed";
        diagnostics.fallback.error = dnsError.message;
      }
      throw dnsError;
    }
    const acquireStartedAt = Date.now();
    const resolvedDirectImage = this._resolveDirectCreateImageForSkill(skillId);
    let workspace;
    let workspaceId = `gve-${crypto.randomUUID().slice(0, 8)}`;
    let directCreateDurationMs = 0;
    let directError = null;

    // Track this workspace ID for orphan cleanup regardless of success/failure
    this.provisionedWorkspaces.set(workspaceId, { workspace: null, createdAt: Date.now(), deleted: false });

    const directRemainingBudgetMs = getRemainingBudgetMs(turnDeadlineAtMs);
    const circuitOpen = this._isDirectCircuitOpen();
    const shouldSkipDirectForBudget = Number.isFinite(directRemainingBudgetMs)
      && directRemainingBudgetMs < this.directCreateSkipBudgetMs;
    const shouldSkipDirect = shouldSkipDirectForBudget || circuitOpen;

    if (diagnostics?.direct) {
      diagnostics.direct.circuitOpenAtStart = circuitOpen;
      diagnostics.direct.circuitOpenUntil = circuitOpen ? new Date(this._directCircuitOpenUntilMs).toISOString() : null;
    }

    if (shouldSkipDirect) {
      const skipReason = shouldSkipDirectForBudget
        ? `low remaining budget (${Math.max(0, Math.floor(directRemainingBudgetMs))}ms < ${this.directCreateSkipBudgetMs}ms)`
        : `direct create circuit open until ${new Date(this._directCircuitOpenUntilMs).toISOString()}`;
      directError = new Error(`Skipped direct create due to ${skipReason}.`);
      directCreateDurationMs = Math.max(0, Date.now() - acquireStartedAt);
      console.warn(`[Daytona] ${directError.message} Trying fallback...`);
      if (shouldSkipDirectForBudget) {
        this.metrics.directBudgetSkipTotal += 1;
      } else {
        this.metrics.directCircuitSkipTotal += 1;
      }

      if (diagnostics?.direct) {
        diagnostics.direct.attempted = false;
        diagnostics.direct.skipped = true;
        diagnostics.direct.skipReason = skipReason;
        diagnostics.direct.durationMs = directCreateDurationMs;
        diagnostics.direct.error = directError.message;
      }
    } else {
      if (diagnostics?.direct) {
        diagnostics.direct.attempted = true;
        diagnostics.directAttemptedAny = true;
      }
      try {
        const directTimeoutSec = capCreateTimeoutSeconds(this.directCreateTimeoutSec, directRemainingBudgetMs);
        if (diagnostics?.direct) {
          diagnostics.direct.timeoutSec = directTimeoutSec;
        }
        if (directTimeoutSec <= 0) {
          throw createAcquireBudgetError(directRemainingBudgetMs, "direct create");
        }

        const directCreateStartedAt = Date.now();
        const directCreateOptions = resolvedDirectImage
          ? { id: workspaceId, image: resolvedDirectImage }
          : { id: workspaceId };
        workspace = await daytona.create(directCreateOptions, { timeout: directTimeoutSec });
        directCreateDurationMs = Date.now() - directCreateStartedAt;
        this._recordDirectCreateSuccess();
        const tracked = this.provisionedWorkspaces.get(workspaceId);
        if (tracked) tracked.workspace = workspace;
        console.log(
          `[Daytona] Workspace ${workspaceId} created in ${directCreateDurationMs}ms (${reason}, skill=${skillId}).`
        );
        if (diagnostics?.direct) {
          diagnostics.direct.durationMs = directCreateDurationMs;
          diagnostics.direct.error = null;
        }
        if (diagnostics) {
          diagnostics.creationMode = "direct";
          diagnostics.source = "direct";
          diagnostics.acquireDurationMs = Date.now() - acquireStartedAt;
        }
        return {
          workspace,
          workspaceId,
          creationMode: "direct",
          acquireDurationMs: Date.now() - acquireStartedAt,
          imageRef: resolvedDirectImage ?? null
        };
      } catch (err) {
        directError = err;
        directCreateDurationMs = Math.max(0, Date.now() - acquireStartedAt);
        this._recordDirectCreateFailure(Date.now(), diagnostics);
        if (diagnostics?.direct) {
          diagnostics.direct.durationMs = directCreateDurationMs;
          diagnostics.direct.error = err instanceof Error ? err.message : String(err);
        }
        console.warn(
          `[Daytona] Failed to create workspace with direct options after ${directCreateDurationMs}ms, trying default... (${err.message})`
        );
      }
    }

    const fallbackRemainingBudgetMs = getRemainingBudgetMs(turnDeadlineAtMs);
    const fallbackTimeoutSec = capCreateTimeoutSeconds(this.fallbackCreateTimeoutSec, fallbackRemainingBudgetMs);
    if (diagnostics?.fallback) {
      diagnostics.fallback.timeoutSec = fallbackTimeoutSec;
    }
    if (fallbackTimeoutSec <= 0) {
      const totalDurationMs = Date.now() - acquireStartedAt;
      const directMessage = directError instanceof Error ? directError.message : String(directError);
      const budgetError = createAcquireBudgetError(fallbackRemainingBudgetMs, "fallback create");
      if (diagnostics?.fallback) {
        diagnostics.fallback.skipped = true;
        diagnostics.fallback.skipReason = budgetError.message;
        diagnostics.fallback.error = budgetError.message;
        diagnostics.fallback.durationMs = 0;
      }
      const combinedError = new Error(
        `Daytona acquire failed after ${totalDurationMs}ms. direct=${truncateForLog(directMessage)} | fallback=skipped: ${truncateForLog(
          budgetError.message
        )}`
      );
      combinedError.code = budgetError.code;
      throw combinedError;
    }

    const fallbackCreateStartedAt = Date.now();
    if (diagnostics?.fallback) {
      diagnostics.fallback.attempted = true;
    }
    try {
      const fallbackCreateOptions = resolvedDirectImage
        ? { image: resolvedDirectImage }
        : undefined;
      workspace = await daytona.create(fallbackCreateOptions, { timeout: fallbackTimeoutSec });
      workspaceId = workspace.id;
      const tracked2 = this.provisionedWorkspaces.get(workspaceId);
      if (tracked2) tracked2.workspace = workspace;
      const fallbackDurationMs = Date.now() - fallbackCreateStartedAt;
      const totalAcquireMs = Date.now() - acquireStartedAt;
      if (diagnostics?.fallback) {
        diagnostics.fallback.durationMs = fallbackDurationMs;
        diagnostics.fallback.error = null;
      }
      if (diagnostics) {
        diagnostics.creationMode = "fallback";
        diagnostics.source = "fallback";
        diagnostics.acquireDurationMs = totalAcquireMs;
      }
      console.log(
        `[Daytona] Fallback workspace ${workspaceId} created in ${fallbackDurationMs}ms (total acquire ${totalAcquireMs}ms, ${reason}, skill=${skillId}).`
      );
      return {
        workspace,
        workspaceId,
        creationMode: "fallback",
        acquireDurationMs: totalAcquireMs,
        imageRef: resolvedDirectImage ?? null
      };
    } catch (fallbackErr) {
      const totalDurationMs = Date.now() - acquireStartedAt;
      const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      const directMessage = directError instanceof Error ? directError.message : String(directError);
      if (diagnostics?.fallback) {
        diagnostics.fallback.durationMs = Date.now() - fallbackCreateStartedAt;
        diagnostics.fallback.error = fallbackMessage;
      }
      throw new Error(
        `Daytona acquire failed after ${totalDurationMs}ms. direct=${truncateForLog(directMessage)} | fallback=${truncateForLog(fallbackMessage)}`
      );
    }
  }

  async _provisionWorkspaceWithRetry({ skillId = "unknown", reason = "acquire", turnDeadlineAtMs = null, diagnostics = null } = {}) {
    let lastError = null;

    for (let attempt = 1; attempt <= this.acquireRetryAttempts; attempt += 1) {
      try {
        if (diagnostics) {
          diagnostics.retryAttempts = attempt;
        }
        return await this._provisionWorkspace({ skillId, reason, turnDeadlineAtMs, diagnostics });
      } catch (error) {
        lastError = error;
        const remainingBudgetMs = getRemainingBudgetMs(turnDeadlineAtMs);
        const hasAttemptBudget = !Number.isFinite(remainingBudgetMs) || remainingBudgetMs >= MIN_ACQUIRE_ATTEMPT_WINDOW_MS;
        const canRetry =
          attempt < this.acquireRetryAttempts &&
          hasAttemptBudget &&
          !isAcquireBudgetExhaustedError(error) &&
          isRetryableProvisionError(error);
        if (!canRetry) {
          throw error;
        }

        const baseBackoffMs = this.acquireRetryBaseDelayMs * (2 ** (attempt - 1));
        const jitterMs = Math.floor(baseBackoffMs * Math.random() * 0.1);
        const backoffMs = baseBackoffMs + jitterMs;
        console.warn(
          `[Daytona] Acquire retry ${attempt}/${this.acquireRetryAttempts} in ${backoffMs}ms for skill ${skillId} (remaining budget: ${Number.isFinite(
            remainingBudgetMs
          ) ? `${Math.max(0, Math.floor(remainingBudgetMs))}ms` : "unbounded"}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        if (diagnostics) {
          diagnostics.retryDelaysMs.push(backoffMs);
        }
        await delayMs(backoffMs);
      }
    }

    throw lastError ?? new Error("Daytona acquire failed after retries.");
  }

  /**
   * Evict idle sandboxes whose container has exceeded the idle TTL.
   * Stale sandboxes are deleted best-effort and removed from the pool.
   */
  _evictStaleSandboxes(reason = "maintenance") {
    if (this.idleSandboxTtlMs <= 0 || this.idleSandboxes.length === 0) {
      return 0;
    }

    const nowMs = Date.now();
    const before = this.idleSandboxes.length;
    const stale = this.idleSandboxes.filter(
      (s) => s.idledAt && (nowMs - s.idledAt) > this.idleSandboxTtlMs
    );
    this.idleSandboxes = this.idleSandboxes.filter(
      (s) => !s.idledAt || (nowMs - s.idledAt) <= this.idleSandboxTtlMs
    );

    const evicted = before - this.idleSandboxes.length;
    if (evicted > 0) {
      this.metrics.idleTtlEvictionTotal += evicted;
      console.log(
        `[Daytona][Pool] Evicted ${evicted} stale idle sandbox(es) (TTL=${this.idleSandboxTtlMs}ms, reason=${reason}). idle=${this.idleSandboxes.length}/${this.prewarmSize}`
      );
      for (const s of stale) {
        void this._deleteWorkspace(s.workspace, s.workspaceId, `idle_ttl_expired_${reason}`);
      }
    }

    return evicted;
  }

  _ensurePrewarmCapacity(skillId = "unknown", { force = false } = {}) {
    if (this.closed) {
      return;
    }

    if (this.prewarmSize <= 0) {
      return;
    }

    const available = this.idleSandboxes.length + this.pendingWarmups;
    const replenishBelow = Math.max(1, Math.ceil(this.prewarmSize * this.prewarmReplenishThreshold));
    if (!force && available >= replenishBelow) {
      return;
    }

    const deficit = this.prewarmSize - available;
    if (deficit <= 0) {
      return;
    }

    for (let index = 0; index < deficit; index += 1) {
      this.pendingWarmups += 1;

      void this._provisionWorkspaceWithRetry({ skillId, reason: "prewarm" })
        .then(({ workspace, workspaceId, creationMode, acquireDurationMs, imageRef }) => {
          this.metrics.prewarmProvisionSuccessTotal += 1;
          if (this.closed) {
            void this._deleteWorkspace(workspace, workspaceId, "pool_closed");
            return;
          }
          if (this.idleSandboxes.length >= this.prewarmSize) {
            void this._deleteWorkspace(workspace, workspaceId, "prewarm_overflow");
            return;
          }

          this.idleSandboxes.push({ workspace, workspaceId, idledAt: Date.now(), imageRef: imageRef ?? null, skillId: skillId ?? "unknown" });
          this.metrics.perSkillPrewarmHits.set(skillId, (this.metrics.perSkillPrewarmHits.get(skillId) || 0) + 1);
          console.log(
            `[Daytona] Prewarmed sandbox ${workspaceId} ready via ${creationMode} in ${acquireDurationMs}ms (skill=${skillId}). idle=${this.idleSandboxes.length}/${this.prewarmSize}`
          );
        })
        .catch((error) => {
          this.metrics.prewarmProvisionFailureTotal += 1;
          console.warn(`[Daytona] Prewarm failed: ${error instanceof Error ? error.message : String(error)}`);
        })
        .finally(() => {
          this.pendingWarmups = Math.max(0, this.pendingWarmups - 1);
        });
    }
  }

  requestWarmup(skillId = "unknown") {
    this._ensurePrewarmCapacity(skillId, { force: true });
  }

  _createSandboxHandle({ workspaceId, workspace, source = "ondemand", imageRef = null, skillId = "unknown" }) {
    const handle = {
      workspaceId,
      _workspace: workspace,
      _reusable: true,
      _source: source,
      _imageRef: imageRef,
      _lastSkillId: skillId,
      execute: async (payloadStr) => {
        const runnerPath = path.join(__dirname, "runner-script.js");
        const runnerScript = await fs.readFile(runnerPath, "utf-8");

        // We run node via -e. We wrap the payload string into base64 to avoid quote escaping hell inside bash
        const payloadB64 = Buffer.from(payloadStr).toString("base64");

        // Let runner-script decode process.argv[1] from base64
        const execCode = `
          ${runnerScript}
          let str = Buffer.from(process.argv[1], 'base64').toString('utf-8');
          try {
            const result = executePayload(str);
            console.log('__DAYTONA_RESULT__' + result + '__DAYTONA_RESULT_END__');
          } catch(err) {
            console.log('__DAYTONA_RESULT__' + JSON.stringify({ success: false, error: err.message }) + '__DAYTONA_RESULT_END__');
          }
        `;

        console.log(`[Daytona] Executing payload on ${workspaceId}...`);

        // ── Liveness ping ────────────────────────────────────────────────────
        // Verify the container is actually network-reachable before sending the
        // full Node.js payload. A prewarmed sandbox can sit in the pool for
        // minutes; its container IP can expire while it looks idle-healthy.
        this.metrics.livenessPingAttemptsTotal += 1;
        const pingStartedAt = Date.now();
        const pingTimeoutMs = this.livenessPingTimeoutMs;
        try {
          await Promise.race([
            workspace.process.executeCommand("echo ok"),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Liveness ping timed out after ${pingTimeoutMs}ms`)),
                pingTimeoutMs
              )
            )
          ]);
        } catch (pingErr) {
          this.metrics.livenessPingFailureTotal += 1;
          handle._reusable = false;
          console.warn(
            `[Daytona] [WARN] Liveness ping FAILED for ${workspaceId} in ${Date.now() - pingStartedAt}ms: ${pingErr.message}`
          );
          const staleError = new Error(
            `Sandbox ${workspaceId} failed liveness ping (stale container): ${pingErr.message}`
          );
          staleError.code = "SANDBOX_STALE_IP";
          throw staleError;
        }
        console.log(`[Daytona] Liveness ping OK for ${workspaceId} in ${Date.now() - pingStartedAt}ms.`);
        // ─────────────────────────────────────────────────────────────────────

        let execResult;
        const bashCmd = `node --input-type=module -e "$(echo '${Buffer.from(execCode).toString("base64")}' | base64 -d)" "${payloadB64}"`;

        console.log(`[Daytona] [TRACE] Command:\n${bashCmd.slice(0, 500)}${bashCmd.length > 500 ? "..." : ""}`);

        const executionStartedAt = Date.now();
        try {
          // Allow up to 120s for skill execution (Manim renders need 30–90s)
          execResult = await workspace.process.executeCommand(bashCmd, undefined, undefined, 120000);
        } catch (err) {
          handle._reusable = false;
          console.error(`[Daytona] [ERROR] Execution failed after ${Date.now() - executionStartedAt}ms:`, err.message);
          throw new Error(`Failed to execute on Daytona workspace: ${err.message}`);
        }

        console.log(`[Daytona] [TRACE] Execution finished in ${Date.now() - executionStartedAt}ms.`);

        const out = execResult.result || execResult.stdout || execResult.output || "";
        console.log(`[Daytona] [TRACE] Raw result (first 200 chars):\n${out.slice(0, 200)}...`);

        const m = out.match(/__DAYTONA_RESULT__(.*)__DAYTONA_RESULT_END__/s);
        if (m && m[1]) {
          return JSON.parse(m[1].trim());
        }

        handle._reusable = false;
        throw new Error(`Invalid output from Daytona sandbox. Output: ${out.slice(0, 100)}...`);
      }
    };

    return handle;
  }

  /**
   * Get filesystem API for a sandbox
   * @param {string} sandboxId - Workspace ID
   * @param {object} workspace - Daytona workspace
   * @returns {SandboxFileSystem}
   */
  getFileSystem(sandboxId, workspace) {
    return createSandboxFileSystem(sandboxId, workspace);
  }

  /**
   * Get build manager instance for sandbox
   * @param {string} sandboxId - Sandbox identifier
   * @param {object} workspace - workspace.process accessor
   * @param {object} filesystem - SandboxFileSystem instance
   * @returns {BuildManager}
   */
  getBuildManager(sandboxId, workspace, filesystem) {
    const sandbox = { id: sandboxId };
    return createBuildManager(sandbox, workspace, filesystem);
  }

  /**
   * Get artifact storage instance for persisting results
   * @param {object} config - Configuration
   * @returns {ArtifactStorage}
   */
  getArtifactStorage(config = {}) {
    // Use default filesystem backend in artifacts directory
    const defaultConfig = {
      backend: 'filesystem',
      basePath: config.basePath || './artifacts'
    };
    return createArtifactStorage({ ...defaultConfig, ...config });
  }

  async acquire(requirements) {
    if (this.closed) {
      const closedError = new Error("Sandbox pool is shut down and cannot acquire new sandboxes.");
      closedError.code = "POOL_SHUTDOWN";
      throw closedError;
    }

    const normalizedSkillId = requirements?.skillId ?? "unknown";
    const requestedImageRef = this._resolveDirectCreateImageForSkill(normalizedSkillId);
    const turnDeadlineAtMs = Number.isFinite(requirements?.turnDeadlineAtMs)
      ? Number(requirements.turnDeadlineAtMs)
      : null;
    this.metrics.acquireAttemptsTotal += 1;
    const acquireStartedAt = Date.now();
    const acquireDiagnostics = this._prepareAcquireDiagnostics({
      skillId: normalizedSkillId,
      reason: "acquire",
      turnDeadlineAtMs,
      acquireStartedAt
    });
    this._evictStaleSandboxes("acquire");
    this._ensurePrewarmCapacity(normalizedSkillId, { force: false });

    // Try to acquire a healthy idle sandbox with liveness check
    // Prefer sandboxes tagged with the matching skillId first
    const deferredIdleSandboxes = [];
    const skillMatches = [];
    const skillMismatches = [];

    while (this.idleSandboxes.length > 0) {
      const reused = this.idleSandboxes.pop();
      if (!this._isSandboxImageCompatible(reused?.imageRef ?? null, requestedImageRef)) {
        deferredIdleSandboxes.push(reused);
        continue;
      }
      if (reused.skillId === normalizedSkillId) {
        skillMatches.push(reused);
      } else {
        skillMismatches.push(reused);
      }
    }

    // Re-assemble: skill matches first, then mismatches, then deferred
    const orderedPool = [...skillMatches, ...skillMismatches];
    this.idleSandboxes = orderedPool;

    while (this.idleSandboxes.length > 0) {
      const reused = this.idleSandboxes.pop();
      
      // ── Liveness ping before reuse ─────────────────────────────────────────
      // Verify the idle sandbox is still responsive before handing it to executor
      const pingStartedAt = Date.now();
      let pingSuccess = false;
      try {
        await Promise.race([
          reused.workspace.process.executeCommand("echo ok"),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(`Liveness ping timed out after ${this.livenessPingTimeoutMs}ms`)),
              this.livenessPingTimeoutMs
            )
          )
        ]);
        pingSuccess = true;
        console.log(
          `[Daytona] Liveness ping OK for idle sandbox ${reused.workspaceId} in ${Date.now() - pingStartedAt}ms.`
        );
      } catch (pingErr) {
        this.metrics.livenessPingFailureTotal += 1;
        console.warn(
          `[Daytona] [WARN] Idle sandbox ${reused.workspaceId} failed liveness ping (${Date.now() - pingStartedAt}ms): ${pingErr.message}. Evicting and trying next...`
        );
        // Evict the stale sandbox
        void this._deleteWorkspace(reused.workspace, reused.workspaceId, "liveness_ping_failed");
        continue; // Try next idle sandbox
      }
      // ─────────────────────────────────────────────────────────────────────
      
      if (pingSuccess) {
        console.log(
          `[Daytona] Reusing prewarmed sandbox ${reused.workspaceId} for skill ${normalizedSkillId}. idle=${this.idleSandboxes.length}/${this.prewarmSize}`
        );
        this._ensurePrewarmCapacity(normalizedSkillId, { force: true });
        this._recordAcquireSuccess("prewarm", Date.now() - acquireStartedAt);
        this.metrics.externalFirstTrySuccessTotal += 1;
        acquireDiagnostics.prewarmHit = true;
        acquireDiagnostics.creationMode = "prewarm";
        acquireDiagnostics.source = "prewarm";
        acquireDiagnostics.livenessPingMs = Date.now() - pingStartedAt;
        this._finalizeAcquireDiagnostics(acquireDiagnostics, {
          success: true,
          creationMode: "prewarm",
          acquireDurationMs: Date.now() - acquireStartedAt
        });
        const handle = this._createSandboxHandle({
          workspaceId: reused.workspaceId,
          workspace: reused.workspace,
          source: "prewarm",
          imageRef: reused.imageRef ?? null,
          skillId: normalizedSkillId
        });
        if (deferredIdleSandboxes.length > 0) {
          this.idleSandboxes.push(...deferredIdleSandboxes);
        }
        handle._acquireDiagnostics = acquireDiagnostics;
        return handle;
      }
    }
    if (deferredIdleSandboxes.length > 0) {
      this.idleSandboxes.push(...deferredIdleSandboxes);
    }

    console.log(
      `[Daytona] Acquiring on-demand sandbox for skill ${normalizedSkillId} (direct timeout=${this.directCreateTimeoutSec}s, fallback timeout=${this.fallbackCreateTimeoutSec}s)...`
    );
    this.metrics.onDemandAcquireAttemptsTotal += 1;

    let provisioned;
    try {
      provisioned = await this._provisionWorkspaceWithRetry({
        skillId: normalizedSkillId,
        reason: "acquire",
        turnDeadlineAtMs,
        diagnostics: acquireDiagnostics
      });
    } catch (error) {
      this._recordAcquireFailure(error, Date.now() - acquireStartedAt);
      this.metrics.externalFirstTryFailureTotal += 1;
      this.metrics.onDemandAcquireFailureTotal += 1;
      this.metrics.perSkillAcquires.set(
        normalizedSkillId,
        (this.metrics.perSkillAcquires.get(normalizedSkillId) || 0) + 1
      );
      if (acquireDiagnostics?.directAttemptedAny) {
        this.metrics.directAttemptedTotal += 1;
      }
      this._finalizeAcquireDiagnostics(acquireDiagnostics, {
        success: false,
        creationMode: null,
        acquireDurationMs: Date.now() - acquireStartedAt
      });
      if (error && typeof error === "object") {
        error.acquireDiagnostics = acquireDiagnostics;
      }
      throw error;
    }

    this._recordAcquireSuccess(provisioned.creationMode, Date.now() - acquireStartedAt);
    this.metrics.externalFirstTrySuccessTotal += 1;
    this.metrics.onDemandAcquireSuccessTotal += 1;
    this.metrics.perSkillAcquires.set(
      normalizedSkillId,
      (this.metrics.perSkillAcquires.get(normalizedSkillId) || 0) + 1
    );
    if (acquireDiagnostics?.directAttemptedAny) {
      this.metrics.directAttemptedTotal += 1;
    }
    const internalFirstAttempt = Number(acquireDiagnostics?.retryAttempts ?? 0) <= 1;
    if (internalFirstAttempt) {
      this.metrics.onDemandFirstAttemptSuccessTotal += 1;
      if (provisioned.creationMode === "direct") {
        this.metrics.directFirstAttemptSuccessTotal += 1;
      }
    } else {
      this.metrics.retryRecoveredSuccessTotal += 1;
    }
    this._finalizeAcquireDiagnostics(acquireDiagnostics, {
      success: true,
      creationMode: provisioned.creationMode,
      acquireDurationMs: Date.now() - acquireStartedAt
    });

    this._ensurePrewarmCapacity(normalizedSkillId, { force: false });

    const handle = this._createSandboxHandle({
      workspaceId: provisioned.workspaceId,
      workspace: provisioned.workspace,
      source: provisioned.creationMode,
      imageRef: provisioned.imageRef ?? null,
      skillId: normalizedSkillId
    });
    handle._acquireDiagnostics = acquireDiagnostics;
    return handle;
  }

  async _deleteWorkspace(workspace, workspaceId, reason = "release") {
    try {
      const daytona = await this._getDaytonaClient();
      await daytona.delete(workspace);
      const tracked = this.provisionedWorkspaces.get(workspaceId);
      if (tracked) tracked.deleted = true;
      console.log(`[Daytona] Deleted sandbox ${workspaceId} (${reason}).`);
    } catch (err) {
      console.error(`[Daytona] Error deleting workspace ${workspaceId}:`, err.message);
    }
    // Prune old tracking entries to prevent unbounded growth
    const maxTracked = 500;
    if (this.provisionedWorkspaces.size > maxTracked) {
      const now = Date.now();
      for (const [key, value] of this.provisionedWorkspaces.entries()) {
        if (value.deleted || (now - value.createdAt) > this.orphanCleanupMaxAgeMs * 2) {
          this.provisionedWorkspaces.delete(key);
        }
      }
    }
  }

  async hibernate(sandboxEnv, reason = "hibernate") {
    if (!sandboxEnv || !sandboxEnv._workspace) {
      return { success: false, reason: "missing_workspace" };
    }

    const workspace = sandboxEnv._workspace;
    const workspaceId = sandboxEnv.workspaceId ?? "unknown";
    const daytona = await this._getDaytonaClient();

    // Best-effort: Daytona SDK surface differs by version/deployment.
    // Try a stop/suspend primitive if available; otherwise delete.
    try {
      if (typeof daytona.stop === "function") {
        await daytona.stop(workspace);
        console.log(`[Daytona] Stopped sandbox ${workspaceId} (${reason}).`);
        return { success: true, mode: "stop" };
      }
      if (typeof daytona.suspend === "function") {
        await daytona.suspend(workspace);
        console.log(`[Daytona] Suspended sandbox ${workspaceId} (${reason}).`);
        return { success: true, mode: "suspend" };
      }
    } catch (err) {
      console.warn(`[Daytona] Hibernate failed for ${workspaceId}, falling back to delete: ${err?.message ?? String(err)}`);
    }

    await this._deleteWorkspace(workspace, workspaceId, `hibernate_${reason}`);
    return { success: true, mode: "delete_fallback" };
  }

  async resume(sandboxEnv, reason = "resume") {
    if (!sandboxEnv || !sandboxEnv._workspace) {
      return { success: false, reason: "missing_workspace" };
    }

    const workspace = sandboxEnv._workspace;
    const workspaceId = sandboxEnv.workspaceId ?? "unknown";
    const daytona = await this._getDaytonaClient();

    try {
      if (typeof daytona.start === "function") {
        await daytona.start(workspace);
        console.log(`[Daytona] Started sandbox ${workspaceId} (${reason}).`);
        return { success: true, mode: "start" };
      }
      if (typeof daytona.resume === "function") {
        await daytona.resume(workspace);
        console.log(`[Daytona] Resumed sandbox ${workspaceId} (${reason}).`);
        return { success: true, mode: "resume" };
      }
    } catch (err) {
      console.warn(`[Daytona] Resume failed for ${workspaceId}: ${err?.message ?? String(err)}`);
      return { success: false, reason: err?.message ?? String(err) };
    }

    // If SDK has no resume primitive, treat as no-op; the next liveness ping will detect true state.
    return { success: true, mode: "noop" };
  }

  async release(sandboxEnv) {
    if (!sandboxEnv || !sandboxEnv._workspace) return;

    if (this.closed) {
      this.metrics.releaseDeletedTotal += 1;
      await this._deleteWorkspace(sandboxEnv._workspace, sandboxEnv.workspaceId, "pool_closed_release");
      return;
    }

    const reusable = sandboxEnv._reusable !== false;
    const skillId = sandboxEnv._lastSkillId ?? "unknown";

    if (this.prewarmSize > 0 && reusable && this.idleSandboxes.length < this.prewarmSize) {
      this.idleSandboxes.push({
        workspaceId: sandboxEnv.workspaceId,
        workspace: sandboxEnv._workspace,
        idledAt: Date.now(),
        imageRef: sandboxEnv._imageRef ?? null,
        skillId
      });
      this.metrics.releaseReturnedToPoolTotal += 1;
      console.log(
        `[Daytona] Returned sandbox ${sandboxEnv.workspaceId} to warm pool (skill=${skillId}). idle=${this.idleSandboxes.length}/${this.prewarmSize}`
      );
      this._ensurePrewarmCapacity(skillId, { force: false });
      return;
    }

    console.log(`[Daytona] Releasing/Deleting sandbox ${sandboxEnv.workspaceId}...`);
    this.metrics.releaseDeletedTotal += 1;
    await this._deleteWorkspace(sandboxEnv._workspace, sandboxEnv.workspaceId, reusable ? "release" : "unhealthy");
    this._ensurePrewarmCapacity(skillId, { force: false });
  }

  /**
   * Install npm packages in sandbox
   * @param {string} sandboxId - Daytona sandbox ID (workspaceId)
   * @param {Array} tools - [{ name: 'three', version: '0.160.0' }, ...]
   * @returns {Promise<{success: bool, output: string, errors: string}>}
   */
  async installTools(sandboxId, tools) {
    if (!Array.isArray(tools) || tools.length === 0) {
      return { success: true, output: '', errors: '' };
    }

    try {
      // Find the sandbox in pool or current usage
      let targetWorkspace = null;
      
      // Check idle sandboxes first
      for (const idle of this.idleSandboxes) {
        if (idle.workspaceId === sandboxId) {
          targetWorkspace = idle.workspace;
          break;
        }
      }
      
      if (!targetWorkspace) {
        return {
          success: false,
          output: '',
          errors: `Sandbox ${sandboxId} not found in pool`
        };
      }

      // Build npm install command
      const packages = tools
        .map(t => {
          const version = t.version || 'latest';
          return version === 'latest' 
            ? t.name 
            : `${t.name}@${version}`;
        })
        .join(' ');
      
      // Use explicit cache and tmp directories to avoid permission issues
      // Prevents npm from trying to use system-wide cache locations that may not be writable
      const command = `npm install --save ${packages} --cache=/home/terranet/.npm --tmp=/tmp/npm-cache --prefer-offline`;
      
      console.log(`[Daytona] Installing tools in sandbox ${sandboxId}: ${packages}`);
      
      // Execute install via process command with proper environment setup
      // Ensures npm has access to writable cache and temp directories
      try {
        const result = await targetWorkspace.process.executeCommand(
          `bash -c "mkdir -p /home/terranet/.npm /tmp/npm-cache && cd /workspace && ${command} 2>&1"`
        );
        
        const exitCode = result && result.exitCode !== undefined ? result.exitCode : (result ? 0 : 1);
        const output = String(result || 'Tools installed successfully');
        
        console.log(
          `[Daytona] Tool installation completed for ${sandboxId}. exitCode=${exitCode}`
        );
        
        return {
          success: exitCode === 0,
          output: output,
          errors: exitCode === 0 ? '' : output
        };
      } catch (execError) {
        const errorMsg = execError instanceof Error ? execError.message : String(execError);
        console.warn(
          `[Daytona] Tool installation command failed for ${sandboxId}: ${errorMsg}`
        );
        
        return {
          success: false,
          output: '',
          errors: errorMsg
        };
      }
    } catch (error) {
      return {
        success: false,
        output: '',
        errors: error instanceof Error ? error.message : String(error)
      };
    }
  }

  async shutdown(options = {}) {
    if (this.closed) {
      return;
    }

    this.closed = true;

    if (this._maintenanceTimer) {
      clearInterval(this._maintenanceTimer);
      this._maintenanceTimer = null;
    }
    if (this._orphanCleanupTimer) {
      clearInterval(this._orphanCleanupTimer);
      this._orphanCleanupTimer = null;
    }

    const shouldDeleteIdle = options.deleteIdleSandboxes ?? this.deleteIdleOnShutdown;
    const idleToDelete = [...this.idleSandboxes];
    this.idleSandboxes = [];

    if (shouldDeleteIdle && idleToDelete.length > 0) {
      for (const sandbox of idleToDelete) {
        // Best-effort cleanup at shutdown time.
        // eslint-disable-next-line no-await-in-loop
        await this._deleteWorkspace(sandbox.workspace, sandbox.workspaceId, "shutdown_cleanup");
      }
    }

    // Also run a one-time orphan cleanup if requested
    if (options.deleteOrphans) {
      await this._cleanupOrganizationOrphans();
    }
  }

  /**
   * Admin/manual cleanup: delete all organization sandboxes regardless of state.
   * Use with caution — this deletes EVERY sandbox in the org.
   */
  async cleanupAllOrganizationSandboxes() {
    let deleted = 0;
    let failed = 0;
    try {
      const daytona = await this._getDaytonaClient();
      const orgId = process.env.DAYTONA_ORGANIZATION_ID || process.env.DAYTONA_ORG_ID || null;
      const all = [];
      let page = 1;
      while (true) {
        const qs = new URLSearchParams({ limit: "100", page: String(page) });
        if (orgId) qs.set("organizationId", orgId);
        const response = await fetch(`https://app.daytona.io/api/sandbox?${qs.toString()}`, {
          headers: {
            Authorization: `Bearer ${process.env.DAYTONA_API_KEY || process.env.DAYTONA_API_TOKEN || ""}`,
            "Content-Type": "application/json",
          },
        });
        if (!response.ok) break;
        const payload = await response.json();
        const items = Array.isArray(payload) ? payload : (payload.items || []);
        if (items.length === 0) break;
        all.push(...items);
        if (items.length < 100) break;
        page += 1;
      }

      for (const item of all) {
        const id = item.id || item.sandboxId;
        if (!id) continue;
        try {
          await daytona.delete({ id });
          deleted += 1;
          const tracked = this.provisionedWorkspaces.get(id);
          if (tracked) tracked.deleted = true;
        } catch {
          failed += 1;
        }
      }
    } catch (err) {
      console.error("[Daytona][AdminCleanup] Failed:", err.message);
    }
    console.log(`[Daytona][AdminCleanup] Deleted ${deleted} sandboxes, ${failed} failed.`);
    return { deleted, failed };
  }
}

function truncateForLog(value, maxLength = 220) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

// Export tool registry, filesystem factory, build manager, and artifact storage (SandboxPoolManager exported as class)
export { toolRegistry, createSandboxFileSystem, createBuildManager, createArtifactStorage };
