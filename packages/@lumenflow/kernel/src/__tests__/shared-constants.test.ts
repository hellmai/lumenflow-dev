// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KERNEL_RUNTIME_VERSION,
  DEFAULT_WORKSPACE_CONFIG_HASH,
  EXECUTION_METADATA_KEYS,
  KERNEL_POLICY_IDS,
  KERNEL_RUNTIME_EVENTS_DIR_NAME,
  KERNEL_RUNTIME_EVENTS_FILE_NAME,
  KERNEL_RUNTIME_EVENTS_LOCK_FILE_NAME,
  KERNEL_RUNTIME_EVIDENCE_DIR_NAME,
  KERNEL_RUNTIME_ROOT_DIR_NAME,
  KERNEL_RUNTIME_TASKS_DIR_NAME,
  LUMENFLOW_DIR_NAME,
  RESERVED_FRAMEWORK_SCOPE_GLOB,
  RESERVED_FRAMEWORK_SCOPE_PREFIX,
  SHA256_HEX_REGEX,
  SHA256_INTEGRITY_PREFIX,
  SHA256_INTEGRITY_REGEX,
  WORKSPACE_CONFIG_HASH_CONTEXT_KEYS,
} from '../shared-constants.js';

describe('shared constants governance', () => {
  it('defines canonical SHA-256 constants used across kernel runtime modules', () => {
    expect(SHA256_HEX_REGEX.test(DEFAULT_WORKSPACE_CONFIG_HASH)).toBe(true);
    expect(SHA256_INTEGRITY_REGEX.test(`${SHA256_INTEGRITY_PREFIX}${'a'.repeat(64)}`)).toBe(true);
    expect(SHA256_INTEGRITY_REGEX.test(`sha1:${'a'.repeat(40)}`)).toBe(false);
  });

  it('defines canonical kernel policy identifiers', () => {
    expect(KERNEL_POLICY_IDS.ALLOW_ALL).toBe('kernel.policy.allow-all');
    expect(KERNEL_POLICY_IDS.RUNTIME_FALLBACK).toBe('kernel.policy.runtime-fallback');
    expect(KERNEL_POLICY_IDS.RECONCILIATION).toBe('kernel.reconciliation');
  });

  it('defines canonical reserved framework scope boundaries and path segments', () => {
    expect(RESERVED_FRAMEWORK_SCOPE_PREFIX).toBe(`${LUMENFLOW_DIR_NAME}/`);
    expect(RESERVED_FRAMEWORK_SCOPE_GLOB).toBe(`${LUMENFLOW_DIR_NAME}/**`);
    expect(KERNEL_RUNTIME_ROOT_DIR_NAME).toBe('kernel');
    expect(KERNEL_RUNTIME_TASKS_DIR_NAME).toBe('tasks');
    expect(KERNEL_RUNTIME_EVENTS_DIR_NAME).toBe('events');
    expect(KERNEL_RUNTIME_EVIDENCE_DIR_NAME).toBe('evidence');
    expect(KERNEL_RUNTIME_EVENTS_FILE_NAME).toBe('events.jsonl');
    expect(KERNEL_RUNTIME_EVENTS_LOCK_FILE_NAME).toBe('events.lock');
  });

  it('defines canonical execution metadata keys and default sentinel identifiers', () => {
    expect(EXECUTION_METADATA_KEYS.WORKSPACE_CONFIG_HASH).toBe('workspace_config_hash');
    expect(EXECUTION_METADATA_KEYS.RUNTIME_VERSION).toBe('runtime_version');
    expect(WORKSPACE_CONFIG_HASH_CONTEXT_KEYS.WORKSPACE_FILE_MISSING).toBe(
      'workspace_file_missing',
    );
    expect(DEFAULT_KERNEL_RUNTIME_VERSION).toBe('kernel-dev');
  });
});
