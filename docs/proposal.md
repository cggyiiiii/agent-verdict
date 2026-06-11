# Why your agent silently fails — and the case for a unified authorization decision event

*Draft v1 — discussion welcome. This is the design note behind [Verdict](../README.md).*

## The problem

An AI agent in 2026 doesn't fail in one place. Between the model and the thing
it wants to do sit at least five independent layers that can each say no:

1. **OAuth 2.1 scopes** (the MCP authorization spec) — the token simply doesn't
   carry `email:send`.
2. **Gateway policies** — an MCP proxy (Intercept, Bifrost, AGT, a corporate
   control plane) evaluated a YAML rule and blocked the call.
3. **Budgets and rate limits** — a virtual key or session budget was exhausted.
4. **Payment mandates** (AP2-style) — the purchase exceeded the mandate, or the
   merchant wasn't in the allowlist.
5. **Delegation chains** (DelegateOS-style capability tokens) — a sub-agent's
   attenuated authority was narrower than the parent's.

Each layer is good news for safety. Together they are a debugging disaster,
because **each one speaks its own dialect**: a JSON-RPC error here, an HTTP 402
there, an `isError: true` content block, a gateway log line, a mandate refusal
object. The agent developer sees one of two things: a stack trace with the
texture of a fortune cookie, or — worse — an agent that quietly gives up and
"hallucinates around" the denial.

Ask anyone running agents in production what they actually do today: they
grep five log formats and guess.

## The claim

Every one of these layers is answering the same three-part question:

> **Who** tried to do **what**, and **which rule** said no?

That answer has a common shape regardless of which layer produced it. We
propose recording it as a single event type — the **DecisionEvent** — emitted
at every authorization-relevant moment of an agent's life:

```jsonc
{
  "id": "uuid",
  "ts": 1781157104013,
  "sessionId": "run-42",            // one agent run
  "agent": "checkout-sub",          // which (sub-)agent acted
  "kind": "payment",                // tool_call | resource_read | payment | …
  "target": "checkout",             // tool / resource / action
  "args": { "cartTotal": 89.0 },
  "decision": "deny",               // allow | deny | error
  "reason": {
    "code": "delegation_invalid",   // machine-readable
    "message": "hop agent:checkout-sub is attenuated to $50; cart is $89",
    "source": "delegation",         // oauth-scope | gateway-policy | budget |
                                    // mandate | delegation | server
    "policy": "attenuation:spendLimit"
  },
  "budgets":   [{ "name": "session-spend", "limit": 150, "used": 89, "unit": "USD" }],
  "delegation": [{ "principal": "user:max", "spendLimit": 200 },
                 { "principal": "agent:shopper", "spendLimit": 150 },
                 { "principal": "agent:checkout-sub", "spendLimit": 50 }],
  "durationMs": 95,
  "raw": "…original error, for the curious…"
}
```

Three design decisions worth defending:

- **`decision` is a verdict, not a status code.** `deny` (a rule worked as
  intended) and `error` (something broke) are fundamentally different events
  that today get collapsed into "exception". Separating them is half the
  diagnostic value.
- **`reason.source` names the layer.** The first question a developer asks is
  not "what happened" but "*whose* rule fired". Six values cover the
  ecosystem today; the enum can grow.
- **Budgets and delegation are snapshots, not references.** A decision is only
  explainable with the state *at decision time*. "The budget was at $89 of
  $150 when this fired" must live in the event, because the budget has moved
  since.

## What this is not

- **Not a new authorization protocol.** The ecosystem doesn't need a sixth
  way to say no. This is an *observability* format — it translates the five
  existing dialects, it competes with none of them.
- **Not OpenTelemetry, and not a replacement for it.** OTel answers "what
  happened, where, how long". DecisionEvents answer one narrow question OTel
  has no semantics for: *why was this action allowed or denied*. (A natural
  embedding: a DecisionEvent as attributes on an OTel span. Adapter welcome.)
- **Not a hosted service.** Reference implementation is local-first: events
  go to a process on 127.0.0.1 and never leave the machine.

## Reference implementation

[Verdict](../README.md) implements the format end to end:

- a TypeScript SDK that wraps any MCP client in one line and classifies
  errors/refusals into DecisionEvents (plus a zero-dep Python SDK),
- `verdict tail` — adapts existing gateway/agent JSONL logs into the format,
- a local timeline UI with per-decision "why", budget burndown, delegation
  chain rendering, and time-travel replay of a failed run.

## Open questions

1. Should `reason.code` be a registry (IANA-style) or free-form with
   conventions? We currently ship ~10 conventional codes.
2. How should *multi-layer* decisions compose — e.g. a gateway that denies
   *because* an upstream OAuth refresh failed? (Current answer: outermost
   layer wins, `raw` carries the chain.)
3. Is there appetite for emitting this format natively from gateways and
   auth SDKs, so the classifier heuristics become unnecessary? That is the
   end state we'd like to reach.

If you maintain a gateway, an agent framework, or an auth layer and have
opinions about any of the above — issues and PRs are open.
