/**
 * Memory Commands (WU-2541)
 *
 * CLI command implementations for memory operations.
 *
 * @module @lumenflow/memory/commands
 */

// Placeholder for command implementations
// These will be added in subsequent WUs

export const MEMORY_COMMANDS = [
  'mem:init',
  'mem:start',
  'mem:checkpoint',
  'mem:ready',
  'mem:inbox',
  'mem:signal',
  'mem:create',
  'mem:triage',
  'mem:summarize',
  'mem:cleanup',
] as const;

export type MemoryCommand = (typeof MEMORY_COMMANDS)[number];
