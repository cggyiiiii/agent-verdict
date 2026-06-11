import { describe, expect, it, vi } from 'vitest';
import { observe } from '../src/observe.js';
import { VerdictEmitter } from '../src/emitter.js';

function captureEmits() {
  const events: unknown[] = [];
  const spy = vi.spyOn(VerdictEmitter.prototype, 'emit').mockImplementation(function (this: VerdictEmitter, input: any) {
    events.push(input);
    return input;
  });
  return { events, restore: () => spy.mockRestore() };
}

describe('observe', () => {
  it('emits allow for successful tool calls and returns the result untouched', async () => {
    const { events, restore } = captureEmits();
    const client = {
      callTool: async () => ({ content: [{ type: 'text', text: 'done' }] }),
    };
    const observed = observe(client, { agent: 'tester' });
    const result = await observed.callTool({ name: 'search', arguments: { q: 'x' } });
    expect((result as any).content[0].text).toBe('done');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ decision: 'allow', target: 'search', agent: 'tester', kind: 'tool_call' });
    restore();
  });

  it('classifies thrown auth errors as deny and rethrows', async () => {
    const { events, restore } = captureEmits();
    const client = {
      callTool: async () => { throw Object.assign(new Error('insufficient_scope: needs email:send'), { code: -32603 }); },
    };
    const observed = observe(client);
    await expect(observed.callTool({ name: 'send_email' })).rejects.toThrow('insufficient_scope');
    expect(events[0]).toMatchObject({
      decision: 'deny',
      target: 'send_email',
      reason: { code: 'scope_insufficient', source: 'oauth-scope' },
    });
    restore();
  });

  it('detects in-band isError results as deny when message matches', async () => {
    const { events, restore } = captureEmits();
    const client = {
      callTool: async () => ({ isError: true, content: [{ type: 'text', text: 'blocked by policy: rule-7' }] }),
    };
    const observed = observe(client);
    await observed.callTool({ name: 'update_payment' });
    expect(events[0]).toMatchObject({ decision: 'deny', reason: { source: 'gateway-policy' } });
    restore();
  });

  it('redacts args when asked', async () => {
    const { events, restore } = captureEmits();
    const client = { callTool: async () => ({}) };
    const observed = observe(client, { redactArgs: true });
    await observed.callTool({ name: 't', arguments: { card: '4111-1111' } });
    expect((events[0] as any).args).toEqual({ card: '«redacted»' });
    restore();
  });

  it('leaves non-instrumented methods working', async () => {
    const client = {
      callTool: async () => ({}),
      somethingElse: () => 42,
    };
    const observed = observe(client as any);
    expect((observed as any).somethingElse()).toBe(42);
  });
});
