import { classifyMessage, errorToMessage, mcpResultText } from './classify.js';
import { VerdictEmitter, type EmitterOptions } from './emitter.js';
import type { BudgetSnapshot, DelegationHop } from './types.js';

/**
 * Structural type for an MCP client — anything with callTool/readResource
 * shaped like the official @modelcontextprotocol/sdk Client. Duck-typed on
 * purpose: no dependency on any SDK version.
 */
export interface MCPClientLike {
  callTool?: (params: { name: string; arguments?: Record<string, unknown> }, ...rest: unknown[]) => Promise<unknown>;
  readResource?: (params: { uri: string }, ...rest: unknown[]) => Promise<unknown>;
}

export interface ObserveOptions extends EmitterOptions {
  /** label for this agent in the timeline, e.g. "planner" */
  agent?: string;
  /** redact argument values, keep keys (default false) */
  redactArgs?: boolean;
  /** static delegation chain to attach to every event */
  delegation?: DelegationHop[];
  /** budget snapshots provider, called at each decision */
  budgets?: () => BudgetSnapshot[];
}

function redact(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return args;
  return Object.fromEntries(Object.keys(args as object).map((k) => [k, '«redacted»']));
}

function snippet(v: unknown, max = 2000): string {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch {
    return String(v);
  }
}

/**
 * The three-lines-to-adopt entrypoint:
 *
 *   import { observe } from 'agent-verdict';
 *   const client = observe(new Client(...), { agent: 'planner' });
 *   // use client exactly as before — open http://localhost:4517
 */
export function observe<T extends MCPClientLike>(client: T, opts: ObserveOptions = {}): T {
  const emitter = new VerdictEmitter(opts);
  const agent = opts.agent;

  const record = async (
    kind: 'tool_call' | 'resource_read',
    target: string,
    args: unknown,
    run: () => Promise<unknown>,
  ): Promise<unknown> => {
    const started = Date.now();
    const base = {
      kind,
      target,
      agent,
      args: opts.redactArgs ? redact(args) : args,
      delegation: opts.delegation,
      budgets: opts.budgets?.(),
    };
    try {
      const result = await run();
      const errText = mcpResultText(result);
      if (errText !== null) {
        // tool "succeeded" at the protocol level but reported failure in-band
        const c = classifyMessage(errText);
        emitter.emit({ ...base, decision: c.decision, reason: c.reason, durationMs: Date.now() - started, raw: snippet(result) });
      } else {
        emitter.emit({ ...base, decision: 'allow', durationMs: Date.now() - started });
      }
      return result;
    } catch (err) {
      const { message, code } = errorToMessage(err);
      const c = classifyMessage(message, code);
      emitter.emit({ ...base, decision: c.decision, reason: c.reason, durationMs: Date.now() - started, raw: snippet(message) });
      throw err; // observation must never swallow errors
    }
  };

  return new Proxy(client, {
    get(t, prop, receiver) {
      const orig = Reflect.get(t, prop, receiver);
      if (prop === 'callTool' && typeof orig === 'function') {
        return (params: { name: string; arguments?: Record<string, unknown> }, ...rest: unknown[]) =>
          record('tool_call', params?.name ?? 'unknown', params?.arguments, () => orig.call(t, params, ...rest));
      }
      if (prop === 'readResource' && typeof orig === 'function') {
        return (params: { uri: string }, ...rest: unknown[]) =>
          record('resource_read', params?.uri ?? 'unknown', undefined, () => orig.call(t, params, ...rest));
      }
      if (typeof orig === 'function') return orig.bind(t);
      return orig;
    },
  });
}
