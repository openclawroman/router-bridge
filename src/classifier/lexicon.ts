/**
 * Bilingual lexicon for task classification.
 * All patterns extracted from inline regex in classifyTask().
 */

export interface LexiconGroup {
  en: string[];
  uk: string[];
}

export type WeightTier = "strong" | "medium" | "weak";

export interface PatternEntry {
  pattern: RegExp;
  label: string;
  group: string;
  weight: number;
  tier: WeightTier;
}

export type Lexicon = Record<string, LexiconGroup>;

export const LEXICON: Lexicon = {
  coding_actions: {
    en: ["write", "create", "implement", "build", "code", "program", "develop", "fix", "patch"],
    uk: ["запрограмуй", "розроби", "створи", "напиши", "зроби", "виконай", "реалізуй", "створити", "програмуй", "кодуй", "написати", "побудуй", "дороби", "виправ", "постав", "перероби", "почни", "займись"],
  },
  artifacts: {
    en: ["code", "function", "class", "module", "component", "api", "endpoint", "script", "service", "library", "package"],
    uk: ["функцію", "клас", "модуль", "компонент", "api", "ендпоінт", "скрипт", "сервіс", "бібліотеку", "пакет", "файл"],
  },
  debug: {
    en: ["fix", "bug", "error", "exception", "crash", "stacktrace", "traceback", "debug"],
    uk: ["виправ", "баг", "помилка", "падіння", "креш", "виняток", "стек", "traceback", "відлагодь"],
  },
  testing: {
    en: ["test", "unittest", "coverage", "spec", "assert"],
    uk: ["тест", "тестуй", "юніт-тест", "покриття", "спец", "асерт"],
  },
  git: {
    en: ["commit", "push", "merge", "branch", "pr", "pull request", "rebase"],
    uk: ["коміт", "гілка", "pr", "ребейз", "мерж"],
  },
  devops: {
    en: ["deploy", "build", "ci", "cd", "pipeline", "docker", "container"],
    uk: ["деплой", "збірка", "пайплайн", "контейнер", "докер"],
  },
  chat: {
    en: ["hello", "hi", "hey", "thanks", "ok", "sure", "yes", "no"],
    uk: ["привіт", "дякую", "ок", "так", "ні", "може", "добрий день", "доброго ранку"],
  },
  knowledge: {
    en: ["what is", "who is", "explain", "define", "tell me about", "how does", "why"],
    uk: ["що таке", "хто такий", "поясни", "визнач", "розкажи", "як працює", "чому", "навіщо", "яким чином", "для чого"],
  },
  planning: {
    en: ["plan", "strategy", "architecture", "design", "approach"],
    uk: ["сплануй", "стратегія", "архітектура", "дизайн", "підхід"],
  },
  code_modification: {
    en: ["refactor", "optimize", "debug", "trace", "diagnose"],
    uk: ["рефактор", "оптимізуй", "відлагодь", "трасуй", "діагностуй"],
  },
  hello_world: {
    en: ["hello world"],
    uk: ["привіт світ"],
  },
};

/** Weight tiers for scoring */
export const WEIGHTS: Record<WeightTier, number> = {
  strong: 2,
  medium: 1.5,
  weak: 1,
};

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a PatternEntry from a word list.
 * Uses (?:^|[^\p{L}\p{N}]) boundaries for Latin and (?:^|\s) fallback for Cyrillic-heavy lists.
 */
export function wordsToPattern(words: string[], groupLabel: string, tier: WeightTier): PatternEntry {
  const hasCyrillic = words.some((w) => /[а-яА-ЯіІїЇєЄґҐ]/.test(w));

  // For Cyrillic words, use simpler boundaries since \b doesn't work well
  const prefix = hasCyrillic ? "(?:^|\\s)" : "(?:^|[^\\p{L}\\p{N}])";
  const suffix = hasCyrillic ? "(?:\\s|,|\\.|!|$)" : "(?:[^\\p{L}\\p{N}]|$)";

  const escaped = words.map(escapeRegex);
  const body = escaped.join("|");
  const pattern = new RegExp(`${prefix}(${body})${suffix}`, "iu");

  return {
    pattern,
    label: groupLabel,
    group: groupLabel,
    weight: WEIGHTS[tier],
    tier,
  };
}

/**
 * Build action+artifact compound patterns (strong weight).
 * Matches: action word followed anywhere by artifact word.
 */
export function buildCompoundPatterns(lexicon: Lexicon): PatternEntry[] {
  const patterns: PatternEntry[] = [];
  const actions = [...lexicon.coding_actions.en, ...lexicon.coding_actions.uk];
  const artifacts = [...lexicon.artifacts.en, ...lexicon.artifacts.uk];

  const esc = (s: string) => escapeRegex(s);
  const actionBody = actions.map(esc).join("|");
  const artifactBody = artifacts.map(esc).join("|");

  // EN-style boundary compound
  const enPattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(${actionBody})(?:[^\\p{L}\\p{N}]|$).*(?:^|[^\\p{L}\\p{N}])(${artifactBody})(?:[^\\p{L}\\p{N}]|$)`,
    "iu",
  );
  patterns.push({ pattern: enPattern, label: "action+artifact", group: "compound", weight: WEIGHTS.strong, tier: "strong" });

  // Cyrillic boundary compound
  const ukPattern = new RegExp(
    `(?:^|\\s)(${actionBody})(?:\\s|,|\\.|!|$).*(?:^|\\s)(${artifactBody})(?:\\s|,|\\.|!|$)`,
    "iu",
  );
  patterns.push({ pattern: ukPattern, label: "action+artifact-ua", group: "compound", weight: WEIGHTS.strong, tier: "strong" });

  return patterns;
}

/**
 * Build all pattern entries from the lexicon.
 */
export function buildAllPatterns(lexicon: Lexicon): PatternEntry[] {
  const patterns: PatternEntry[] = [];

  // Strong: action+artifact compounds
  patterns.push(...buildCompoundPatterns(lexicon));

  // Strong: hello_world
  patterns.push(wordsToPattern(lexicon.hello_world.en, "hello-world-en", "strong"));
  patterns.push(wordsToPattern(lexicon.hello_world.uk, "hello-world-ua", "strong"));

  // Medium: debug, testing, git, devops, code_modification
  patterns.push(wordsToPattern(lexicon.debug.en, "debugging-en", "medium"));
  patterns.push(wordsToPattern(lexicon.debug.uk, "debugging-ua", "medium"));
  patterns.push(wordsToPattern(lexicon.testing.en, "testing-en", "medium"));
  patterns.push(wordsToPattern(lexicon.testing.uk, "testing-ua", "medium"));
  patterns.push(wordsToPattern(lexicon.git.en, "git-operations-en", "medium"));
  patterns.push(wordsToPattern(lexicon.git.uk, "git-operations-ua", "medium"));
  patterns.push(wordsToPattern(lexicon.devops.en, "devops-en", "medium"));
  patterns.push(wordsToPattern(lexicon.devops.uk, "devops-ua", "medium"));
  if (lexicon.code_modification) {
    patterns.push(wordsToPattern(lexicon.code_modification.en, "code-modification-en", "medium"));
    patterns.push(wordsToPattern(lexicon.code_modification.uk, "code-modification-ua", "medium"));
  }

  // Weak: coding actions (without artifact context), artifacts (without action context)
  patterns.push(wordsToPattern(lexicon.coding_actions.en, "coding-action-en", "weak"));
  patterns.push(wordsToPattern(lexicon.coding_actions.uk, "coding-action-ua", "weak"));

  // Weak: file extensions
  patterns.push({
    pattern: /\.(ts|js|py|go|rs|java|rb|cpp|c|h|cs|php|swift|kt)(?:[^\p{L}\p{N}]|$)/iu,
    label: "file-extension",
    group: "file-extension",
    weight: WEIGHTS.strong,
    tier: "strong",
  });

  // Weak: code keywords (function, class, import, etc.)
  patterns.push(
    wordsToPattern(
      ["function", "method", "class", "interface", "type", "struct", "enum", "import", "export", "require", "async", "await"],
      "code-keyword",
      "weak",
    ),
  );

  // Weak: codebase reference
  patterns.push(
    wordsToPattern(
      ["repo", "repository", "codebase", "project", "source", "src"],
      "codebase-reference",
      "weak",
    ),
  );

  // Chat patterns
  patterns.push(
    {
      pattern: /^(hi|hello|hey|thanks|thank you|ok|okay|sure|yes|no|maybe|привіт|дякую|ок|так|ні|може|добрий день|доброго ранку)(?:\s|,|\.|!|$)/iu,
      label: "greeting/ack",
      group: "chat",
      weight: WEIGHTS.weak,
      tier: "weak",
    },
    wordsToPattern(lexicon.knowledge.en, "knowledge-question-en", "weak"),
    wordsToPattern(lexicon.knowledge.uk, "knowledge-question-ua", "weak"),
    {
      pattern: /(?:^|[^\p{L}\p{N}])(weather|time|date|news|translate|convert|calculate|погода|час|дата|новини|переклад|конвертуй|порахуй)(?:[^\p{L}\p{N}]|$)/iu,
      label: "utility-request",
      group: "chat",
      weight: WEIGHTS.weak,
      tier: "weak",
    },
    {
      pattern: /(?:^|[^\p{L}\p{N}])(opinion|think|feel|prefer|suggest|recommend|думка|вважаєш|порад|пропоную|рекомендуй)(?:[^\p{L}\p{N}]|$)/iu,
      label: "opinion-request",
      group: "chat",
      weight: WEIGHTS.weak,
      tier: "weak",
    },
  );

  return patterns;
}

/** Pre-built patterns for runtime use */
export const ALL_PATTERNS = buildAllPatterns(LEXICON);
