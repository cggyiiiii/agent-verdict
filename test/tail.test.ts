import { describe, expect, it } from 'vitest';
import { lineToEvent } from '../src/tail.js';

describe('lineToEvent', () => {
  it('maps a typical gateway JSONL line heuristically', () => {
    const e = lineToEvent(JSON.stringify({
      timestamp: '2026-06-11T10:00:00Z',
      tool: 'send_email',
      decision: 'blocked',
      reason: 'blocked by policy: no-external-email',
      rule: 'no-external-email',
      agent_id: 'shopper',
      session_id: 's-42',
    }));
    expect(e).toMatchObject({
      target: 'send_email',
      decision: 'deny',
      agent: 'shopper',
      sessionId: 's-42',
      reason: { source: 'gateway-policy', policy: 'no-external-email' },
    });
    expect(typeof e!.ts).toBe('number');
  });

  it('treats allow outcomes without reason as allow', () => {
    const e = lineToEvent(JSON.stringify({ name: 'search', outcome: 'success' }));
    expect(e).toMatchObject({ target: 'search', decision: 'allow' });
    expect(e!.reason).toBeUndefined();
  });

  it('classifies reason text when decision field is absent', () => {
    const e = lineToEvent(JSON.stringify({ tool: 'checkout', error: 'spending limit exceeded' }));
    expect(e).toMatchObject({ decision: 'deny', reason: { code: 'budget_exceeded', source: 'budget' } });
  });

  it('honors an explicit field map with custom deny values', () => {
    const e = lineToEvent(
      JSON.stringify({ op: 'transfer', verdictX: 'NOPE', why: 'mandate rejected: bad merchant' }),
      { target: ['op'], decision: ['verdictX'], reason: ['why'], denyValues: ['nope'] },
    );
    expect(e).toMatchObject({ target: 'transfer', decision: 'deny', reason: { source: 'mandate' } });
  });

  it('classifies plain-text lines', () => {
    const e = lineToEvent('2026-06-11 ERROR permission denied for tool update_payment');
    expect(e).toMatchObject({ decision: 'deny' });
  });

  it('skips unusable lines', () => {
    expect(lineToEvent('')).toBeNull();
    expect(lineToEvent(JSON.stringify({ level: 'info', msg2: 'hi' }))).toBeNull();
  });

  it('parses second-resolution unix timestamps', () => {
    const e = lineToEvent(JSON.stringify({ tool: 't', decision: 'allow', ts: 1781157104 }));
    expect(e!.ts).toBe(1781157104000);
  });
});
