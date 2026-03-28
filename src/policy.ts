import { ExecutionBackend, ScopeType, PluginConfig } from "./types";
import { ExecutionBackendStore } from "./store";
import { store } from "./commands";
import type { HealthResult, TaskEnvelope } from "./adapters/base";
import { createAdapter } from "./adapters/factory";
import { ALL_PATTERNS } from "./classifier/lexicon";
import { normalizeText } from "./classifier/normalize";
import { recordClassification } from "./classifier/metrics";

// Re-export lexicon types and data for testing
export { LEXICON, ALL_PATTERNS, type PatternEntry, type Lexicon, type LexiconGroup, type WeightTier } from "./classifier/lexicon";

export interface DelegationDecision {
  delegate: boolean;
  reason: string;
  backend: ExecutionBackend;
  healthStatus: "healthy" | "unavailable" | "not_checked";
  resolvedScopeType: ScopeType;
  resolvedScopeId: string;
}

export interface TaskClassification {
  isCodingTask: boolean;
  taskType: "coding" | "review" | "planning" | "chat" | "other";
  taskClass: string; // Maps to openclaw-router TaskClass enum
  confidence: number; // 0-1
  signals: string[]; // what triggered the classification
}

export function classifyTask(task: string | TaskEnvelope): TaskClassification {
  // If TaskEnvelope with taskMeta, use that directly
  if (typeof task !== "string" && task.taskMeta?.type) {
    const type = task.taskMeta.type;
    const taskClass = type === "coding"
      ? "implementation"
      : type === "review"
        ? "code_review"
        : type === "planning"
          ? "planner"
          : "implementation";
    return {
      isCodingTask: type === "coding" || type === "review",
      taskType: type,
      taskClass,
      confidence: 0.95,
      signals: ["taskMeta.type:" + type],
    };
  }

  const text = typeof task === "string" ? task : task.task;
  if (!text || !text.trim()) {
    return { isCodingTask: false, taskType: "chat", taskClass: "implementation", confidence: 0, signals: ["empty-input"] };
  }
  const normalized = normalizeText(text);
  const signals: string[] = [];

  // Strong signals (language-independent) — score 2 each, override chat signals
  const strongSignals: { regex: RegExp; label: string }[] = [
    // File paths: src/foo.ts, ./lib/utils.js, /path/to/file.py
    { regex: /(?:^|\s)(\.\/|\/)?[\w\-\/]+\.(ts|js|py|go|rs|java|rb|cpp|c|h|cs|php|swift|kt|sh|yaml|yml|json|toml|nix|dockerfile)\b/i, label: "file-path" },
    // Code fences: ``` or ~~~
    { regex: /```|~~~/i, label: "code-fence" },
    // Stacktrace markers
    { regex: /(?:traceback|stacktrace|at\s+\w+\.\w+\(|Error:|Exception:|TypeError:|ValueError:|SyntaxError:|Segmentation fault|panic:)/i, label: "stacktrace" },
    // Git markers (use (?:^|\s) for Cyrillic compatibility)
    { regex: /(?:^|\s)(PR\s*#?\d+|commit|diff|merge\s*conflict)(?:\s|$|[.!,:])/i, label: "git-marker" },
    // CI/CD markers
    { regex: /\bCI\b|\bCD\b|\bpipeline\b|\bGitHub Actions\b|\b\.github\//i, label: "ci-marker" },
    // Code syntax indicators: function() { blocks
    { regex: /\b\w+\s*\([^)]*\)\s*\{/, label: "code-syntax" },
    // Assignment: x = value — require code-like context (keyword or function call RHS)
    { regex: /\b(?:const|let|var|config|result|name|path|value|port|host|url|env|module|export|import)\s*=\s*\w+/i, label: "assignment" },
    { regex: /\b\w+\s*=\s*\w+\([^)]*\)/, label: "assignment" },
  ];

  let strongCodingScore = 0;
  for (const { regex, label } of strongSignals) {
    if (regex.test(text)) {
      strongCodingScore += 2;
      signals.push(label);
    }
  }

  let codingScore = 0;
  let chatScore = 0;

  // Code indicators — presence of quotes, braces, semicolons, or "world" suggests code
  const hasCodeIndicators = /["'`{}();]|world|console|print|hello.world/i.test(normalized);

  // Run all lexicon-based patterns with weighted scoring
  for (const entry of ALL_PATTERNS) {
    // Skip greeting pattern when text contains code indicators (e.g. "Hello, World!")
    if (entry.label === "greeting/ack" && hasCodeIndicators) continue;

    if (entry.pattern.test(normalized)) {
      if (entry.group === "chat" || entry.label.startsWith("knowledge")) {
        chatScore += entry.weight;
        signals.push("!" + entry.label);
      } else {
        codingScore += entry.weight;
        signals.push(entry.label);
      }
    }
  }

  // Planning without execution intent = not coding (backward compat)
  const hasPlanningOnly = /(?:^|[^\p{L}\p{N}])(plan|strategy|architecture)(?:[^\p{L}\p{N}]|$)/iu.test(normalized);
  const hasExecutionIntent = /(?:^|[^\p{L}\p{N}])(implement|build|code|create)(?:[^\p{L}\p{N}]|$)/iu.test(normalized);
  if (hasPlanningOnly && !hasExecutionIntent) {
    chatScore += 0.5;
    signals.push("!planning-only");
  }

  // Strong signals (language-independent) add to codingScore and override chat
  codingScore += strongCodingScore;

  const total = codingScore + chatScore;
  const codingConfidence = total > 0 ? codingScore / total : 0.3;
  // Strong signals (≥2) override chat — force coding when strong signals present
  const isCoding = strongCodingScore >= 2 || (codingConfidence >= 0.5 && codingScore >= 1);

  // Resolve taskClass for router
  const taskClass = isCoding
    ? normalized.match(/\b(refactor|optimi[zs]e)\b/i)
      ? "refactor"
      : normalized.match(/\b(debug|trace|diagnose)\b/i)
        ? "debug"
        : normalized.match(/\b(test|testing|unittest|coverage|spec|assert)/i)
          ? "test_generation"
          : normalized.match(/\b(review)\b/i)
            ? "code_review"
            : "implementation"
    : normalized.match(/\b(plan|planning|strategy|architecture|design)\b/i)
      ? "planner"
      : "implementation";

  const result: TaskClassification = {
    isCodingTask: isCoding,
    taskType: isCoding ? "coding" : (chatScore > 0 ? "chat" : "other"),
    taskClass,
    confidence: codingConfidence,
    signals,
  };

  // Record metrics
  recordClassification(text, normalized, result);

  return result;
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
  // Use singleton store from commands.ts — shared state with /router commands

  // 1. Check backend in scope
  const state = store.getEffective(scopeType, scopeId, threadId ?? undefined, sessionId ?? undefined);
  const backend = state?.executionBackend ?? ExecutionBackend.Native;

  if (backend !== ExecutionBackend.RouterBridge) {
    return {
      delegate: false,
      reason: `Backend is ${backend}, not router-bridge`,
      backend,
      healthStatus: "not_checked",
      resolvedScopeType: scopeType,
      resolvedScopeId: scopeId,
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
      resolvedScopeType: scopeType,
      resolvedScopeId: scopeId,
    };
  }

  // 3. Check router health (if provided or check now)
  let health: HealthResult;
  if (healthResult) {
    health = healthResult;
  } else {
    // Inline health check via adapter
    try {
      const adapter = createAdapter(config, backend);
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
      resolvedScopeType: scopeType,
      resolvedScopeId: scopeId,
    };
  }

  // 4. All conditions met — delegate
  return {
    delegate: true,
    reason: `Coding task (${classification.taskType}, confidence ${(classification.confidence * 100).toFixed(0)}%), backend is router-bridge, router is ${health.healthy ? "healthy" : "unhealthy but fallback enabled"}`,
    backend,
    healthStatus: health.healthy ? "healthy" : "unavailable",
    resolvedScopeType: scopeType,
    resolvedScopeId: scopeId,
  };
}
