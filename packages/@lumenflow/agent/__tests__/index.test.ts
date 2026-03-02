import { describe, expect, it } from 'vitest';
import * as agent from '../src/index.js';

describe('agent package barrel exports', () => {
  it('re-exports session and incident APIs', () => {
    expect(typeof agent.startSession).toBe('function');
    expect(typeof agent.getCurrentSession).toBe('function');
    expect(typeof agent.logIncident).toBe('function');
    expect(typeof agent.endSession).toBe('function');
    expect(typeof agent.appendIncident).toBe('function');
    expect(typeof agent.readIncidents).toBe('function');
  });

  it('re-exports verification, auto-session, and feedback APIs', () => {
    expect(typeof agent.verifyWUComplete).toBe('function');
    expect(typeof agent.startSessionForWU).toBe('function');
    expect(typeof agent.endSessionForWU).toBe('function');
    expect(typeof agent.getCurrentSessionForWU).toBe('function');
    expect(typeof agent.generateDraft).toBe('function');
    expect(typeof agent.reviewFeedback).toBe('function');
  });
});
