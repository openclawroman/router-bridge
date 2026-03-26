import * as fs from "fs";
import * as path from "path";

export interface Metrics {
  totalRouted: number;
  totalFallbacks: number;
  totalTimeouts: number;
  totalHealthFailures: number;
  totalMalformedResponses: number;
  totalAuthFailures: number;
  totalShadowRuns: number;
  totalShadowDisagreements: number;
  lastSuccessAt: string | null;
  lastFallbackAt: string | null;
  lastFallbackReason: string | null;
  lastHealthFailureAt: string | null;
  fallbackRate: number;
  sessionStartedAt: string;
}

function getMetricsPath(): string {
  const routerRoot = process.env.OPENCLAW_ROUTER_ROOT
    || path.join(process.env.HOME || "/root", ".openclaw", "router");
  return path.join(routerRoot, "runtime", "bridge", "metrics.jsonl");
}

let currentMetrics: Metrics = resetMetrics();

function resetMetrics(): Metrics {
  return {
    totalRouted: 0,
    totalFallbacks: 0,
    totalTimeouts: 0,
    totalHealthFailures: 0,
    totalMalformedResponses: 0,
    totalAuthFailures: 0,
    totalShadowRuns: 0,
    totalShadowDisagreements: 0,
    lastSuccessAt: null,
    lastFallbackAt: null,
    lastFallbackReason: null,
    lastHealthFailureAt: null,
    fallbackRate: 0,
    sessionStartedAt: new Date().toISOString(),
  };
}

function updateRate(): void {
  const total = currentMetrics.totalRouted + currentMetrics.totalFallbacks;
  currentMetrics.fallbackRate = total > 0
    ? Math.round((currentMetrics.totalFallbacks / total) * 10000) / 100
    : 0;
}

function appendMetric(event: string, data?: Record<string, any>): void {
  try {
    const filePath = getMetricsPath();
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({ ts: new Date().toISOString(), event, ...data });
    fs.appendFileSync(filePath, entry + "\n");
  } catch {
    // Metrics writing should never throw
  }
}

export function recordSuccess(): void {
  currentMetrics.totalRouted++;
  currentMetrics.lastSuccessAt = new Date().toISOString();
  updateRate();
  appendMetric("success");
}

export function recordFallback(reason: string): void {
  currentMetrics.totalFallbacks++;
  currentMetrics.lastFallbackAt = new Date().toISOString();
  currentMetrics.lastFallbackReason = reason;
  updateRate();
  appendMetric("fallback", { reason });
}

export function recordTimeout(): void {
  currentMetrics.totalTimeouts++;
  appendMetric("timeout");
}

export function recordHealthFailure(): void {
  currentMetrics.totalHealthFailures++;
  currentMetrics.lastHealthFailureAt = new Date().toISOString();
  appendMetric("health_failure");
}

export function recordMalformedResponse(): void {
  currentMetrics.totalMalformedResponses++;
  appendMetric("malformed_response");
}

export function recordAuthFailure(): void {
  currentMetrics.totalAuthFailures++;
  appendMetric("auth_failure");
}

export function recordShadowRun(): void {
  currentMetrics.totalShadowRuns++;
}

export function recordShadowDisagreement(): void {
  currentMetrics.totalShadowDisagreements++;
}

export function getMetrics(): Metrics {
  return { ...currentMetrics };
}

export function getMetricsSummary(): string {
  return [
    `Routed: ${currentMetrics.totalRouted}`,
    `Fallbacks: ${currentMetrics.totalFallbacks} (${currentMetrics.fallbackRate}%)`,
    `Timeouts: ${currentMetrics.totalTimeouts}`,
    `Health failures: ${currentMetrics.totalHealthFailures}`,
    `Malformed: ${currentMetrics.totalMalformedResponses}`,
    `Auth failures: ${currentMetrics.totalAuthFailures}`,
    `Shadow runs: ${currentMetrics.totalShadowRuns}`,
    `Shadow disagreements: ${currentMetrics.totalShadowDisagreements}`,
  ].join("\n");
}
