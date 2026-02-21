// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  ControlPlaneConfigSchema,
  WorkspaceControlPlaneSchema,
  parseWorkspaceControlPlaneConfig,
} from '../src/workspace-config.js';

describe('workspace control-plane config parsing', () => {
  it('parses valid config and defaults local_override to false', () => {
    const parsed = parseWorkspaceControlPlaneConfig({
      control_plane: {
        enabled: true,
        endpoint: 'https://control-plane.example',
        org_id: 'org-1',
        sync_interval: 60,
        policy_mode: 'tighten-only',
      },
    });

    expect(parsed.id).toBeUndefined();
    expect(parsed.control_plane).toEqual({
      enabled: true,
      endpoint: 'https://control-plane.example',
      org_id: 'org-1',
      sync_interval: 60,
      policy_mode: 'tighten-only',
      local_override: false,
    });
  });

  it('parses optional id and explicit local_override', () => {
    const parsed = WorkspaceControlPlaneSchema.parse({
      id: 'workspace-1',
      control_plane: {
        enabled: true,
        endpoint: 'https://control-plane.example',
        org_id: 'org-1',
        sync_interval: 30,
        policy_mode: 'authoritative',
        local_override: true,
      },
    });

    expect(parsed.id).toBe('workspace-1');
    expect(parsed.control_plane.local_override).toBe(true);
  });

  it('rejects malformed top-level input and missing required fields', () => {
    expect(() => parseWorkspaceControlPlaneConfig(null)).toThrow(
      'Invalid workspace config: expected an object',
    );
    expect(() =>
      parseWorkspaceControlPlaneConfig({
        control_plane: {
          endpoint: 'https://control-plane.example',
          org_id: 'org-1',
          sync_interval: 30,
          policy_mode: 'authoritative',
        },
      }),
    ).toThrow('Invalid control_plane.enabled: expected boolean');
    expect(() => parseWorkspaceControlPlaneConfig({})).toThrow(
      'Invalid control_plane config: expected an object',
    );
  });

  it('rejects invalid control-plane values', () => {
    expect(() =>
      ControlPlaneConfigSchema.parse({
        enabled: true,
        endpoint: '',
        org_id: 'org-1',
        sync_interval: 30,
        policy_mode: 'authoritative',
      }),
    ).toThrow('Invalid control_plane.endpoint: expected a non-empty string');

    expect(() =>
      ControlPlaneConfigSchema.parse({
        enabled: true,
        endpoint: 'not-a-url',
        org_id: 'org-1',
        sync_interval: 30,
        policy_mode: 'authoritative',
      }),
    ).toThrow('Invalid control_plane.endpoint: expected a valid URL');

    expect(() =>
      ControlPlaneConfigSchema.parse({
        enabled: true,
        endpoint: 'https://control-plane.example',
        org_id: 'org-1',
        sync_interval: 0,
        policy_mode: 'authoritative',
      }),
    ).toThrow('Invalid control_plane.sync_interval: expected a positive integer');

    expect(() =>
      ControlPlaneConfigSchema.parse({
        enabled: true,
        endpoint: 'https://control-plane.example',
        org_id: 'org-1',
        sync_interval: 30,
        policy_mode: 'legacy',
      }),
    ).toThrow('Invalid control_plane.policy_mode');
  });

  it('rejects invalid id and local_override field types', () => {
    expect(() =>
      WorkspaceControlPlaneSchema.parse({
        id: '   ',
        control_plane: {
          enabled: true,
          endpoint: 'https://control-plane.example',
          org_id: 'org-1',
          sync_interval: 30,
          policy_mode: 'authoritative',
        },
      }),
    ).toThrow('Invalid id: expected a non-empty string when provided');

    expect(() =>
      ControlPlaneConfigSchema.parse({
        enabled: true,
        endpoint: 'https://control-plane.example',
        org_id: 'org-1',
        sync_interval: 30,
        policy_mode: 'authoritative',
        local_override: 'yes',
      }),
    ).toThrow('Invalid control_plane.local_override: expected boolean');
  });
});
