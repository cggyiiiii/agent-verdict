import type { Decision, Reason, ReasonSource } from './types.js';

/**
 * Heuristic classifier: turns the messy reality of MCP errors, gateway
 * rejections, OAuth failures and budget refusals into a (decision, reason)
 * pair. This is the part that "translates" every layer's dialect into one
 * format — the core value of the tool lives here and it grows adapter by
 * adapter.
 */

interface Pattern {
  re: RegExp;
  code: string;
  source: ReasonSource;
}

// Order matters: first match wins. Most specific first.
const DENY_PATTERNS: Pattern[] = [
  { re: /insufficient[_ ]scope|scope.{0,20}(required|missing|insufficient)/i, code: 'scope_insufficient', source: 'oauth-scope' },
  { re: /invalid[_ ]token|token.{0,20}expired|expired.{0,20}token/i, code: 'token_expired', source: 'oauth-scope' },
  { re: /unauthorized|401/i, code: 'unauthorized', source: 'oauth-scope' },
  { re: /forbidden|403/i, code: 'forbidden', source: 'oauth-scope' },
  { re: /budget.{0,30}(exceeded|exhausted|limit)|spend(ing)?[_ ]limit|payment[_ ]required|402/i, code: 'budget_exceeded', source: 'budget' },
  { re: /rate[_ ]limit|too many requests|429/i, code: 'rate_limited', source: 'budget' },
  { re: /mandate.{0,30}(refused|rejected|invalid|expired)|not.{0,10}authori[sz]ed.{0,20}(merchant|payment)/i, code: 'mandate_refused', source: 'mandate' },
  { re: /delegation.{0,30}(invalid|expired|revoked)|attenuat|capability.{0,20}(missing|narrow)/i, code: 'delegation_invalid', source: 'delegation' },
  { re: /policy.{0,30}(denied|blocked|violation)|blocked by policy|guardrail/i, code: 'policy_blocked', source: 'gateway-policy' },
  { re: /not (allowed|permitted)|permission denied|access denied|denied/i, code: 'denied', source: 'gateway-policy' },
];

export interface Classified {
  decision: Decision;
  reason: Reason;
}

/** Classify an error (thrown) or an error-ish result message. */
export function classifyMessage(message: string, code?: string | number): Classified {
  const haystack = `${code ?? ''} ${message}`;
  for (const p of DENY_PATTERNS) {
    if (p.re.test(haystack)) {
      return {
        decision: 'deny',
        reason: { code: p.code, message: message.trim(), source: p.source },
      };
    }
  }
  return {
    decision: 'error',
    reason: { code: 'server_error', message: message.trim(), source: 'server' },
  };
}

/** Best-effort extraction of a message from whatever was thrown. */
export function errorToMessage(err: unknown): { message: string; code?: string | number } {
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: string | number; status?: number };
    return { message: err.message, code: anyErr.code ?? anyErr.status };
  }
  if (typeof err === 'object' && err !== null) {
    const o = err as Record<string, unknown>;
    const message =
      (typeof o.message === 'string' && o.message) ||
      (typeof o.error === 'string' && o.error) ||
      JSON.stringify(err);
    const code = (typeof o.code === 'string' || typeof o.code === 'number') ? o.code : undefined;
    return { message, code };
  }
  return { message: String(err) };
}

/**
 * MCP tool results signal failure in-band: { isError: true, content: [...] }.
 * Pull the text out so we can classify it.
 */
export function mcpResultText(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null;
  const r = result as { isError?: boolean; content?: Array<{ type?: string; text?: string }> };
  if (!r.isError) return null;
  const texts = (r.content ?? [])
    .filter((c) => typeof c?.text === 'string')
    .map((c) => c.text as string);
  return texts.join('\n') || 'tool returned isError with no text';
}
