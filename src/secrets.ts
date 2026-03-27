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

export interface ProviderAuthStatus {
  provider: string;
  configured: boolean;
  method: string; // "env_var", "cli_auth", "cli_auth_or_key"
  keyEnv?: string;
}

/**
 * Check if Codex CLI has auth configured.
 * Checks for ~/.codex/config, ~/.codex/auth.json, or OPENAI_API_KEY.
 */
export function checkCodexAuth(): boolean {
  if (process.env.OPENAI_API_KEY) return true;

  const home = process.env.HOME || "/root";
  const codexConfigPaths = [
    path.join(home, ".codex", "config"),
    path.join(home, ".codex", "auth.json"),
    path.join(home, ".codex", "config.json"),
  ];

  for (const p of codexConfigPaths) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.size > 0) return true;
      }
    } catch {
      // continue checking
    }
  }

  return false;
}

/**
 * Check if Claude Code has auth configured.
 * Checks for ANTHROPIC_API_KEY, ~/.config/claude/credentials, or ~/.claude/credentials.
 */
export function checkClaudeAuth(): boolean {
  if (process.env.ANTHROPIC_API_KEY) return true;

  const home = process.env.HOME || "/root";
  const claudeCredentialPaths = [
    path.join(home, ".config", "claude", "credentials"),
    path.join(home, ".claude", "credentials"),
    path.join(home, ".config", "claude", "config.json"),
    path.join(home, ".claude", "config.json"),
  ];

  for (const p of claudeCredentialPaths) {
    try {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (stat.size > 0) return true;
      }
    } catch {
      // continue checking
    }
  }

  return false;
}

/**
 * Check auth status for each provider.
 * Provider-aware: each provider has its own auth method.
 */
export function checkProviderAuth(): ProviderAuthStatus[] {
  return [
    {
      provider: "codex_cli",
      configured: checkCodexAuth(),
      method: "cli_auth",
    },
    {
      provider: "claude_code",
      configured: !!process.env.ANTHROPIC_API_KEY || checkClaudeAuth(),
      method: "cli_auth_or_key",
      keyEnv: "ANTHROPIC_API_KEY",
    },
    {
      provider: "openrouter",
      configured: !!process.env.OPENROUTER_API_KEY,
      method: "env_var",
      keyEnv: "OPENROUTER_API_KEY",
    },
  ];
}

/**
 * Get the list of providers that have auth configured.
 */
export function getConfiguredProviders(): string[] {
  return checkProviderAuth()
    .filter(p => p.configured)
    .map(p => p.provider);
}

/**
 * Get the list of providers that are missing auth.
 */
export function getUnconfiguredProviders(): ProviderAuthStatus[] {
  return checkProviderAuth().filter(p => !p.configured);
}

/**
 * Check if at least one provider has auth configured.
 */
export function hasAnyProviderAuth(): boolean {
  return checkProviderAuth().some(p => p.configured);
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
 * Validate that at least one provider has auth configured.
 * Provider-aware: does not require OPENROUTER_API_KEY if other providers are configured.
 */
export function validateSecrets(envFilePath?: string): void {
  if (envFilePath) {
    loadEnvFile(envFilePath);
  }

  if (!hasAnyProviderAuth()) {
    throw new Error(
      "No provider auth configured. Set at least one of: " +
      "OPENROUTER_API_KEY (OpenRouter), ANTHROPIC_API_KEY (Claude), " +
      "or configure codex/claude CLI auth."
    );
  }
}

export { REQUIRED_SECRETS, OPTIONAL_SECRETS, ALL_SECRETS };
