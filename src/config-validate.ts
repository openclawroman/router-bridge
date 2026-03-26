import type { PluginConfig } from "./types";
import { RolloutLevel } from "./types";

export interface ConfigValidation {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

const VALID_ROLLOUT_LEVELS = new Set<string>(Object.values(RolloutLevel));

export function validateConfig(config: PluginConfig): ConfigValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Required fields
  if (!config.scopeMode) errors.push("Missing scopeMode");
  if (!config.backendMode) errors.push("Missing backendMode");
  if (!config.routerCommand) errors.push("Missing routerCommand");

  // Deprecation warnings
  if ((config as any).enableAutoFallback !== undefined) {
    warnings.push("enableAutoFallback is deprecated; use fallbackToNativeOnError");
  }
  if ((config as any).routerTimeout !== undefined) {
    warnings.push("routerTimeout is deprecated; use routerCommand timeout");
  }
  if ((config as any).healthCheckInterval !== undefined) {
    warnings.push("healthCheckInterval is deprecated; use healthCacheTtlMs");
  }

  // Value validation
  if (config.healthCacheTtlMs !== undefined && config.healthCacheTtlMs < 1000) {
    errors.push("healthCacheTtlMs must be >= 1000");
  }
  if (config.rolloutLevel !== undefined && !VALID_ROLLOUT_LEVELS.has(config.rolloutLevel)) {
    errors.push(`Invalid rolloutLevel: ${config.rolloutLevel}`);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
