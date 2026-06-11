import { describe, expect, it } from 'vitest';
import { classifyMessage, errorToMessage, mcpResultText } from '../src/classify.js';

describe('classifyMessage', () => {
  it('classifies insufficient scope as oauth deny', () => {
    const c = classifyMessage('insufficient_scope: tool requires email:send');
    expect(c.decision).toBe('deny');
    expect(c.reason.code).toBe('scope_insufficient');
    expect(c.reason.source).toBe('oauth-scope');
  });

  it('classifies budget exhaustion as budget deny', () => {
    const c = classifyMessage('session spending limit exceeded: $150');
    expect(c.decision).toBe('deny');
    expect(c.reason.code).toBe('budget_exceeded');
    expect(c.reason.source).toBe('budget');
  });

  it('classifies HTTP 402 via code as budget deny', () => {
    const c = classifyMessage('Payment Required', 402);
    expect(c.decision).toBe('deny');
    expect(c.reason.source).toBe('budget');
  });

  it('classifies 401/403 as oauth deny', () => {
    expect(classifyMessage('Unauthorized', 401).reason.code).toBe('unauthorized');
    expect(classifyMessage('Forbidden').reason.code).toBe('forbidden');
  });

  it('classifies gateway policy blocks', () => {
    const c = classifyMessage('blocked by policy: no-credential-mutation');
    expect(c.decision).toBe('deny');
    expect(c.reason.source).toBe('gateway-policy');
  });

  it('classifies delegation problems', () => {
    const c = classifyMessage('delegation expired for hop agent:sub');
    expect(c.decision).toBe('deny');
    expect(c.reason.source).toBe('delegation');
  });

  it('classifies mandate refusal', () => {
    const c = classifyMessage('mandate rejected: merchant not in allowlist');
    expect(c.decision).toBe('deny');
    expect(c.reason.source).toBe('mandate');
  });

  it('falls back to server error for unknown failures', () => {
    const c = classifyMessage('upstream timeout after 5000ms');
    expect(c.decision).toBe('error');
    expect(c.reason.source).toBe('server');
  });
});

describe('errorToMessage', () => {
  it('handles Error instances with codes', () => {
    const err = Object.assign(new Error('nope'), { code: 403 });
    expect(errorToMessage(err)).toEqual({ message: 'nope', code: 403 });
  });

  it('handles plain objects', () => {
    expect(errorToMessage({ message: 'denied', code: 'POLICY' })).toEqual({ message: 'denied', code: 'POLICY' });
  });

  it('handles strings', () => {
    expect(errorToMessage('boom').message).toBe('boom');
  });
});

describe('mcpResultText', () => {
  it('extracts text from isError results', () => {
    const r = { isError: true, content: [{ type: 'text', text: 'permission denied' }] };
    expect(mcpResultText(r)).toBe('permission denied');
  });

  it('returns null for successful results', () => {
    expect(mcpResultText({ content: [{ type: 'text', text: 'ok' }] })).toBeNull();
    expect(mcpResultText(null)).toBeNull();
  });
});
