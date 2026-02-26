// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ports Index
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 * WU-1101: INIT-003 Phase 2a - Add core tools ports
 * WU-1103: INIT-003 Phase 2c - Add git adapter and validator ports
 *
 * Re-exports all port interfaces for the context-aware validation system
 * and core tools (tool-runner, worktree-guard, scope-checker).
 *
 * @module ports
 */

export * from './context.ports.js';
export * from './validation.ports.js';
export * from './recovery.ports.js';
export * from './metrics-collector.port.js';
export * from './dashboard-renderer.port.js';
export * from './core-tools.ports.js';
export * from './wu-helpers.ports.js';
export * from './sync-validator.ports.js';
export * from './git-validator.ports.js';
export * from './wu-state.ports.js';
export * from './config.ports.js';
