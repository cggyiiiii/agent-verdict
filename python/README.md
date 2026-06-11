# agent-verdict (Python SDK)

Zero-dependency Python client for [Verdict](../README.md) — send authorization
decision events from any Python agent to the local dashboard.

```bash
# start the dashboard (Node)
npx verdict

# then in your agent
python your_agent.py
```

```python
from verdict import VerdictEmitter, instrument

v = VerdictEmitter(agent="research-agent")

@instrument(v, target="search_web")
def search_web(query: str):
    ...  # any raised PermissionError / scope error is classified automatically

v.emit(kind="payment", target="checkout", decision="deny",
       reason={"code": "budget_exceeded",
               "message": "session budget exhausted: $89 + $50 > $100",
               "source": "budget"},
       budgets=[{"name": "session-spend", "limit": 100, "used": 89, "unit": "USD"}])
```

Single file, stdlib only — copy `verdict.py` into your project or
`pip install agent-verdict` once published.
