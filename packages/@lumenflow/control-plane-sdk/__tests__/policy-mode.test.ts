import { describe, expect, it } from 'vitest';
import {
  ControlPlaneConfigSchema,
  applyPolicyMode,
  parseWorkspaceControlPlaneConfig,
} from '../src/index.js';

describe('control-plane sdk policy modes', () => {
  it('accepts workspace config with control_plane section', () => {
    const parsed = parseWorkspaceControlPlaneConfig({
      id: 'workspace-1',
      control_plane: {
        enabled: true,
        endpoint: 'https://cp.local',
        org_id: 'org-1',
        sync_interval: 30,
        policy_mode: 'tighten-only',
      },
    });

    expect(parsed.control_plane.enabled).toBe(true);
    expect(parsed.control_plane.endpoint).toBe('https://cp.local');
    expect(parsed.control_plane.org_id).toBe('org-1');
    expect(parsed.control_plane.sync_interval).toBe(30);
    expect(parsed.control_plane.policy_mode).toBe('tighten-only');
    expect(parsed.control_plane.local_override).toBe(false);

    expect(
      ControlPlaneConfigSchema.parse({
        enabled: true,
        endpoint: 'https://cp.local',
        org_id: 'org-1',
        sync_interval: 30,
        policy_mode: 'authoritative',
      }),
    ).toBeDefined();
  });

  it('tighten-only mode rejects local policy loosening', () => {
    expect(() =>
      applyPolicyMode({
        mode: 'tighten-only',
        workspace_id: 'workspace-1',
        remote: {
          default_decision: 'deny',
          rules: [{ id: 'tool.exec', decision: 'deny' }],
        },
        local: {
          default_decision: 'deny',
          rules: [{ id: 'tool.exec', decision: 'allow' }],
        },
      }),
    ).toThrow(/tighten-only/i);
  });

  it('dev-override mode allows loosening and emits workspace warning event', () => {
    const merged = applyPolicyMode({
      mode: 'dev-override',
      workspace_id: 'workspace-1',
      remote: {
        default_decision: 'deny',
        rules: [{ id: 'tool.exec', decision: 'deny' }],
      },
      local: {
        default_decision: 'deny',
        rules: [{ id: 'tool.exec', decision: 'allow' }],
      },
    });

    expect(merged.effective.rules).toEqual([{ id: 'tool.exec', decision: 'allow' }]);
    expect(merged.events).toHaveLength(1);
    expect(merged.events[0]?.kind).toBe('workspace_warning');
  });

  it('authoritative mode keeps the remote baseline unchanged', () => {
    const merged = applyPolicyMode({
      mode: 'authoritative',
      workspace_id: 'workspace-1',
      remote: {
        default_decision: 'allow',
        rules: [{ id: 'tool.exec', decision: 'allow' }],
      },
      local: {
        default_decision: 'deny',
        rules: [{ id: 'tool.exec', decision: 'deny' }],
      },
    });

    expect(merged.effective.default_decision).toBe('allow');
    expect(merged.effective.rules).toEqual([{ id: 'tool.exec', decision: 'allow' }]);
    expect(merged.events).toHaveLength(0);
  });
});
