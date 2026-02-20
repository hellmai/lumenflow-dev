// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Context Module
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Exports:
 * - Location resolution (main vs worktree detection)
 * - Git state reading (branch, dirty, staged, ahead/behind)
 * - WU state reading (YAML + state store)
 * - Context computation (unified context model)
 *
 * @module
 */

export * from './location-resolver.js';
export * from './git-state-reader.js';
export * from './wu-state-reader.js';
export * from './context-computer.js';
