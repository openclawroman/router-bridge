/**
 * Fake OpenClaw host API for E2E / integration testing.
 *
 * Captures every registration (commands, skills, services, event listeners)
 * so that tests can invoke them directly without a real OpenClaw runtime.
 */

export interface CapturedCommand {
  name: string;
  description?: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (ctx: any) => Promise<any>;
}

export interface CapturedSkill {
  id: string;
  match: (input: string) => any;
  handler: (ctx: any) => Promise<any>;
}

export interface CapturedService {
  id: string;
  start: () => void;
  stop: () => void;
}

export interface FakeOpenClawApi {
  /** Simulates api.registerCommand — captures full descriptor */
  registerCommand: (descriptor: CapturedCommand) => void;

  /** Simulates api.registerSkill */
  registerSkill: (descriptor: CapturedSkill) => void;

  /** Simulates api.registerService */
  registerService: (descriptor: CapturedService) => void;

  /** Simulates api.on — handler receives (event, ctx) and returns result */
  on: (event: string, handler: (event: any, ctx: any) => Promise<any>) => void;

  /** Simulates api.config — the real API exposes this as a property */
  config: Record<string, any>;

  /** Logger stub */
  logger: {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
  };

  /** All captured registrations, organised by type */
  handlers: {
    commandHandlers: Record<string, CapturedCommand>;
    skillHandlers: Record<string, CapturedSkill>;
    serviceHandlers: Record<string, CapturedService>;
    eventHandlers: Record<string, Array<(event: any, ctx: any) => Promise<any>>>;
  };
}

/**
 * Create a new fake API instance.
 *
 * @param pluginConfigOverrides  Optional overrides placed at the path
 *        getConfig() reads: api.config.plugins.entries["router-bridge"].config
 */
export function createFakeOpenClawApi(
  pluginConfigOverrides: Record<string, any> = {},
): FakeOpenClawApi {
  const handlers: FakeOpenClawApi["handlers"] = {
    commandHandlers: {},
    skillHandlers: {},
    serviceHandlers: {},
    eventHandlers: {},
  };

  const config = {
    plugins: {
      entries: {
        "router-bridge": {
          config: pluginConfigOverrides,
        },
      },
    },
  };

  const api: FakeOpenClawApi = {
    registerCommand(descriptor: CapturedCommand) {
      handlers.commandHandlers[descriptor.name] = descriptor;
    },

    registerSkill(descriptor: CapturedSkill) {
      handlers.skillHandlers[descriptor.id] = descriptor;
    },

    registerService(descriptor: CapturedService) {
      handlers.serviceHandlers[descriptor.id] = descriptor;
    },

    on(event: string, handler: (event: any, ctx: any) => Promise<any>) {
      if (!handlers.eventHandlers[event]) {
        handlers.eventHandlers[event] = [];
      }
      handlers.eventHandlers[event].push(handler);
    },

    config,

    logger: {
      info: (..._args: any[]) => {},
      warn: (..._args: any[]) => {},
      error: (..._args: any[]) => {},
    },

    handlers,
  };

  return api;
}

/**
 * Backward-compatible alias.
 * Older tests import { createFakeApi } — this keeps them working.
 */
export const createFakeApi = createFakeOpenClawApi;
