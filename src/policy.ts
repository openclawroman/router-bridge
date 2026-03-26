import { ExecutionBackend, ScopeType, PluginConfig } from "./types";
import { ExecutionBackendStore } from "./store";
import type { HealthResult, TaskEnvelope } from "./adapters/base";
import { createAdapter } from "./adapters/factory";

export interface DelegationDecision {
  delegate: boolean;
  reason: string;
  backend: ExecutionBackend;
  healthStatus: "healthy" | "unavailable" | "not_checked";
}

export interface TaskClassification {
  isCodingTask: boolean;
  taskType: "coding" | "review" | "planning" | "chat" | "other";
  confidence: number; // 0-1
  signals: string[]; // what triggered the classification
}

export function classifyTask(task: string | TaskEnvelope): TaskClassification {
  // If TaskEnvelope with taskMeta, use that directly
  if (typeof task !== "string" && task.taskMeta?.type) {
    return {
      isCodingTask: task.taskMeta.type === "coding" || task.taskMeta.type === "review",
      taskType: task.taskMeta.type,
      confidence: 0.95,
      signals: ["taskMeta.type:" + task.taskMeta.type],
    };
  }

  const text = typeof task === "string" ? task : task.task;
  if (!text || !text.trim()) {
    return { isCodingTask: false, taskType: "chat", confidence: 0, signals: ["empty-input"] };
  }
  const lower = text.toLowerCase();
  const signals: string[] = [];

  // Coding signals
  const codingPatterns = [
    { pattern: /\b(write|create|implement|build|code|program|develop|fix|patch)\b.*\b(code|function|class|module|component|api|endpoint|script)\b/i, label: "action+artifact" },
    { pattern: /\b(refactor|optimize|debug|trace|diagnose)\b/i, label: "code-modification" },
    { pattern: /\b(fix|bug|error|exception|crash|stacktrace|traceback)\b/i, label: "debugging" },
    { pattern: /\b(test|unittest|coverage|spec|assert)\b/i, label: "testing" },
    { pattern: /\b(commit|push|merge|branch|pr|pull request|rebase)\b/i, label: "git-operations" },
    { pattern: /\b(deploy|build|ci|cd|pipeline|docker|container)\b/i, label: "devops" },
    { pattern: /\b\.(ts|js|py|go|rs|java|rb|cpp|c|h|cs|php|swift|kt)\b/i, label: "file-extension" },
    { pattern: /\b(function|method|class|interface|type|struct|enum|import|export|require|async|await)\b/i, label: "code-keyword" },
    { pattern: /\b(repo|repository|codebase|project|source|src)\b/i, label: "codebase-reference" },
  ];

  // Non-coding signals
  const chatPatterns = [
    { pattern: /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|maybe)\b/i, label: "greeting/ack" },
    { pattern: /\b(what is|who is|when was|where is|how does|explain|define|tell me about)\b/i, label: "knowledge-question" },
    { pattern: /\b(weather|time|date|news|translate|convert|calculate)\b/i, label: "utility-request" },
    { pattern: /\b(opinion|think|feel|prefer|suggest|recommend)\b/i, label: "opinion-request" },
  ];

  let codingScore = 0;
  let chatScore = 0;

  for (const { pattern, label } of codingPatterns) {
    if (pattern.test(lower)) {
      codingScore += 1;
      signals.push(label);
    }
  }

  for (const { pattern, label } of chatPatterns) {
    if (pattern.test(lower)) {
      chatScore += 1;
      signals.push("!" + label);
    }
  }

  // Planning without execution intent = not coding
  if (/\b(plan|strategy|architecture|design|approach)\b/i.test(lower) && !/\b(implement|build|code|create)\b/i.test(lower)) {
    chatScore += 0.5;
    signals.push("!planning-only");
  }

  const total = codingScore + chatScore;
  const codingConfidence = total > 0 ? codingScore / total : 0.3;
  const isCoding = codingConfidence >= 0.5 && codingScore >= 1;

  return {
    isCodingTask: isCoding,
    taskType: isCoding ? "coding" : (chatScore > 0 ? "chat" : "other"),
    confidence: codingConfidence,
    signals,
  };
}

export async function shouldDelegateToExecutionBackend(
  task: string | TaskEnvelope,
  config: PluginConfig,
  scopeId: string = "default",
  scopeType: ScopeType = ScopeType.Global,
  healthResult?: HealthResult,
  threadId?: string | null,
  sessionId?: string | null,
): Promise<DelegationDecision> {
  const store = new ExecutionBackendStore();

  // 1. Check backend in scope
  const state = store.getEffective(scopeType, scopeId, threadId ?? undefined, sessionId ?? undefined);
  const backend = state?.executionBackend ?? ExecutionBackend.Native;

  if (backend !== ExecutionBackend.RouterBridge) {
    return {
      delegate: false,
      reason: `Backend is ${backend}, not router-bridge`,
      backend,
      healthStatus: "not_checked",
    };
  }

  // 2. Classify the task
  const classification = classifyTask(task);

  if (!classification.isCodingTask) {
    return {
      delegate: false,
      reason: `Task classified as ${classification.taskType} (confidence: ${(classification.confidence * 100).toFixed(0)}%, signals: ${classification.signals.join(", ")})`,
      backend,
      healthStatus: "not_checked",
    };
  }

  // 3. Check router health (if provided or check now)
  let health: HealthResult;
  if (healthResult) {
    health = healthResult;
  } else {
    // Inline health check via adapter
    try {
      const adapter = createAdapter(config);
      health = await adapter.health();
    } catch {
      health = { healthy: false, output: "health check failed", latencyMs: 0 };
    }
  }

  if (!health.healthy && !config.fallbackToNativeOnError) {
    return {
      delegate: false,
      reason: `Router unhealthy: ${health.output}`,
      backend,
      healthStatus: "unavailable",
    };
  }

  // 4. All conditions met — delegate
  return {
    delegate: true,
    reason: `Coding task (${classification.taskType}, confidence ${(classification.confidence * 100).toFixed(0)}%), backend is router-bridge, router is ${health.healthy ? "healthy" : "unhealthy but fallback enabled"}`,
    backend,
    healthStatus: health.healthy ? "healthy" : "unavailable",
  };
}
