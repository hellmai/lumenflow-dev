// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_ROOT_KEYS,
  WRITABLE_ROOT_KEYS,
  MANAGED_ROOT_KEYS,
  WORKSPACE_V2_KEYS,
  WORKSPACE_CONFIG_FILE_NAME,
  GIT_DIRECTORY_NAME,
  GIT_WORKTREES_SEGMENT,
  GIT_WORKTREES_SENTINEL,
} from '../config-contract.js';

describe('config-contract', () => {
  describe('pre-existing constants', () => {
    it('exports WORKSPACE_CONFIG_FILE_NAME', () => {
      expect(WORKSPACE_CONFIG_FILE_NAME).toBe('workspace.yaml');
    });

    it('exports GIT_DIRECTORY_NAME', () => {
      expect(GIT_DIRECTORY_NAME).toBe('.git');
    });

    it('exports GIT_WORKTREES_SEGMENT', () => {
      expect(GIT_WORKTREES_SEGMENT).toBe('.git/worktrees');
    });

    it('exports GIT_WORKTREES_SENTINEL', () => {
      expect(GIT_WORKTREES_SENTINEL).toBe('/.git/worktrees/');
    });

    it('exports WORKSPACE_V2_KEYS', () => {
      expect(WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY).toBe('software_delivery');
      expect(WORKSPACE_V2_KEYS.CONTROL_PLANE).toBe('control_plane');
    });
  });

  describe('WORKSPACE_ROOT_KEYS', () => {
    it('is a readonly array', () => {
      expect(Array.isArray(WORKSPACE_ROOT_KEYS)).toBe(true);
    });

    it('lists all kernel-owned root keys matching WorkspaceSpecSchema', () => {
      const expected = [
        'id',
        'name',
        'packs',
        'lanes',
        'policies',
        'security',
        'software_delivery',
        'control_plane',
        'memory_namespace',
        'event_namespace',
      ];
      expect([...WORKSPACE_ROOT_KEYS].sort()).toEqual([...expected].sort());
    });

    it('contains exactly 10 root keys', () => {
      expect(WORKSPACE_ROOT_KEYS).toHaveLength(10);
    });
  });

  describe('WRITABLE_ROOT_KEYS', () => {
    it('is a Set', () => {
      expect(WRITABLE_ROOT_KEYS).toBeInstanceOf(Set);
    });

    it('includes control_plane', () => {
      expect(WRITABLE_ROOT_KEYS.has('control_plane')).toBe(true);
    });

    it('includes memory_namespace', () => {
      expect(WRITABLE_ROOT_KEYS.has('memory_namespace')).toBe(true);
    });

    it('includes event_namespace', () => {
      expect(WRITABLE_ROOT_KEYS.has('event_namespace')).toBe(true);
    });

    it('does NOT include managed keys', () => {
      expect(WRITABLE_ROOT_KEYS.has('packs')).toBe(false);
      expect(WRITABLE_ROOT_KEYS.has('lanes')).toBe(false);
      expect(WRITABLE_ROOT_KEYS.has('security')).toBe(false);
      expect(WRITABLE_ROOT_KEYS.has('id')).toBe(false);
      expect(WRITABLE_ROOT_KEYS.has('name')).toBe(false);
      expect(WRITABLE_ROOT_KEYS.has('policies')).toBe(false);
    });

    it('does NOT include software_delivery (pack config_key resolved at runtime)', () => {
      expect(WRITABLE_ROOT_KEYS.has('software_delivery')).toBe(false);
    });

    it('contains exactly 3 entries', () => {
      expect(WRITABLE_ROOT_KEYS.size).toBe(3);
    });
  });

  describe('MANAGED_ROOT_KEYS', () => {
    it('is a record mapping keys to dedicated commands', () => {
      expect(typeof MANAGED_ROOT_KEYS).toBe('object');
      expect(MANAGED_ROOT_KEYS).not.toBeNull();
    });

    it('maps packs to pack:install', () => {
      expect(MANAGED_ROOT_KEYS.packs).toBe('pack:install');
    });

    it('maps lanes to lane:edit', () => {
      expect(MANAGED_ROOT_KEYS.lanes).toBe('lane:edit');
    });

    it('maps security to a dedicated command', () => {
      expect(MANAGED_ROOT_KEYS.security).toBe('security:set');
    });

    it('maps id to workspace-init', () => {
      expect(MANAGED_ROOT_KEYS.id).toBe('workspace-init');
    });

    it('maps name to workspace-init', () => {
      expect(MANAGED_ROOT_KEYS.name).toBe('workspace-init');
    });

    it('maps policies to policy:set', () => {
      expect(MANAGED_ROOT_KEYS.policies).toBe('policy:set');
    });

    it('contains exactly 6 entries', () => {
      expect(Object.keys(MANAGED_ROOT_KEYS)).toHaveLength(6);
    });

    it('all managed keys are present in WORKSPACE_ROOT_KEYS', () => {
      for (const key of Object.keys(MANAGED_ROOT_KEYS)) {
        expect(WORKSPACE_ROOT_KEYS).toContain(key);
      }
    });
  });

  describe('key set consistency', () => {
    it('every WRITABLE key is in WORKSPACE_ROOT_KEYS', () => {
      for (const key of WRITABLE_ROOT_KEYS) {
        expect(WORKSPACE_ROOT_KEYS).toContain(key);
      }
    });

    it('every MANAGED key is in WORKSPACE_ROOT_KEYS', () => {
      for (const key of Object.keys(MANAGED_ROOT_KEYS)) {
        expect(WORKSPACE_ROOT_KEYS).toContain(key);
      }
    });

    it('WRITABLE and MANAGED keys do not overlap', () => {
      for (const key of WRITABLE_ROOT_KEYS) {
        expect(Object.keys(MANAGED_ROOT_KEYS)).not.toContain(key);
      }
    });

    it('WRITABLE + MANAGED + software_delivery covers all WORKSPACE_ROOT_KEYS', () => {
      const writableKeys = [...WRITABLE_ROOT_KEYS];
      const managedKeys = Object.keys(MANAGED_ROOT_KEYS);
      const packKeys = ['software_delivery'];
      const allCategorized = new Set([...writableKeys, ...managedKeys, ...packKeys]);
      for (const key of WORKSPACE_ROOT_KEYS) {
        expect(allCategorized.has(key)).toBe(true);
      }
    });
  });
});
