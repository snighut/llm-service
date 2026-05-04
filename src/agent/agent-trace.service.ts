import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

export type AgentRunStatus = 'running' | 'completed' | 'failed';

export interface AgentRunStage {
  timestamp: string;
  name: string;
  data?: unknown;
}

export interface AgentToolReplayStep {
  tool: string;
  toolInput: Record<string, unknown>;
  observation: unknown;
}

export interface AgentRunRecord {
  runId: string;
  userId?: string;
  query: string;
  provider: string;
  model: string;
  status: AgentRunStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  error?: string;
  result?: {
    designId?: string;
    validationScore?: number;
    attempts?: number;
  };
  stages: AgentRunStage[];
  toolReplay: AgentToolReplayStep[];
}

@Injectable()
export class AgentTraceService {
  private readonly maxRuns: number;
  private readonly runs: AgentRunRecord[] = [];

  constructor() {
    const configured = Number(process.env.AGENT_TRACE_MAX_RUNS || 100);
    this.maxRuns =
      Number.isFinite(configured) && configured > 0 ? configured : 100;
  }

  startRun(params: {
    userId?: string;
    query: string;
    provider: string;
    model: string;
  }): string {
    const runId = randomUUID();
    const run: AgentRunRecord = {
      runId,
      userId: params.userId,
      query: params.query,
      provider: params.provider,
      model: params.model,
      status: 'running',
      startedAt: new Date().toISOString(),
      stages: [],
      toolReplay: [],
    };

    this.runs.unshift(run);
    this.trim();
    return runId;
  }

  appendStage(runId: string, name: string, data?: unknown): void {
    const run = this.find(runId);
    if (!run) {
      return;
    }

    run.stages.push({
      timestamp: new Date().toISOString(),
      name,
      data: this.sanitize(data),
    });
  }

  appendToolReplay(runId: string, steps: AgentToolReplayStep[]): void {
    if (!steps.length) {
      return;
    }

    const run = this.find(runId);
    if (!run) {
      return;
    }

    for (const step of steps) {
      run.toolReplay.push({
        tool: step.tool,
        toolInput: this.sanitize(step.toolInput) as Record<string, unknown>,
        observation: this.sanitize(step.observation),
      });
    }
  }

  completeRun(
    runId: string,
    result: { designId?: string; validationScore?: number; attempts?: number },
  ): void {
    const run = this.find(runId);
    if (!run) {
      return;
    }

    run.status = 'completed';
    run.endedAt = new Date().toISOString();
    run.durationMs = this.computeDuration(run.startedAt, run.endedAt);
    run.result = result;
  }

  failRun(runId: string, error: string): void {
    const run = this.find(runId);
    if (!run) {
      return;
    }

    run.status = 'failed';
    run.endedAt = new Date().toISOString();
    run.durationMs = this.computeDuration(run.startedAt, run.endedAt);
    run.error = error;
  }

  listRuns(
    userId?: string,
    limit = 20,
  ): Array<
    Pick<
      AgentRunRecord,
      | 'runId'
      | 'userId'
      | 'query'
      | 'provider'
      | 'model'
      | 'status'
      | 'startedAt'
      | 'endedAt'
      | 'durationMs'
      | 'result'
      | 'error'
    >
  > {
    const cappedLimit = Math.max(1, Math.min(limit, 100));
    const runs = this.runs
      .filter((run) => !userId || run.userId === userId)
      .slice(0, cappedLimit)
      .map((run) => ({
        runId: run.runId,
        userId: run.userId,
        query: run.query,
        provider: run.provider,
        model: run.model,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        durationMs: run.durationMs,
        result: run.result,
        error: run.error,
      }));

    return runs;
  }

  getRun(runId: string, userId?: string): AgentRunRecord | null {
    const run = this.find(runId);
    if (!run) {
      return null;
    }

    if (userId && run.userId && run.userId !== userId) {
      return null;
    }

    if (userId && !run.userId) {
      return null;
    }

    return run;
  }

  private find(runId: string): AgentRunRecord | undefined {
    return this.runs.find((run) => run.runId === runId);
  }

  private trim(): void {
    if (this.runs.length > this.maxRuns) {
      this.runs.length = this.maxRuns;
    }
  }

  private computeDuration(startedAt: string, endedAt: string): number {
    const started = new Date(startedAt).getTime();
    const ended = new Date(endedAt).getTime();
    if (!Number.isFinite(started) || !Number.isFinite(ended)) {
      return 0;
    }
    return Math.max(0, ended - started);
  }

  private sanitize(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (depth > 4) {
      return '[max-depth]';
    }

    if (typeof value === 'string') {
      return value.length > 2000
        ? `${value.slice(0, 2000)}...[truncated]`
        : value;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }

    if (Array.isArray(value)) {
      const sliced = value
        .slice(0, 50)
        .map((item) => this.sanitize(item, depth + 1));
      return value.length > 50 ? [...sliced, '[truncated-array]'] : sliced;
    }

    if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).slice(
        0,
        50,
      );
      const out: Record<string, unknown> = {};
      for (const [key, val] of entries) {
        out[key] = this.sanitize(val, depth + 1);
      }

      const totalKeys = Object.keys(value as Record<string, unknown>).length;
      if (totalKeys > 50) {
        out.__truncated__ = true;
      }
      return out;
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'symbol') {
      return value.description ? `Symbol(${value.description})` : 'Symbol()';
    }

    return '[unsupported-value]';
  }
}
