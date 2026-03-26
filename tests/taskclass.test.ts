import { describe, it, expect } from "vitest";
import { classifyTask } from "../src/policy";

describe("task_class mapping", () => {
  it("implementation task maps to implementation", () => {
    const result = classifyTask("Write a sorting function");
    expect(result.taskClass).toBe("implementation");
  });

  it("refactor task maps to refactor", () => {
    const result = classifyTask("Refactor the authentication module");
    expect(result.taskClass).toBe("refactor");
  });

  it("debug task maps to debug", () => {
    const result = classifyTask("Debug the memory leak in the parser");
    expect(result.taskClass).toBe("debug");
  });

  it("review task maps to code_review", () => {
    const result = classifyTask("Review the pull request changes");
    expect(result.taskClass).toBe("code_review");
  });

  it("planning task maps to planner", () => {
    const result = classifyTask("Plan the migration strategy");
    expect(result.taskClass).toBe("planner");
  });

  it("test task maps to test_generation", () => {
    const result = classifyTask("Write tests for the auth module");
    expect(result.taskClass).toBe("test_generation");
  });
});
