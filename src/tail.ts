import { createReadStream, statSync, watchFile, unwatchFile, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { classifyMessage } from './classify.js';
import { VerdictEmitter } from './emitter.js';
import type { Decision, DecisionEvent, DecisionEventInput } from './types.js';

/**
 * `verdict tail` — the generic gateway adapter. Follows a JSONL (or plain
 * text) log file and converts each appended line into a DecisionEvent.
 *
 * Two modes:
 *  - heuristic (default): recognizes common field names used by MCP
 *    gateways/proxies (tool/name/target, decision/action/outcome,
 *    reason/message/error, …) and classifies free-text reasons.
 *  - mapping file (--map map.json): explicit field mapping for any format.
 */

export interface FieldMap {
  /** source field names, first match wins */
  target?: string[];
  decision?: string[];
  reason?: string[];
  agent?: string[];
  session?: string[];
  ts?: string[];
  policy?: string[];
  /** values of the decision field that mean deny / allow / error */
  denyValues?: string[];
  allowValues?: string[];
  errorValues?: string[];
  /** static kind for all events from this log */
  kind?: DecisionEvent['kind'];
}

const DEFAULT_MAP: Required<Omit<FieldMap, 'kind'>> & Pick<FieldMap, 'kind'> = {
  target: ['target', 'tool', 'tool_name', 'toolName', 'name', 'method', 'action', 'uri', 'resource'],
  decision: ['decision', 'outcome', 'verdict', 'result', 'status', 'allowed'],
  reason: ['reason', 'message', 'error', 'detail', 'explanation', 'deny_reason', 'denyReason'],
  agent: ['agent', 'agent_id', 'agentId', 'client', 'client_id', 'principal'],
  session: ['session', 'session_id', 'sessionId', 'run_id', 'runId', 'trace_id', 'traceId'],
  ts: ['ts', 'timestamp', 'time', 'created_at', 'createdAt', '@timestamp'],
  policy: ['policy', 'rule', 'policy_name', 'policyName', 'rule_id', 'ruleId'],
  denyValues: ['deny', 'denied', 'block', 'blocked', 'reject', 'rejected', 'forbidden', 'false', 'violation'],
  allowValues: ['allow', 'allowed', 'permit', 'permitted', 'pass', 'passed', 'ok', 'success', 'true'],
  errorValues: ['error', 'failed', 'failure', 'exception', 'timeout'],
};

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
}

function parseTs(v: unknown): number | undefined {
  if (typeof v === 'number') return v > 1e12 ? v : v > 1e9 ? v * 1000 : undefined;
  if (typeof v === 'string') {
    const d = Date.parse(v);
    if (!Number.isNaN(d)) return d;
    const n = Number(v);
    if (!Number.isNaN(n)) return parseTs(n);
  }
  return undefined;
}

/** Convert one log line into a DecisionEventInput, or null if unusable. */
export function lineToEvent(line: string, map: FieldMap = {}): DecisionEventInput | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const m = { ...DEFAULT_MAP, ...Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined)) };

  let obj: Record<string, unknown> | null = null;
  try { obj = JSON.parse(trimmed) as Record<string, unknown>; } catch { /* plain text line */ }

  if (obj === null || typeof obj !== 'object') {
    // plain text: classify the whole line
    const c = classifyMessage(trimmed);
    return {
      kind: m.kind ?? 'custom',
      target: trimmed.slice(0, 60),
      decision: c.decision,
      reason: c.reason,
      raw: trimmed.slice(0, 2000),
    };
  }

  const target = pick(obj, m.target);
  const rawDecision = pick(obj, m.decision);
  const reasonText = pick(obj, m.reason);
  if (target === undefined && rawDecision === undefined && reasonText === undefined) return null;

  let decision: Decision | undefined;
  let reason: DecisionEventInput['reason'];

  if (rawDecision !== undefined) {
    const dv = String(rawDecision).toLowerCase();
    if (m.denyValues.includes(dv)) decision = 'deny';
    else if (m.allowValues.includes(dv)) decision = 'allow';
    else if (m.errorValues.includes(dv)) decision = 'error';
  }

  if (reasonText !== undefined) {
    const c = classifyMessage(String(reasonText));
    decision = decision ?? c.decision;
    reason = c.reason;
  } else if (decision === 'deny') {
    reason = { code: 'denied', message: 'denied by upstream (no reason in log)', source: 'gateway-policy' };
  }

  if (decision === undefined) decision = 'allow';
  if (decision === 'allow') reason = undefined;

  const policy = pick(obj, m.policy);
  if (reason && policy !== undefined) reason.policy = String(policy);

  return {
    kind: m.kind ?? 'tool_call',
    target: String(target ?? 'unknown'),
    decision,
    reason,
    agent: pick(obj, m.agent) !== undefined ? String(pick(obj, m.agent)) : undefined,
    sessionId: pick(obj, m.session) !== undefined ? String(pick(obj, m.session)) : undefined,
    ts: parseTs(pick(obj, m.ts)),
    raw: trimmed.slice(0, 2000),
  };
}

export interface TailOptions {
  url: string;
  mapFile?: string;
  /** replay the whole existing file first (default: only new lines) */
  fromStart?: boolean;
  onEvent?: (e: DecisionEventInput) => void;
}

export function tailFile(file: string, opts: TailOptions): () => void {
  const map: FieldMap = opts.mapFile
    ? (JSON.parse(readFileSync(opts.mapFile, 'utf8')) as FieldMap)
    : {};
  const emitter = new VerdictEmitter({
    url: opts.url,
    sessionId: `tail-${file.split('/').pop()}-${randomUUID().slice(0, 6)}`,
  });

  let offset = opts.fromStart ? 0 : statSync(file).size;
  let leftover = '';
  let reading = false;
  let pending = false;

  const readNew = () => {
    if (reading) { pending = true; return; }
    const size = statSync(file).size;
    if (size < offset) offset = 0; // truncated/rotated
    if (size === offset) return;
    reading = true;
    const stream = createReadStream(file, { start: offset, end: size - 1, encoding: 'utf8' });
    stream.on('data', (chunk) => {
      const lines = (leftover + chunk).split('\n');
      leftover = lines.pop() ?? '';
      for (const line of lines) {
        const e = lineToEvent(line, map);
        if (e) {
          emitter.emit(e);
          opts.onEvent?.(e);
        }
      }
    });
    stream.on('end', () => {
      offset = size;
      reading = false;
      if (pending) { pending = false; readNew(); }
    });
    stream.on('error', () => { reading = false; });
  };

  if (opts.fromStart) readNew();
  watchFile(file, { interval: 400 }, readNew);

  return () => {
    unwatchFile(file, readNew);
    void emitter.flush();
  };
}
