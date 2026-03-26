import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { redactSecrets, redactSecretsFromObject, checkFilePermissions, checkDirPermissions, auditSecurity } from "../src/security";

describe("security", () => {
  describe("redactSecrets", () => {
    it("redacts OpenAI keys", () => {
      const text = "key: sk-abcdefghijklmnopqrst";
      const redacted = redactSecrets(text);
      expect(redacted).not.toContain("sk-abcdefghijklmnopqrst");
      expect(redacted).toContain("sk-a***qrst");
    });

    it("redacts GitHub tokens", () => {
      const text = "token: ghp_1234567890abcdefghijklmnopqrstuvwxyz";
      const redacted = redactSecrets(text);
      expect(redacted).not.toContain("ghp_1234567890abcdefghijklmnopqrstuvwxyz");
      expect(redacted).toContain("***");
    });

    it("redacts Anthropic keys", () => {
      const text = "key: sk-ant-api03-abcdefghijklmnopqrstuv";
      const redacted = redactSecrets(text);
      expect(redacted).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuv");
      expect(redacted).toContain("***");
    });

    it("preserves non-secret text", () => {
      const text = "Hello, this is a normal message";
      expect(redactSecrets(text)).toBe(text);
    });
  });

  describe("redactSecretsFromObject", () => {
    it("redacts secrets in object values", () => {
      const obj = { key: "sk-abcdefghijklmnopqrst", name: "test" };
      const redacted = redactSecretsFromObject(obj);
      expect(redacted.key).toContain("***");
      expect(redacted.name).toBe("test");
    });

    it("handles nested objects", () => {
      const obj = { outer: { inner: "sk-abcdefghijklmnopqrst" } };
      const redacted = redactSecretsFromObject(obj);
      expect((redacted.outer as any).inner).toContain("***");
    });
  });

  describe("checkFilePermissions", () => {
    it("returns ok for non-existent files", () => {
      expect(checkFilePermissions("/nonexistent/file")).toEqual({ ok: true, issue: null });
    });

    it("detects world-writable files", () => {
      const tmpFile = path.join(os.tmpdir(), `test-world-writable-${Date.now()}`);
      fs.writeFileSync(tmpFile, "test");
      fs.chmodSync(tmpFile, 0o666);
      try {
        const result = checkFilePermissions(tmpFile);
        expect(result.ok).toBe(false);
        expect(result.issue).toContain("world-writable");
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it("passes for restrictive permissions", () => {
      const tmpFile = path.join(os.tmpdir(), `test-restrictive-${Date.now()}`);
      fs.writeFileSync(tmpFile, "test");
      fs.chmodSync(tmpFile, 0o600);
      try {
        expect(checkFilePermissions(tmpFile)).toEqual({ ok: true, issue: null });
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });
});
