// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import type { ToolCapability } from '../kernel.schemas.js';
import { ExecutionContextSchema, ToolOutputSchema } from '../kernel.schemas.js';
import { ToolRegistry } from '../tool-host/index.js';

describe('tool registry', () => {
  function makeCapability(name: string): ToolCapability {
    return {
      name,
      domain: 'kernel',
      version: '1.0.0',
      input_schema: z.object({
        path: z.string(),
      }),
      output_schema: z.object({
        success: z.boolean(),
      }),
      permission: 'write',
      required_scopes: [
        {
          type: 'path',
          pattern: 'packages/@lumenflow/kernel/src/**',
          access: 'write',
        },
      ],
      handler: {
        kind: 'in-process',
        fn: async () => ({ success: true }),
      },
      description: 'Write kernel files',
      pack: 'software-delivery',
    };
  }

  it('registers, looks up, and lists capabilities', () => {
    const registry = new ToolRegistry();
    const capability = makeCapability('fs:write');

    registry.register(capability);

    expect(registry.lookup('fs:write')?.name).toBe('fs:write');
    expect(registry.list().map((item) => item.name)).toEqual(['fs:write']);
  });

  it('returns null when lookup misses', () => {
    const registry = new ToolRegistry();
    expect(registry.lookup('does:not:exist')).toBeNull();
  });

  it('throws when registering duplicate tool names', () => {
    const registry = new ToolRegistry();
    const capability = makeCapability('proc:exec');
    registry.register(capability);

    expect(() => registry.register(capability)).toThrow('already registered');
  });

  it('validates malformed capabilities with descriptor+handler split', () => {
    const registry = new ToolRegistry();

    expect(() =>
      registry.validate({
        name: 'invalid:tool',
        domain: 'kernel',
        version: '1.0.0',
        input_schema: z.object({}),
        permission: 'write',
        required_scopes: [],
        execute: async () => ({ success: true }),
      }),
    ).toThrow('ToolCapability');
  });

  it('exposes execution context and tool output schema primitives', () => {
    const executionContext = {
      run_id: 'run-1728',
      task_id: 'WU-1728',
      session_id: 'session-1728',
      allowed_scopes: [
        {
          type: 'path',
          pattern: 'packages/@lumenflow/kernel/src/**',
          access: 'read',
        },
      ],
    };
    const output = {
      success: true,
      data: {
        ok: true,
      },
    };

    expect(ExecutionContextSchema.safeParse(executionContext).success).toBe(true);
    expect(ToolOutputSchema.safeParse(output).success).toBe(true);
  });
});
