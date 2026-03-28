import { describe, it, expect } from "vitest";
import { classifyTask } from "../src/policy";

describe("signal-matrix: language-independent coding signals", () => {
  const cases: { input: string; expected: "coding" | "other" | "chat"; note?: string }[] = [
    // ── File paths → coding ──
    { input: "Fix the bug in src/auth.ts", expected: "coding", note: "file path with fix" },
    { input: "Виправ баг у src/auth.ts", expected: "coding", note: "Ukrainian + file path" },
    { input: "看看 lib/utils.js 怎么了", expected: "coding", note: "Chinese + file path" },
    { input: "create auth.ts", expected: "coding", note: "file extension at end" },
    { input: "створи auth.ts", expected: "coding", note: "Ukrainian + file extension at end" },
    { input: "Чому не працює main.py?", expected: "chat", note: "Ukrainian question + file = question, not coding" },
    { input: "What does ./config.json do?", expected: "other", note: "question + file = not coding" },

    // ── Code fences → coding ──
    { input: "Here's the code:\n```python\nprint('hello')\n```", expected: "coding", note: "code fence" },
    { input: "Подивись на цей код:\n```\nconst x = 1\n```", expected: "coding", note: "Ukrainian + code fence" },
    { input: "Use ~~~\nx = 1\n~~~", expected: "coding", note: "tilde code fence" },

    // ── Stacktraces → coding ──
    {
      input: "TypeError: Cannot read property 'x' of undefined\n    at Object.<anonymous> (index.js:42:5)",
      expected: "coding",
      note: "English stacktrace",
    },
    {
      input: "Помилка: Traceback (most recent call last):\n  File \"app.py\", line 10",
      expected: "coding",
      note: "Ukrainian + Python traceback",
    },
    { input: "Segmentation fault (core dumped)", expected: "coding", note: "segfault" },
    { input: "panic: runtime error: index out of range", expected: "coding", note: "Go panic" },

    // ── Git markers → coding ──
    { input: "Merge PR #42 into main", expected: "coding", note: "PR marker" },
    { input: "Commit the changes in src/", expected: "coding", note: "commit + file path" },
    { input: "Show me the diff between branches", expected: "coding", note: "diff marker" },
    { input: "Resolve merge conflict in main.go", expected: "coding", note: "merge conflict + file" },

    // ── CI/CD markers → coding ──
    { input: "Fix the GitHub Actions pipeline", expected: "coding", note: "CI marker" },
    { input: "Update the .github/workflows/ci.yml file", expected: "coding", note: "github path + file" },

    // ── Code syntax → coding ──
    { input: "function greet() { return 'hello' }", expected: "coding", note: "code syntax" },
    { input: "x = getValue()", expected: "coding", note: "assignment" },

    // ── Non-coding (no strong signals) ──
    { input: "Hello, how are you?", expected: "chat", note: "greeting, no code signals" },
    { input: "What is the weather today?", expected: "chat", note: "utility request" },
    { input: "Explain how TCP works", expected: "other", note: "knowledge question, no code signals" },
    { input: "Hi!", expected: "chat", note: "simple greeting" },
    { input: "Plan the architecture for a new system", expected: "other", note: "planning without execution" },
  ];

  it.each(cases)("$note: \"$input\" → $expected", ({ input, expected }) => {
    const result = classifyTask(input);

    if (expected === "coding") {
      expect(result.isCodingTask).toBe(true);
      expect(result.taskType).toBe("coding");
    } else if (expected === "chat") {
      expect(result.isCodingTask).toBe(false);
      expect(result.taskType).toBe("chat");
    } else {
      expect(result.isCodingTask).toBe(false);
    }
  });

  // ── hello world pattern ──
  it("hello world! triggers hello-world signal and is coding", () => {
    const result = classifyTask("hello world!");
    expect(result.isCodingTask).toBe(true);
    expect(result.signals).toContain("hello-world-en");
  });

  // ── "Hello, World!" (with space) — classic phrase but pattern is hello.world (one sep) ──
  it("Hello, World! (with space) — no pattern match, classified as other", () => {
    const result = classifyTask("Hello, World!");
    // hello.world requires ONE separator char; "Hello, World!" has comma+space (two)
    expect(result.isCodingTask).toBe(false);
  });

  // ── Signal presence checks ──
  it("reports file-path signal for file references", () => {
    const result = classifyTask("Fix src/auth.ts");
    expect(result.signals).toContain("file-path");
  });

  it("reports code-fence signal for fenced code blocks", () => {
    const result = classifyTask("```js\nconsole.log('hi')\n```");
    expect(result.signals).toContain("code-fence");
  });

  it("reports stacktrace signal for error traces", () => {
    const result = classifyTask("TypeError: cannot read property");
    expect(result.signals).toContain("stacktrace");
  });

  it("reports git-marker signal for PR references", () => {
    const result = classifyTask("Merge PR #42");
    expect(result.signals).toContain("git-marker");
  });

  it("reports ci-marker signal for GitHub Actions", () => {
    const result = classifyTask("Fix the GitHub Actions workflow");
    expect(result.signals).toContain("ci-marker");
  });

  // ── Strong signals override chat patterns ──
  it("strong signal overrides greeting pattern", () => {
    // "Hi, fix src/app.ts" has greeting + file-path
    const result = classifyTask("Hi, fix src/app.ts");
    expect(result.isCodingTask).toBe(true);
    expect(result.signals).toContain("file-path");
  });

  // ── Multiple strong signals compound ──
  it("multiple strong signals increase confidence", () => {
    const result = classifyTask("Merge PR #42: fix src/auth.ts");
    expect(result.isCodingTask).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  // ── Edge case: file-like but not a real file ──
  it("does not trigger file-path for non-file dotted words", () => {
    // "example.com" has a dot but no known file extension
    const result = classifyTask("Visit example.com for info");
    expect(result.signals).not.toContain("file-path");
  });

  // ── Assignment signal ──
  it("reports assignment signal for x = value patterns", () => {
    const result = classifyTask("config = get_config()");
    expect(result.signals).toContain("assignment");
  });

  // ── Code syntax signal ──
  it("reports code-syntax signal for function() { blocks", () => {
    const result = classifyTask("run(function() { done() })");
    expect(result.signals).toContain("code-syntax");
  });
});
