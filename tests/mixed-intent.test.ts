import { describe, it, expect } from "vitest";
import { classifyTask } from "../src/policy";

describe("mixed-intent classification", () => {
  const cases = [
    // Explanation intent → not coding (even with coding words)
    { input: "Поясни що робить ця функція", expectedCoding: false, expectedClass: "other" },
    { input: "Explain how this code works", expectedCoding: false, expectedClass: "other" },
    { input: "Що таке API?", expectedCoding: false, expectedClass: "other" },
    { input: "What is polymorphism?", expectedCoding: false, expectedClass: "other" },
    { input: "Порівняй React та Vue", expectedCoding: false, expectedClass: "other" },
    { input: "Compare Python and Rust performance", expectedCoding: false, expectedClass: "other" },
    { input: "Чому цей код не працює?", expectedCoding: false, expectedClass: "other" },

    // Execution intent → coding
    { input: "Напиши функцію для сортування", expectedCoding: true, expectedClass: "implementation" },
    { input: "Виправ баг у auth.ts", expectedCoding: true, expectedClass: "debug" },
    { input: "Сплануй і реалізуй API для користувачів", expectedCoding: true, expectedClass: "planner" },
    { input: "Рефактори модуль авторизації", expectedCoding: true, expectedClass: "refactor" },
    { input: "Напиши тести для UserService", expectedCoding: true, expectedClass: "test_generation" },
    { input: "Write unit tests for the auth module", expectedCoding: true, expectedClass: "test_generation" },
    { input: "Зроби code review мого PR", expectedCoding: true, expectedClass: "code_review" },

    // Mixed intent: explanation + execution
    { input: "Проаналізуй помилку і виправ її", expectedCoding: true, expectedClass: "debug" },
    { input: "Поясни що робить код і додай логування", expectedCoding: true, expectedClass: "implementation" },

    // Edge: question with file → coding (strong signal overrides)
    { input: "Чому не працює main.py?", expectedCoding: true, expectedClass: "implementation" },

    // Edge: plan without implementation → planner (not coding)
    { input: "Сплануй архітектуру", expectedCoding: false, expectedClass: "planner" },
    { input: "Plan the architecture for the new service", expectedCoding: false, expectedClass: "planner" },
  ];

  for (const { input, expectedCoding, expectedClass } of cases) {
    it(`"${input}" → coding=${expectedCoding}, class=${expectedClass}`, () => {
      const result = classifyTask(input);
      expect(result.isCodingTask).toBe(expectedCoding);
      expect(result.taskClass).toBe(expectedClass);
    });
  }
});
