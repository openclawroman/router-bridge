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

  // ── Execution / Explanation intent detection (EN + UK) ──
  const executionPatterns = [
    /(?:^|\s)(реалізуй|напиши|створи|зроби|виконай|write|create|implement|build|code|develop|fix|patch|deploy|test)(?:\s|,|\.|!|$)/i,
    /(?:^|\s)(дороби|почни|займись|створити|написати|побудуй|виправ|перероби|почати|рефактори|додай)(?:\s|,|\.|!|$)/i,
  ];
  const explanationPatterns = [
    /(?:^|\s)(поясни|що робить|як працює|чому|навіщо|explain|what does|how does|why|tell me about|describe)(?:\s|,|\.|!|$)/i,
    /(?:^|\s)(порівняй|compare|analyze|проаналізуй|визнач|define)(?:\s|,|\.|!|$)/i,
    /\?\s*$/,  // trailing question mark
  ];
  const execMatches = executionPatterns.some(p => p.test(text));
  const explMatches = explanationPatterns.some(p => p.test(text));

  // Strong signals: language-independent coding indicators
  const strongSignalPatterns: { regex: RegExp; label: string }[] = [
    { regex: /```|~~~/i, label: "code-fence" },
    { regex: /(?:traceback|stacktrace|at\s+\w+\.\w+\(|Error:|Exception:|SyntaxError|TypeError|ReferenceError|AssertionError|segfault|core dumped|segmentation fault)/i, label: "stacktrace" },
    { regex: /(?:^|\s)(\.\/|\/)?[\w\-\/]+\.(ts|js|py|go|rs|java|rb|cpp|c|h|cs|php|swift|kt|sh|yaml|yml|json|toml|nix|dockerfile)\b/i, label: "file-path" },
    { regex: /(?:^|\s)(PR\s*#?\d+|commit|diff|merge\s*conflict)(?:\s|$|[.!,:])/i, label: "git-marker" },
    { regex: /\bCI\b|\bCD\b|\bpipeline\b|\bGitHub Actions\b|\b\.github\//i, label: "ci-marker" },
    { regex: /\b\w+\s*\([^)]*\)\s*\{/, label: "code-syntax" },
    { regex: /\b(?:const|let|var|config|result|name|path|value|port|host|url|env|module|export|import)\s*=\s*\w+/i, label: "assignment" },
    { regex: /\b\w+\s*=\s*\w+\([^)]*\)/, label: "assignment" },
  ];
  let hasStrongSignals = false;
  for (const { regex, label } of strongSignalPatterns) {
    if (regex.test(text)) {
      hasStrongSignals = true;
      if (!signals.includes(label)) signals.push(label);
    }
  }

  // Hard strong signals: code fences and stacktraces always force coding
  const hasHardStrongSignals = signals.some(s => s === "code-fence" || s === "stacktrace");

  let executionIntent: boolean;
  if (hasHardStrongSignals) {
    // Code fences and stacktraces always indicate execution
    executionIntent = true;
  } else if (hasStrongSignals && !explMatches) {
    // File paths without questions = execution
    executionIntent = true;
  } else if (explMatches && !execMatches) {
    executionIntent = false;
  } else if (execMatches && !explMatches) {
    executionIntent = true;
  } else if (execMatches && explMatches) {
    const execSignalCount = executionPatterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    const explSignalCount = explanationPatterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    executionIntent = execSignalCount >= explSignalCount;
  } else {
    executionIntent = true; // default — scoring below decides
  }

  if (execMatches) signals.push("execution-intent");
  if (explMatches) signals.push("explanation-intent");
  if (hasStrongSignals) signals.push("strong-signal");
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

  // Planning without execution intent = not coding
  const hasPlanningOnly = /(?:^|[^\p{L}\p{N}])(plan|strategy|architecture)(?:[^\p{L}\p{N}]|$)/iu.test(normalized);
  if (hasPlanningOnly && !execMatches) {
    chatScore += 0.5;
    signals.push("!planning-only");
  }

  const total = codingScore + chatScore;
  const codingConfidence = total > 0 ? codingScore / total : 0.3;
  // Strong signals alone is NOT enough — must also have execution intent or coding patterns
  // Exception: file-path-only strong signals with explanation intent = question, not coding
  const filePathOnly = hasStrongSignals && !hasHardStrongSignals && explMatches && !execMatches;
  const isCoding = (!filePathOnly && hasHardStrongSignals) || (hasStrongSignals && executionIntent) || (executionIntent && codingConfidence >= 0.5 && codingScore >= 1) || (hasHardStrongSignals && codingScore > 0);

  // Resolve taskClass for router
  const hasPlanningKeyword = /plan|planning|strategy|architecture|design|сплан|архітектур/i.test(normalized);
  const taskClass = isCoding
    ? (codingScore >= 1 || hasHardStrongSignals ? categorizeCodingTask(normalized, executionIntent) : "other")
    : hasPlanningKeyword ? "planner" : "other";

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

function categorizeCodingTask(text: string, executionIntent: boolean): string {
  if (/виправ|баг|помилка|debug|fix|bug|error|exception|crash|traceback|відлагодь/i.test(text))
    return "debug";
  if (/рефактор|перероби|optimize|refactor|cleanup|очисти|покращ|rewrite/i.test(text))
    return "refactor";
  if (/тест|test|coverage|покриття|unittest|юніт-тест|spec|assert/i.test(text))
    return "test_generation";
  if (/review|огляд|перевір|check|перевірь|code review/i.test(text))
    return "code_review";
  // Only classify as planner when there's no execution intent
  if (/сплануй|план|plan|architecture|архітектура|design|дизайн|підхід|approach/i.test(text) && !executionIntent)
    return "planner";
  return "implementation";
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
