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
