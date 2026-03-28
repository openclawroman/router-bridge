import { ExecutionBackend, ScopeType, PluginConfig } from "./types";
import { ExecutionBackendStore } from "./store";
import { store } from "./commands";
import type { HealthResult, TaskEnvelope } from "./adapters/base";
import { createAdapter } from "./adapters/factory";

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
  const lower = text.toLowerCase();
  const signals: string[] = [];

  // Coding signals
  // Unicode-aware: use (?:^|[^\p{L}\p{N}]) for word boundaries to handle Cyrillic
  // For simple word lists, use (?:^|\s) before and look-ahead after
  const codingPatterns = [
    { pattern: /(?:^|[^\p{L}\p{N}])(write|create|implement|build|code|program|develop|fix|patch)(?:[^\p{L}\p{N}]|$).*(?:^|[^\p{L}\p{N}])(code|function|class|module|component|api|endpoint|script)(?:[^\p{L}\p{N}]|$)/i, label: "action+artifact" },
    { pattern: /(?:^|[^\p{L}\p{N}])(refactor|optimize|debug|trace|diagnose)(?:[^\p{L}\p{N}]|$)/i, label: "code-modification" },
    { pattern: /(?:^|[^\p{L}\p{N}])(fix|bug|error|exception|crash|stacktrace|traceback)(?:[^\p{L}\p{N}]|$)/i, label: "debugging" },
    { pattern: /(?:^|[^\p{L}\p{N}])(test|unittest|coverage|spec|assert)(?:[^\p{L}\p{N}]|$)/i, label: "testing" },
    { pattern: /(?:^|[^\p{L}\p{N}])(commit|push|merge|branch|pr|pull request|rebase)(?:[^\p{L}\p{N}]|$)/i, label: "git-operations" },
    { pattern: /(?:^|[^\p{L}\p{N}])(deploy|build|ci|cd|pipeline|docker|container)(?:[^\p{L}\p{N}]|$)/i, label: "devops" },
    { pattern: /\.(ts|js|py|go|rs|java|rb|cpp|c|h|cs|php|swift|kt)(?:[^\p{L}\p{N}]|$)/i, label: "file-extension" },
    { pattern: /(?:^|[^\p{L}\p{N}])(function|method|class|interface|type|struct|enum|import|export|require|async|await)(?:[^\p{L}\p{N}]|$)/i, label: "code-keyword" },
    { pattern: /(?:^|[^\p{L}\p{N}])(repo|repository|codebase|project|source|src)(?:[^\p{L}\p{N}]|$)/i, label: "codebase-reference" },
    // Ukrainian coding action verbs - use (?:^|\s) boundary since \b fails with Cyrillic
    { pattern: /(?:^|\s)(запрограмуй|розроби|створи|напиши|зроби|виконай|реалізуй|створити|програмуй|кодуй)(?:\s|,|\.|!|$)/i, label: "coding-action-ua" },
    { pattern: /(?:^|\s)(виправ|відлагодь|тестуй|скомпілюй|запусти|рефактори|додай|перероби|почни)(?:\s|,|\.|!|$)/i, label: "coding-action-ua" },
    { pattern: /hello.world/i, label: "hello-world" },
  ];

  // Non-coding signals
  const chatPatterns = [
    { pattern: /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|maybe|привіт|дякую|ок|так|ні|може)(?:\s|,|\.|!|$)/i, label: "greeting/ack" },
    { pattern: /(?:^|[^\p{L}\p{N}])(what is|who is|when was|where is|how does|explain|define|tell me about|що таке|хто такий|коли|де|як|поясни|визнач|розкажи)(?:[^\p{L}\p{N}]|$)/i, label: "knowledge-question" },
    { pattern: /(?:^|[^\p{L}\p{N}])(weather|time|date|news|translate|convert|calculate|погода|час|дата|новини|переклад|конвертуй|порахуй)(?:[^\p{L}\p{N}]|$)/i, label: "utility-request" },
    { pattern: /(?:^|[^\p{L}\p{N}])(opinion|think|feel|prefer|suggest|recommend|думка|вважаєш|порад|пропоную|рекомендуй)(?:[^\p{L}\p{N}]|$)/i, label: "opinion-request" },
    { pattern: /(?:^|[^\p{L}\p{N}])(чому|навіщо|яким чином)(?:[^\p{L}\p{N}]|$)/i, label: "knowledge-question-ua" },
  ];

  // --- Execution intent detection (EN + UK) ---
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

  // Strong signals that always indicate coding (code fences, stacktraces)
  // NOTE: file paths alone are NOT strong signals — "Чому не працює main.py?" is a question
  // Use file-extension as a regular coding pattern, not a strong signal override
  const hasStrongSignals = /```|~~~|traceback|stacktrace|exception at/i.test(text);

  let executionIntent: boolean;
  if (hasStrongSignals) {
    // Strong signal override — always treat as execution intent
    executionIntent = true;
  } else if (explMatches && !execMatches) {
    executionIntent = false;
  } else if (execMatches && !explMatches) {
    executionIntent = true;
  } else if (execMatches && explMatches) {
    // Mixed intent: count which signal type dominates
    const execSignalCount = executionPatterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    const explSignalCount = explanationPatterns.reduce((n, p) => n + (p.test(text) ? 1 : 0), 0);
    executionIntent = execSignalCount >= explSignalCount;
  } else {
    // Neither matched — fall back to existing scoring logic
    executionIntent = true; // default, scoring below decides
  }

  if (execMatches) signals.push("execution-intent");
  if (explMatches) signals.push("explanation-intent");
  if (hasStrongSignals) signals.push("strong-signal");

  let codingScore = 0;
  let chatScore = 0;

  // Code indicators — presence of quotes, braces, semicolons, or "world" suggests code
  const hasCodeIndicators = /["'`{}();]|world|console|print|hello.world/i.test(lower);

  for (const { pattern, label } of codingPatterns) {
    if (pattern.test(lower)) {
      codingScore += 1;
      signals.push(label);
    }
  }

  for (const { pattern, label } of chatPatterns) {
    // Skip greeting pattern when text contains code indicators (e.g. "Hello, World!")
    if (label === "greeting/ack" && hasCodeIndicators) continue;
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
  // Strong signal alone is NOT enough — must also have execution intent or coding patterns
  const isCoding = (hasStrongSignals && (executionIntent || codingScore > 0)) || (executionIntent && codingConfidence >= 0.5 && codingScore >= 1);

  // Resolve taskClass for router
  const hasPlanningKeyword = /plan|planning|strategy|architecture|design|сплан|архітектур/i.test(lower);
  // When execution intent is strong, prefer "implementation" over "planner"
  const taskClass = isCoding
    ? (codingScore >= 1 ? categorizeCodingTask(lower, executionIntent) : "other")
    : hasPlanningKeyword ? "planner" : "other";

  return {
    isCodingTask: isCoding,
    taskType: isCoding ? "coding" : (chatScore > 0 ? "chat" : "other"),
    taskClass,
    confidence: codingConfidence,
    signals,
  };
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
