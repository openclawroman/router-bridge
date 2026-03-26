export interface WatchdogLimits {
  startupMs: number;
  healthProbeMs: number;
  executionMs: number;
  maxRetries: number;
}

export const DEFAULT_LIMITS: WatchdogLimits = {
  startupMs: 5000,
  healthProbeMs: 10000,
  executionMs: 120000,
  maxRetries: 3,
};

export class Watchdog {
  private limits: WatchdogLimits;
  private failureCount: number = 0;

  constructor(limits?: Partial<WatchdogLimits>) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
  }

  getHealthTimeout(): number {
    return this.limits.healthProbeMs;
  }

  getExecutionTimeout(): number {
    return this.limits.executionMs;
  }

  recordFailure(): void {
    this.failureCount++;
  }

  recordSuccess(): void {
    this.failureCount = 0;
  }

  isCircuitOpen(): boolean {
    return this.failureCount >= this.limits.maxRetries;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.failureCount = 0;
  }
}
