// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-create-sizing-advisory.test.ts
 * @description Tests for wu:create sizing advisory integration (WU-2141)
 *
 * Verifies that wu:create emits advisory warnings when oversize
 * sizing_estimate lacks exception metadata.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { emitSizingAdvisory, type SizingAdvisoryInput } from '../wu-create-sizing-advisory.js';

describe('wu-create sizing advisory (WU-2141)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should emit no warnings when sizing_estimate is absent (backward compat)', () => {
    const input: SizingAdvisoryInput = {
      wuId: 'WU-100',
      logPrefix: '[wu:create]',
    };

    emitSizingAdvisory(input);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should emit no warnings when estimate is within thresholds', () => {
    const input: SizingAdvisoryInput = {
      wuId: 'WU-100',
      logPrefix: '[wu:create]',
      sizingEstimate: {
        estimated_files: 10,
        estimated_tool_calls: 30,
        strategy: 'single-session',
      },
    };

    emitSizingAdvisory(input);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should emit advisory warning when oversize without exception', () => {
    const input: SizingAdvisoryInput = {
      wuId: 'WU-100',
      logPrefix: '[wu:create]',
      sizingEstimate: {
        estimated_files: 30,
        estimated_tool_calls: 80,
        strategy: 'checkpoint-resume',
      },
    };

    emitSizingAdvisory(input);
    expect(warnSpy).toHaveBeenCalled();
    const firstCall = warnSpy.mock.calls[0]?.[0] as string;
    expect(firstCall).toContain('[wu:create]');
    expect(firstCall).toContain('WU-100');
  });

  it('should emit no warnings when oversize with valid exception', () => {
    const input: SizingAdvisoryInput = {
      wuId: 'WU-100',
      logPrefix: '[wu:create]',
      sizingEstimate: {
        estimated_files: 30,
        estimated_tool_calls: 80,
        strategy: 'checkpoint-resume',
        exception_type: 'docs-only',
        exception_reason: 'All markdown docs',
      },
    };

    emitSizingAdvisory(input);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('should include sizing guide reference in warning', () => {
    const input: SizingAdvisoryInput = {
      wuId: 'WU-200',
      logPrefix: '[wu:create]',
      sizingEstimate: {
        estimated_files: 60,
        estimated_tool_calls: 150,
        strategy: 'orchestrator-worker',
      },
    };

    emitSizingAdvisory(input);
    expect(warnSpy).toHaveBeenCalled();
    // Should reference the sizing guide
    const allWarnings = warnSpy.mock.calls.map((c) => c[0]).join(' ');
    expect(allWarnings).toContain('sizing');
  });
});
