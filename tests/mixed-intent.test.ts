import { describe, it, expect } from "vitest";
import { classifyTask } from "../src/policy";

describe("mixed-intent classification", () => {
  const cases: { input: string; expectedCoding: boolean; expectedClass: string }[] = [
    // Execution intent should win over planning
    { input: "Сплануй і реалізуй API для користувачів", expectedCoding: true, expectedClass: "implementation" },
    { input: "Design and implement the auth module", expectedCoding: true, expectedClass: "implementation" },
    // Explanation + file = question (file path alone is NOT strong enough)
    { input: "Чому не працює main.py?", expectedCoding: false, expectedClass: "other" },
    // Pure planning = not coding
    { input: "Сплануй архітектуру", expectedCoding: false, expectedClass: "planner" },
    { input: "Plan the architecture for the new service", expectedCoding: false, expectedClass: "planner" },
    // Ukrainian coding action verbs
    { input: "Напиши функцію для обробки помилок", expectedCoding: true, expectedClass: "implementation" },
    { input: "Реалізуй авторизацію через JWT", expectedCoding: true, expectedClass: "implementation" },
    // Explanation questions should NOT be coding
    { input: "Як працює цей код?", expectedCoding: false, expectedClass: "other" },
    { input: "Explain how this function works", expectedCoding: false, expectedClass: "other" },
    // "fix" triggers execution intent — ambiguous question, execution wins
    { input: "How do I fix this error?", expectedCoding: true, expectedClass: "debug" },
    // Code fences = hard strong signal
    { input: "Check this \`\`\`python\nprint('hello')\n\`\`\`", expectedCoding: true, expectedClass: "code_review" },
    // File path + execution intent
    { input: "Fix the bug in src/auth.ts", expectedCoding: true, expectedClass: "debug" },
    // Mixed: both explanation and execution words
    { input: "Explain and implement the sorting algorithm", expectedCoding: true, expectedClass: "implementation" },
    // Code review
    { input: "Review this pull request for security issues", expectedCoding: true, expectedClass: "code_review" },
    // Debug task
    { input: "Debug the crash in the payment module", expectedCoding: true, expectedClass: "debug" },
    // Refactor task
    { input: "Refactor the database connection logic", expectedCoding: true, expectedClass: "refactor" },
    // Test generation
    { input: "Write unit tests for the user service", expectedCoding: true, expectedClass: "test_generation" },
    // Ukrainian question with code word
    { input: "Навіщо потрібен цей рефактор?", expectedCoding: false, expectedClass: "other" },
    // Ukrainian debug
    { input: "Виправ помилку в авторизації", expectedCoding: true, expectedClass: "debug" },
    // File path without question = execution
    { input: "Fix src/auth.ts", expectedCoding: true, expectedClass: "debug" },
    // Question about code without execution = explanation
    { input: "Як працює main.py?", expectedCoding: false, expectedClass: "other" },
  ];

  for (const { input, expectedCoding, expectedClass } of cases) {
    it(`"${input}" → coding=${expectedCoding}, class=${expectedClass}`, () => {
      const result = classifyTask(input);
      expect(result.isCodingTask).toBe(expectedCoding);
      expect(result.taskClass).toBe(expectedClass);
    });
  }
});
