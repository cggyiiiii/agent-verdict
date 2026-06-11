/**
 * The core data model: one DecisionEvent per authorization-relevant moment
 * in an agent's life. This is the "unified decision event format" — the
 * common subset across MCP auth, gateway policies, payment mandates and
 * delegation chains.
 */

export type Decision = 'allow' | 'deny' | 'error';

export type ReasonSource =
  | 'oauth-scope'      // OAuth 2.1 scope / token problems (MCP auth spec)
  | 'gateway-policy'   // an MCP gateway / proxy policy rule fired
  | 'mandate'          // payment mandate (AP2-style) refused
  | 'budget'           // spend or rate budget exhausted
  | 'delegation'       // delegation chain invalid / over-scoped
  | 'server'           // the tool server itself errored
  | 'unknown';

export interface Reason {
  /** machine-readable, e.g. "scope_insufficient", "budget_exceeded" */
  code: string;
  /** human-readable explanation of why */
  message: string;
  /** which layer produced the decision */
  source: ReasonSource;
  /** name/id of the policy, scope or mandate that fired, if known */
  policy?: string;
}

export interface BudgetSnapshot {
  /** budget label, e.g. "session-usd" or "tool-calls" */
  name: string;
  limit: number;
  used: number;
  unit?: string;
}

export interface DelegationHop {
  principal: string;          // who, e.g. "user:max" or "agent:planner"
  scopes?: string[];          // what this hop is allowed to do
  spendLimit?: number;        // cap at this hop, if any
}

export interface DecisionEvent {
  id: string;
  /** ms since epoch */
  ts: number;
  /** groups events from one agent run */
  sessionId: string;
  /** which agent (or sub-agent) acted */
  agent?: string;
  /** what kind of action was attempted */
  kind: 'tool_call' | 'resource_read' | 'prompt' | 'payment' | 'custom';
  /** tool / resource / action name */
  target: string;
  /** arguments as the agent sent them (caller may redact) */
  args?: unknown;
  decision: Decision;
  reason?: Reason;
  /** budget state at decision time, if tracked */
  budgets?: BudgetSnapshot[];
  /** delegation chain root → leaf, if known */
  delegation?: DelegationHop[];
  /** how long the call took, ms */
  durationMs?: number;
  /** raw error / result snippet for the detail panel */
  raw?: string;
}

/** What SDK users pass to observe()/emit — id/ts/sessionId are filled in. */
export type DecisionEventInput = Omit<DecisionEvent, 'id' | 'ts' | 'sessionId'> &
  Partial<Pick<DecisionEvent, 'ts' | 'sessionId'>>;

export const DEFAULT_PORT = 4517;
