"""
agent-verdict Python SDK — zero dependencies.

Send authorization decision events to a local Verdict collector
(`npx verdict` to start one) so you can see WHY every tool call
was allowed or denied at http://localhost:4517.

Quick start:

    from verdict import VerdictEmitter, instrument

    v = VerdictEmitter(agent="my-agent")

    @instrument(v, target="send_email")
    def send_email(to, body):
        ...  # any exception/refusal is classified and reported

    # or emit manually:
    v.emit(kind="payment", target="checkout", decision="deny",
           reason={"code": "budget_exceeded",
                   "message": "session budget exhausted",
                   "source": "budget"})
"""

from __future__ import annotations

import atexit
import functools
import json
import queue
import re
import threading
import time
import urllib.request
import uuid

DEFAULT_URL = "http://127.0.0.1:4517"

# (regex, code, source) — first match wins; mirrors the TypeScript classifier.
_DENY_PATTERNS = [
    (re.compile(r"insufficient[_ ]scope|scope.{0,20}(required|missing|insufficient)", re.I),
     "scope_insufficient", "oauth-scope"),
    (re.compile(r"invalid[_ ]token|token.{0,20}expired|expired.{0,20}token", re.I),
     "token_expired", "oauth-scope"),
    (re.compile(r"unauthorized|401", re.I), "unauthorized", "oauth-scope"),
    (re.compile(r"forbidden|403", re.I), "forbidden", "oauth-scope"),
    (re.compile(r"budget.{0,30}(exceeded|exhausted|limit)|spend(ing)?[_ ]limit|payment[_ ]required|402", re.I),
     "budget_exceeded", "budget"),
    (re.compile(r"rate[_ ]limit|too many requests|429", re.I), "rate_limited", "budget"),
    (re.compile(r"mandate.{0,30}(refused|rejected|invalid|expired)", re.I),
     "mandate_refused", "mandate"),
    (re.compile(r"delegation.{0,30}(invalid|expired|revoked)|attenuat|capability.{0,20}(missing|narrow)", re.I),
     "delegation_invalid", "delegation"),
    (re.compile(r"policy.{0,30}(denied|blocked|violation)|blocked by policy|guardrail", re.I),
     "policy_blocked", "gateway-policy"),
    (re.compile(r"not (allowed|permitted)|permission denied|access denied|denied", re.I),
     "denied", "gateway-policy"),
]


def classify_message(message: str, code=None):
    """Return (decision, reason_dict) for an error message."""
    haystack = f"{code or ''} {message}"
    for pattern, rcode, source in _DENY_PATTERNS:
        if pattern.search(haystack):
            return "deny", {"code": rcode, "message": message.strip(), "source": source}
    return "error", {"code": "server_error", "message": message.strip(), "source": "server"}


class VerdictEmitter:
    """Buffers events and POSTs them to the collector from a daemon thread.

    Hard rule: must NEVER break or slow the host agent. Delivery is
    best-effort; if the collector is down, events are dropped.
    """

    def __init__(self, url: str = DEFAULT_URL, agent: str | None = None,
                 session_id: str | None = None, flush_interval: float = 0.3):
        self.url = url.rstrip("/")
        self.agent = agent
        self.session_id = session_id or f"session-{uuid.uuid4().hex[:8]}"
        self._q: queue.Queue = queue.Queue(maxsize=1000)
        self._interval = flush_interval
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()
        atexit.register(self.flush)

    def emit(self, *, kind: str = "tool_call", target: str, decision: str,
             reason: dict | None = None, args=None, agent: str | None = None,
             budgets: list | None = None, delegation: list | None = None,
             duration_ms: float | None = None, raw: str | None = None) -> dict:
        event = {
            "id": str(uuid.uuid4()),
            "ts": int(time.time() * 1000),
            "sessionId": self.session_id,
            "kind": kind,
            "target": target,
            "decision": decision,
        }
        if reason: event["reason"] = reason
        if args is not None: event["args"] = args
        if agent or self.agent: event["agent"] = agent or self.agent
        if budgets: event["budgets"] = budgets
        if delegation: event["delegation"] = delegation
        if duration_ms is not None: event["durationMs"] = round(duration_ms)
        if raw: event["raw"] = raw[:2000]
        try:
            self._q.put_nowait(event)
        except queue.Full:
            pass  # drop rather than block the agent
        return event

    def _drain(self) -> list:
        batch = []
        while True:
            try:
                batch.append(self._q.get_nowait())
            except queue.Empty:
                return batch

    def _post(self, batch: list):
        if not batch:
            return
        try:
            req = urllib.request.Request(
                f"{self.url}/api/events",
                data=json.dumps({"events": batch}).encode(),
                headers={"content-type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=2)
        except Exception:
            pass  # collector not running — fine

    def _worker(self):
        while True:
            time.sleep(self._interval)
            self._post(self._drain())

    def flush(self):
        self._post(self._drain())


def instrument(emitter: VerdictEmitter, target: str | None = None,
               kind: str = "tool_call", agent: str | None = None):
    """Decorator: report each call of the wrapped function as a decision event.

    Exceptions are classified (deny vs error) and ALWAYS re-raised.
    """
    def deco(fn):
        name = target or fn.__name__

        @functools.wraps(fn)
        def wrapper(*a, **kw):
            started = time.time()
            try:
                result = fn(*a, **kw)
                emitter.emit(kind=kind, target=name, decision="allow", agent=agent,
                             args=kw or None, duration_ms=(time.time() - started) * 1000)
                return result
            except Exception as err:
                decision, reason = classify_message(str(err), getattr(err, "code", None))
                emitter.emit(kind=kind, target=name, decision=decision, reason=reason,
                             agent=agent, args=kw or None, raw=repr(err),
                             duration_ms=(time.time() - started) * 1000)
                raise

        return wrapper
    return deco
