import { randomUUID } from 'node:crypto';
import type { DecisionEvent, DecisionEventInput } from './types.js';
import { DEFAULT_PORT } from './types.js';

export interface EmitterOptions {
  /** collector URL, default http://127.0.0.1:4517 */
  url?: string;
  /** groups events from one agent run; default: one per process */
  sessionId?: string;
  /** flush interval, ms */
  flushMs?: number;
  /** called on delivery problems (default: stay silent — never spam the agent's logs) */
  onError?: (err: unknown) => void;
}

/**
 * Buffers events and POSTs them to the local collector in batches.
 * Hard rule: this must NEVER break or slow the host agent. Delivery is
 * fire-and-forget; if the collector is down events are dropped after a
 * bounded buffer fills.
 */
export class VerdictEmitter {
  readonly sessionId: string;
  private url: string;
  private buf: DecisionEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushMs: number;
  private onError?: (err: unknown) => void;
  private static MAX_BUFFER = 1000;

  constructor(opts: EmitterOptions = {}) {
    this.url = (opts.url ?? `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, '');
    this.sessionId = opts.sessionId ?? `session-${randomUUID().slice(0, 8)}`;
    this.flushMs = opts.flushMs ?? 300;
    this.onError = opts.onError;
  }

  emit(input: DecisionEventInput): DecisionEvent {
    const event: DecisionEvent = {
      id: randomUUID(),
      ts: input.ts ?? Date.now(),
      sessionId: input.sessionId ?? this.sessionId,
      ...input,
    };
    this.buf.push(event);
    if (this.buf.length > VerdictEmitter.MAX_BUFFER) {
      this.buf.splice(0, this.buf.length - VerdictEmitter.MAX_BUFFER);
    }
    this.schedule();
    return event;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushMs);
    // don't keep the host process alive just for telemetry
    if (typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
  }

  async flush(): Promise<void> {
    if (this.buf.length === 0) return;
    const batch = this.buf.splice(0, this.buf.length);
    try {
      await fetch(`${this.url}/api/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(2000),
      });
    } catch (err) {
      // collector not running — that's fine, drop and carry on
      this.onError?.(err);
    }
  }
}
