// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file spawn-lane-occupation.ts
 * WU-2012: Extracted from wu-spawn.ts
 *
 * Lane occupation checking and warning generation for spawn prompts.
 * Re-exports from spawn-task-builder where the canonical implementations live.
 *
 * @module spawn-lane-occupation
 */

// Re-export lane occupation functions from spawn-task-builder
export { checkLaneOccupation, generateLaneOccupationWarning } from './spawn-task-builder.js';
