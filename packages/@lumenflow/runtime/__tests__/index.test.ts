import { describe, expect, it } from 'vitest';
import * as runtime from '../src/index.js';

describe('runtime package barrel exports', () => {
  it('re-exports daemon client and core runtime classes', () => {
    expect(typeof runtime.sendDaemonRequest).toBe('function');
    expect(typeof runtime.routeRequestWithDaemonFallback).toBe('function');
    expect(typeof runtime.RuntimeDaemon).toBe('function');
    expect(typeof runtime.TaskScheduler).toBe('function');
    expect(typeof runtime.SessionManager).toBe('function');
    expect(typeof runtime.UnixSocketServer).toBe('function');
  });
});
