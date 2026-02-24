// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file hooks/index.ts
 * Claude Code enforcement hooks module (WU-1367)
 * WU-2127: Sub-module exports added for direct imports
 */

export * from './enforcement-generator.js';
export * from './enforcement-checks.js';
export * from './enforcement-sync.js';
// WU-2127: Sub-modules also available via direct import:
// - ./path-utils.js
// - ./config-resolver.js
// - ./git-status-parser.js
// - ./dirty-guard.js
