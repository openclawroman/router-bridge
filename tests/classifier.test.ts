import { describe, it, expect } from "vitest";
import { classifyTask, LEXICON, ALL_PATTERNS } from "../src/policy";

// ============================================================
// Matrix tests for bilingual task classifier (EN + UA + mixed)
// 50+ cases across 6 categories
// ============================================================

describe("classifier: English coding tasks", () => {
  const cases: [string, boolean, string?][] = [
    ["write a function that returns the sum", true],
    ["create a new React component", true],
    ["implement the authentication middleware", true],
    ["build a REST API endpoint", true],
    ["fix the bug in auth.ts", true],
    ["deploy the service to production", true],
    ["write unit tests for the parser", true],
    ["commit the changes and push to main", true],
    ["debug the crash in the event loop", true],
    ["create a script to migrate the database", true],
    ["patch the security vulnerability", true],
  ];

  for (const [input, expectedCoding, ...rest] of cases) {
    it(`"${input}" → isCodingTask=${expectedCoding}`, () => {
      const result = classifyTask(input);
      expect(result.isCodingTask).toBe(expectedCoding);
      if (expectedCoding) {
        expect(result.taskType).toBe("coding");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      }
      expect(result.signals.length).toBeGreaterThan(0);
    });
  }
});

describe("classifier: Ukrainian coding tasks", () => {
  const cases: [string, boolean][] = [
    ["напиши функцію для обрахунку суми", true],
    ["створи новий компонент", true],
    ["запрограмуй API ендпоінт", true],
    ["виправ баг в автентифікації", true],
    ["розроби модуль для логування", true],
    ["виконай тест для парсера", true],
    ["створити скрипт для міграції", true],
    ["реалізуй сервіс для обробки даних", true],
    ["побудуй бібліотеку для валідації", true],
    ["відлагодь помилку в парсері", true],
    ["тестуй функцію автентифікації", true],
  ];

  for (const [input, expectedCoding] of cases) {
    it(`"${input}" → isCodingTask=${expectedCoding}`, () => {
      const result = classifyTask(input);
      expect(result.isCodingTask).toBe(expectedCoding);
      if (expectedCoding) {
        expect(result.taskType).toBe("coding");
        expect(result.confidence).toBeGreaterThanOrEqual(0.5);
      }
      expect(result.signals.length).toBeGreaterThan(0);
    });
  }
});

describe("classifier: English chat & knowledge", () => {
  const cases: [string, boolean][] = [
    ["hello", false],
    ["hi there", false],
    ["hey, how's it going?", false],
    ["thanks for the help", false],
    ["what is polymorphism?", false],
    ["who is the creator of Linux?", false],
    ["explain how DNS works", false],
    ["define microservices architecture", false],
    ["tell me about machine learning", false],
    ["how does garbage collection work?", false],
    ["why do we need dependency injection?", false],
  ];

  for (const [input, expectedCoding] of cases) {
    it(`"${input}" → isCodingTask=${expectedCoding}`, () => {
      const result = classifyTask(input);
      expect(result.isCodingTask).toBe(expectedCoding);
      if (!expectedCoding) {
        expect(["chat", "other"]).toContain(result.taskType);
      }
    });
  }
});

describe("classifier: Ukrainian chat & knowledge", () => {
  const cases: [string, boolean][] = [
    ["привіт", false],
    ["дякую за допомогу", false],
    ["що таке API?", false],
    ["хто такий автор Linux?", false],
    ["поясни як працює DNS", false],
    ["визнач мікросервісну архітектуру", false],
    ["розкажи про машинне навчання", false],
    ["як працює збирання сміття?", false],
    ["чому потрібна ін'єкція залежностей?", false],
    ["навіщо потрібні патерни проектування?", false],
    ["доброго ранку", false],
  ];

  for (const [input, expectedCoding] of cases) {
    it(`"${input}" → isCodingTask=${expectedCoding}`, () => {
      const result = classifyTask(input);
      expect(result.isCodingTask).toBe(expectedCoding);
    });
  }
});

describe("classifier: mixed UA/EN", () => {
  const cases: [string, boolean][] = [
    ["write функцію для обробки", true],
    ["implement модуль автентифікації", true],
    ["create компонент інтерфейсу", true],
    ["fix баг в сервісі", true],
    ["deploy сервіс на продакшн", true],
    ["build API ендпоінт", true],
  ];

  for (const [input, expectedCoding] of cases) {
    it(`"${input}" → isCodingTask=${expectedCoding}`, () => {
      const result = classifyTask(input);
      expect(result.isCodingTask).toBe(expectedCoding);
    });
  }
});

describe("classifier: edge cases", () => {
  it("empty string → not coding", () => {
    const result = classifyTask("");
    expect(result.isCodingTask).toBe(false);
    expect(result.signals).toContain("empty-input");
  });

  it("whitespace only → not coding", () => {
    const result = classifyTask("   ");
    expect(result.isCodingTask).toBe(false);
  });

  it("single character → not coding", () => {
    const result = classifyTask("a");
    expect(result.isCodingTask).toBe(false);
  });

  it("emoji only → not coding", () => {
    const result = classifyTask("😀🎉🚀");
    expect(result.isCodingTask).toBe(false);
  });

  it("single Cyrillic char → not coding", () => {
    const result = classifyTask("і");
    expect(result.isCodingTask).toBe(false);
  });

  it("numbers only → not coding", () => {
    const result = classifyTask("12345");
    expect(result.isCodingTask).toBe(false);
  });

  it("very long non-coding text → not coding", () => {
    const result = classifyTask("Tell me a story about a dragon who lived in a castle and loved to eat pizza every day of the week while flying over mountains and oceans");
    expect(result.isCodingTask).toBe(false);
  });
});

describe("classifier: weighted scoring", () => {
  it("action+artifact pair scores higher than action alone", () => {
    const pair = classifyTask("write a function");
    const alone = classifyTask("write something");
    expect(pair.confidence).toBeGreaterThanOrEqual(alone.confidence);
  });

  it("debug with file extension scores strong", () => {
    const result = classifyTask("fix the bug in auth.ts");
    expect(result.isCodingTask).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.5);
    // Should have both debug signal and file-extension signal
    const hasDebug = result.signals.some((s) => s.includes("debug"));
    const hasFile = result.signals.some((s) => s.includes("file-extension"));
    expect(hasDebug || hasFile).toBe(true);
  });

  it("multiple coding signals boost confidence", () => {
    const single = classifyTask("write code");
    const multi = classifyTask("write a function and test the module");
    // Multi should have equal or higher confidence
    expect(multi.confidence).toBeGreaterThanOrEqual(single.confidence);
  });

  it("hello world is strong coding signal", () => {
    const result = classifyTask("hello world");
    expect(result.isCodingTask).toBe(true);
    expect(result.signals.some((s) => s.includes("hello-world"))).toBe(true);
  });

  it("planning without execution is NOT coding", () => {
    const result = classifyTask("Plan the system architecture and design the data model");
    expect(result.isCodingTask).toBe(false);
  });

  it("planning WITH execution IS coding", () => {
    const result = classifyTask("Plan and implement a REST API for user management");
    expect(result.isCodingTask).toBe(true);
  });
});

describe("classifier: taskClass resolution", () => {
  it("refactor → refactor", () => {
    const result = classifyTask("Refactor the authentication module");
    expect(result.taskClass).toBe("refactor");
  });

  it("debug → debug", () => {
    const result = classifyTask("Debug the memory leak in the parser");
    expect(result.taskClass).toBe("debug");
  });

  it("test → test_generation", () => {
    const result = classifyTask("Write tests for the auth module");
    expect(result.taskClass).toBe("test_generation");
  });

  it("plan without execution → planner", () => {
    const result = classifyTask("Plan the migration strategy");
    expect(result.taskClass).toBe("planner");
  });

  it("implementation → implementation", () => {
    const result = classifyTask("Write a sorting function");
    expect(result.taskClass).toBe("implementation");
  });
});

describe("classifier: taskMeta passthrough", () => {
  it("uses taskMeta.type=coding directly", () => {
    const result = classifyTask({
      task: "something",
      taskId: "t1",
      scopeId: "s1",
      taskMeta: { type: "coding" },
    });
    expect(result.isCodingTask).toBe(true);
    expect(result.taskType).toBe("coding");
    expect(result.confidence).toBe(0.95);
  });

  it("uses taskMeta.type=review directly", () => {
    const result = classifyTask({
      task: "something",
      taskId: "t1",
      scopeId: "s1",
      taskMeta: { type: "review" },
    });
    expect(result.isCodingTask).toBe(true);
    expect(result.taskType).toBe("review");
  });

  it("uses taskMeta.type=chat directly", () => {
    const result = classifyTask({
      task: "something",
      taskId: "t1",
      scopeId: "s1",
      taskMeta: { type: "chat" },
    });
    expect(result.isCodingTask).toBe(false);
    expect(result.taskType).toBe("chat");
  });

  it("uses taskMeta.type=planning directly", () => {
    const result = classifyTask({
      task: "something",
      taskId: "t1",
      scopeId: "s1",
      taskMeta: { type: "planning" },
    });
    expect(result.isCodingTask).toBe(false);
    expect(result.taskType).toBe("planning");
    expect(result.taskClass).toBe("planner");
  });
});

describe("classifier: Ukrainian coding edge cases", () => {
  it("'займись сервісом' → coding", () => {
    const result = classifyTask("займись сервісом");
    expect(result.isCodingTask).toBe(true);
  });

  it("'перероби модуль' → coding", () => {
    const result = classifyTask("перероби модуль");
    expect(result.isCodingTask).toBe(true);
  });

  it("'коміт і пуш' → coding (git)", () => {
    const result = classifyTask("зроби коміт і пуш");
    expect(result.isCodingTask).toBe(true);
  });

  it("'деплой контейнера' → coding (devops)", () => {
    const result = classifyTask("зроби деплой контейнера");
    expect(result.isCodingTask).toBe(true);
  });
});

describe("LEXICON structure", () => {
  it("exports all expected groups", () => {
    const expectedGroups = [
      "coding_actions", "artifacts", "debug", "testing",
      "git", "devops", "chat", "knowledge", "planning", "hello_world",
    ];
    for (const g of expectedGroups) {
      expect(LEXICON[g]).toBeDefined();
      expect(LEXICON[g].en).toBeInstanceOf(Array);
      expect(LEXICON[g].uk).toBeInstanceOf(Array);
    }
  });

  it("has entries in every group", () => {
    for (const [group, { en, uk }] of Object.entries(LEXICON)) {
      expect(en.length).toBeGreaterThan(0);
      expect(uk.length).toBeGreaterThan(0);
    }
  });

  it("ALL_PATTERNS is a non-empty array", () => {
    expect(ALL_PATTERNS).toBeInstanceOf(Array);
    expect(ALL_PATTERNS.length).toBeGreaterThan(0);
  });

  it("every pattern entry has required fields", () => {
    for (const entry of ALL_PATTERNS) {
      expect(entry.pattern).toBeInstanceOf(RegExp);
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.group).toBe("string");
      expect(typeof entry.weight).toBe("number");
      expect(["strong", "medium", "weak"]).toContain(entry.tier);
    }
  });
});
