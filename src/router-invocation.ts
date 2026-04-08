import * as fs from "fs";
import * as path from "path";
import type { PluginConfig } from "./types";

export interface RouterInvocation {
  rawCommand: string;
  rawConfigPath: string;
  commandParts: string[];
  executable: string;
  executableResolved: string | null;
  baseArgs: string[];
  configPath: string;
}

export interface WorkspaceDiagnostics {
  rawPath: string | null;
  resolvedPath: string | null;
  realpath: string | null;
  exists: boolean;
  isDirectory: boolean;
}

function expandHomeToken(value: string): string {
  if (!value) return value;
  if (value === "~") return process.env.HOME || "/root";
  if (value.startsWith("~/")) {
    return path.join(process.env.HOME || "/root", value.slice(2));
  }
  return value;
}

function maybeResolvePath(value: string): string {
  const expanded = expandHomeToken(value);
  if (!expanded) return expanded;
  if (expanded.startsWith("/") || expanded.startsWith(".")) {
    return path.resolve(expanded);
  }
  return expanded;
}

function splitCommand(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  const pushCurrent = () => {
    if (current.length > 0) {
      parts.push(maybeResolvePath(current));
      current = "";
    }
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if (ch === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }

    if (/\s/.test(ch)) {
      pushCurrent();
      continue;
    }

    current += ch;
  }

  if (escaping) {
    current += "\\";
  }

  pushCurrent();
  return parts;
}

function resolveFromPath(executable: string): string | null {
  if (!executable) return null;
  if (executable.includes("/") || executable.startsWith(".")) {
    const resolved = path.resolve(executable);
    return resolved;
  }
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, executable);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function expandHomePath(value: string): string {
  return maybeResolvePath(value);
}

export function resolveRouterInvocation(config: Pick<PluginConfig, "routerCommand" | "routerConfigPath">): RouterInvocation {
  const commandParts = splitCommand(config.routerCommand || "");
  const executable = commandParts[0] || "";
  const baseArgs = commandParts.slice(1);
  return {
    rawCommand: config.routerCommand || "",
    rawConfigPath: config.routerConfigPath || "",
    commandParts,
    executable,
    executableResolved: resolveFromPath(executable),
    baseArgs,
    configPath: config.routerConfigPath ? expandHomePath(config.routerConfigPath) : "",
  };
}

export function describeWorkspacePath(rawPath?: string | null): WorkspaceDiagnostics {
  const raw = typeof rawPath === "string" && rawPath.trim() ? rawPath.trim() : null;
  if (!raw) {
    return {
      rawPath: null,
      resolvedPath: null,
      realpath: null,
      exists: false,
      isDirectory: false,
    };
  }
  const resolvedPath = expandHomePath(raw);
  const exists = fs.existsSync(resolvedPath);
  const isDirectory = exists ? fs.statSync(resolvedPath).isDirectory() : false;
  let realpath = resolvedPath;
  if (exists) {
    try {
      realpath = fs.realpathSync(resolvedPath);
    } catch {
      realpath = resolvedPath;
    }
  }
  return {
    rawPath: raw,
    resolvedPath,
    realpath,
    exists,
    isDirectory,
  };
}
