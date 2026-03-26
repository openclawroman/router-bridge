import * as fs from "fs";
import * as path from "path";

const REQUIRED_SECRETS = ["OPENROUTER_API_KEY"];
const OPTIONAL_SECRETS = ["ANTHROPIC_API_KEY"];
const ALL_SECRETS = [...REQUIRED_SECRETS, ...OPTIONAL_SECRETS];

export interface SecretStatus {
  name: string;
  required: boolean;
  present: boolean;
  source: "process" | "env_file" | "missing";
}

/**
 * Load secrets from env file into process.env (if not already set).
 * Returns which secrets were loaded.
 */
export function loadEnvFile(envFilePath: string): string[] {
  const loaded: string[] = [];

  if (!fs.existsSync(envFilePath)) return loaded;

  const content = fs.readFileSync(envFilePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    const value = trimmed.substring(eqIdx + 1).trim();

    if (ALL_SECRETS.includes(key) && !process.env[key] && value) {
      process.env[key] = value;
      loaded.push(key);
    }
  }

  return loaded;
}

/**
 * Check status of all secrets.
 * Order: process env → env file (if path provided)
 */
export function checkSecrets(envFilePath?: string): SecretStatus[] {
  // Optionally load env file first
  if (envFilePath) {
    loadEnvFile(envFilePath);
  }

  const results: SecretStatus[] = [];

  for (const name of REQUIRED_SECRETS) {
    results.push({
      name,
      required: true,
      present: !!process.env[name],
      source: process.env[name] ? "process" : "missing",
    });
  }

  for (const name of OPTIONAL_SECRETS) {
    results.push({
      name,
      required: false,
      present: !!process.env[name],
      source: process.env[name] ? "process" : "missing",
    });
  }

  return results;
}

/**
 * Validate that all required secrets are present.
 * Throws if any required secret is missing.
 */
export function validateSecrets(envFilePath?: string): void {
  const statuses = checkSecrets(envFilePath);
  const missing = statuses.filter(s => s.required && !s.present);

  if (missing.length > 0) {
    throw new Error(
      `Missing required secrets: ${missing.map(s => s.name).join(", ")}. ` +
      `Set them in process env or ~/.openclaw/router/env/router.env`
    );
  }
}

export { REQUIRED_SECRETS, OPTIONAL_SECRETS, ALL_SECRETS };
