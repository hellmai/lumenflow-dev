/**
 * @lumenflow/core - Core WU lifecycle tools (WU-2539)
 *
 * The foundational package for LumenFlow workflow management.
 * Provides guards, spawn registry, and state bootstrap.
 *
 * @packageDocumentation
 */

export const VERSION = '0.0.0';

// Re-export all modules
export * from './gates/index.js';
export * from './git/index.js';
export * from './guards/index.js';
export * from './spawn/index.js';
export * from './state/index.js';
