import { describe, it, expect, beforeEach } from "vitest";
import {
  recordClassification,
  getMetrics,
  resetMetrics,
} from "../src/classifier/metrics";
import type { ClassificationResult } from "../src/classifier/metrics";

function makeResult(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    isCodingTask: true,
    taskType: "coding",
    taskClass: "implementation",
    confidence: 0.75,
    signals: ["test"],
    ...overrides,
  };
}

describe("classifier metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  it("records classification event", () => {
    const result = makeResult({ confidence: 0.9 });
    recordClassification("Write a function", "write a function", result);

    const m = getMetrics();
    expect(m.totalClassifications).toBe(1);
    expect(m.recentEvents).toHaveLength(1);
    expect(m.recentEvents[0].input).toBe("Write a function");
    expect(m.recentEvents[0].normalizedInput).toBe("write a function");
    expect(m.recentEvents[0].result.confidence).toBe(0.9);
  });

  it("counts coding detections", () => {
    recordClassification("a", "a", makeResult({ taskType: "coding", isCodingTask: true }));
    recordClassification("b", "b", makeResult({ taskType: "coding", isCodingTask: true }));
    recordClassification("c", "c", makeResult({ taskType: "chat", isCodingTask: false }));

    const m = getMetrics();
    expect(m.codingDetections).toBe(2);
    expect(m.chatDetections).toBe(1);
  });

  it("counts chat detections", () => {
    recordClassification("hello", "hello", makeResult({ taskType: "chat", isCodingTask: false }));
    recordClassification("привіт", "привіт", makeResult({ taskType: "chat", isCodingTask: false }));
    recordClassification("bye", "bye", makeResult({ taskType: "other", isCodingTask: false }));

    const m = getMetrics();
    expect(m.chatDetections).toBe(2);
    expect(m.otherDetections).toBe(1);
  });

  it("calculates average confidence", () => {
    recordClassification("a", "a", makeResult({ confidence: 0.5 }));
    recordClassification("b", "b", makeResult({ confidence: 1.0 }));

    const m = getMetrics();
    expect(m.avgConfidence).toBe(0.75);
  });

  it("detects language breakdown — Ukrainian", () => {
    recordClassification("напиши функцію", "напиши функцію", makeResult());
    recordClassification("створи модуль", "створи модуль", makeResult());

    const m = getMetrics();
    expect(m.languageBreakdown.uk).toBe(2);
    expect(m.languageBreakdown.en).toBe(0);
    expect(m.languageBreakdown.mixed).toBe(0);
  });

  it("detects language breakdown — English", () => {
    recordClassification("write a function", "write a function", makeResult());

    const m = getMetrics();
    expect(m.languageBreakdown.en).toBe(1);
    expect(m.languageBreakdown.uk).toBe(0);
  });

  it("detects language breakdown — mixed", () => {
    recordClassification("напиши write function", "напиши write function", makeResult());

    const m = getMetrics();
    expect(m.languageBreakdown.mixed).toBe(1);
  });

  it("resets metrics", () => {
    recordClassification("a", "a", makeResult({ confidence: 0.9 }));
    resetMetrics();

    const m = getMetrics();
    expect(m.totalClassifications).toBe(0);
    expect(m.codingDetections).toBe(0);
    expect(m.chatDetections).toBe(0);
    expect(m.otherDetections).toBe(0);
    expect(m.avgConfidence).toBe(0);
    expect(m.languageBreakdown.uk).toBe(0);
    expect(m.recentEvents).toHaveLength(0);
  });

  it("limits recent events to 100", () => {
    for (let i = 0; i < 150; i++) {
      recordClassification(`input${i}`, `input${i}`, makeResult());
    }

    const m = getMetrics();
    expect(m.recentEvents).toHaveLength(100);
    expect(m.totalClassifications).toBe(150);
  });

  it("getMetrics returns a copy (mutation does not affect internal state)", () => {
    recordClassification("a", "a", makeResult());
    const m = getMetrics();
    m.totalClassifications = 999;
    m.recentEvents = [];

    const m2 = getMetrics();
    expect(m2.totalClassifications).toBe(1);
    expect(m2.recentEvents).toHaveLength(1);
  });

  it("tracks signals in events", () => {
    const result = makeResult({ signals: ["action+artifact", "coding-action-ua"] });
    recordClassification("Write function", "write function", result);

    const m = getMetrics();
    expect(m.recentEvents[0].result.signals).toEqual(["action+artifact", "coding-action-ua"]);
  });
});
