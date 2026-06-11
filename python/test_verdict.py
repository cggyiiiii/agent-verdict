"""Run: python3 python/test_verdict.py — stdlib-only smoke tests."""
import sys

from verdict import classify_message, VerdictEmitter, instrument


def test_classify():
    d, r = classify_message("insufficient_scope: tool requires email:send")
    assert d == "deny" and r["code"] == "scope_insufficient" and r["source"] == "oauth-scope"

    d, r = classify_message("session spending limit exceeded")
    assert d == "deny" and r["source"] == "budget"

    d, r = classify_message("blocked by policy: rule-7")
    assert d == "deny" and r["source"] == "gateway-policy"

    d, r = classify_message("upstream timeout after 5000ms")
    assert d == "error" and r["source"] == "server"


def test_emit_and_instrument():
    v = VerdictEmitter(url="http://127.0.0.1:1", agent="t")  # nothing listening — must not raise
    e = v.emit(target="x", decision="allow")
    assert e["sessionId"].startswith("session-") and e["agent"] == "t"

    calls = []
    v.emit = lambda **kw: calls.append(kw) or kw  # capture

    @instrument(v, target="send_email")
    def send_email():
        raise PermissionError("permission denied: needs email:send scope")

    try:
        send_email()
        raise AssertionError("should have re-raised")
    except PermissionError:
        pass
    assert calls[0]["decision"] == "deny"
    assert calls[0]["reason"]["code"] in ("scope_insufficient", "denied")


if __name__ == "__main__":
    test_classify()
    test_emit_and_instrument()
    print("python sdk: all tests passed")
    sys.exit(0)
