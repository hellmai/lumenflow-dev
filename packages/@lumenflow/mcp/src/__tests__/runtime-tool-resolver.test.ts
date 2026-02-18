import path from 'node:path';
import {
  TOOL_HANDLER_KINDS,
  type ExecutionContext,
  type RuntimeToolCapabilityResolverInput,
} from '@lumenflow/kernel';
import { describe, expect, it } from 'vitest';
import {
  isInProcessPackToolRegistered,
  packToolCapabilityResolver,
} from '../runtime-tool-resolver.js';

const READ_SCOPE = {
  type: 'path' as const,
  pattern: '**',
  access: 'read' as const,
};

function createResolverInput(toolName: string): RuntimeToolCapabilityResolverInput {
  return {
    workspaceSpec: {
      id: 'workspace-runtime-resolver-tests',
      name: 'Runtime Resolver Tests',
      packs: [
        {
          id: 'software-delivery',
          version: '0.1.0',
          integrity: 'dev',
          source: 'local',
        },
      ],
      lanes: [
        {
          id: 'framework-core-lifecycle',
          title: 'Framework Core Lifecycle',
          allowed_scopes: [READ_SCOPE],
        },
      ],
      security: {
        allowed_scopes: [READ_SCOPE],
        network_default: 'off',
        deny_overlays: [],
      },
      memory_namespace: 'mem',
      event_namespace: 'evt',
    },
    loadedPack: {
      pin: {
        id: 'software-delivery',
        version: '0.1.0',
        integrity: 'dev',
        source: 'local',
      },
      manifest: {
        id: 'software-delivery',
        version: '0.1.0',
        task_types: ['work-unit'],
        tools: [],
        policies: [],
        evidence_types: [],
        state_aliases: {},
        lane_templates: [],
      },
      packRoot: path.resolve('/tmp/lumenflow-runtime-resolver-tests/software-delivery'),
      integrity: 'test-integrity',
    },
    tool: {
      name: toolName,
      entry: 'tool-impl/pending-runtime-tools.ts#pendingRuntimeMigrationTool',
      permission: 'read',
      required_scopes: [READ_SCOPE],
    },
  };
}

describe('packToolCapabilityResolver', () => {
  it('returns in-process capability for registered tools', async () => {
    const input = createResolverInput('wu:status');
    const capability = await packToolCapabilityResolver(input);

    expect(capability).toBeDefined();
    expect(isInProcessPackToolRegistered(input.tool.name)).toBe(true);
    expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.IN_PROCESS);
    expect(capability?.permission).toBe('read');
    expect(capability?.required_scopes).toEqual([READ_SCOPE]);

    const executionContext: ExecutionContext = {
      run_id: 'run-wu-status-1',
      task_id: 'WU-1797',
      session_id: 'session-runtime-resolver-tests',
      allowed_scopes: [READ_SCOPE],
    };

    const output = await capability?.handler.fn({}, executionContext);
    expect(output?.success).toBe(false);
    expect(output?.error?.code).toBe('RUNTIME_TOOL_NOT_MIGRATED');
  });

  it('falls back to default subprocess capability for unregistered tools', async () => {
    const input = createResolverInput('tool:unknown');
    const capability = await packToolCapabilityResolver(input);

    expect(isInProcessPackToolRegistered(input.tool.name)).toBe(false);
    expect(capability?.handler.kind).toBe(TOOL_HANDLER_KINDS.SUBPROCESS);
    if (capability?.handler.kind === TOOL_HANDLER_KINDS.SUBPROCESS) {
      expect(capability.handler.entry).toContain('tool-impl/pending-runtime-tools.ts');
    }
  });
});
