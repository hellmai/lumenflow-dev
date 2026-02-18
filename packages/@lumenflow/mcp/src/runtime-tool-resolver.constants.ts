/**
 * @file runtime-tool-resolver.constants.ts
 * @description Canonical literals for in-process runtime tool resolver handlers.
 *
 * WU-1801: Consolidates state/signal handler literals so command identifiers,
 * event kinds, and user-facing messages are defined in one place.
 */

export const STATE_RUNTIME_EVENT_TYPES = {
  CLAIM: 'claim',
  COMPLETE: 'complete',
  BLOCK: 'block',
  RELEASE: 'release',
} as const;

export const STATE_RUNTIME_CONSTANTS = {
  WU_FILE_PREFIX: 'WU-',
  YAML_EXTENSION: '.yaml',
  DONE_STAMP_EXTENSION: '.done',
  WU_EVENTS_FILE_NAME: 'wu-events.jsonl',
  STALE_NOTE_TEMPLATE: 'Auto-tagged as stale by backlog:prune',
  STATE_DOCTOR_FIX_REASON: 'state:doctor --fix',
  DEFAULT_STALE_DAYS_IN_PROGRESS: 7,
  DEFAULT_STALE_DAYS_READY: 30,
  DEFAULT_ARCHIVE_DAYS: 90,
  ONE_DAY_MS: 24 * 60 * 60 * 1000,
  BOOTSTRAP_BLOCK_REASON: 'Bootstrapped from WU YAML (original reason unknown)',
  UNKNOWN_LANE: 'Unknown',
  UNTITLED_WU: 'Untitled',
} as const;

export const STATE_RUNTIME_MESSAGES = {
  WU_DIRECTORY_EMPTY_OR_MISSING: 'WU directory not found or empty',
  MUTUALLY_EXCLUSIVE_CLEANUP_FLAGS:
    '--signals-only, --memory-only, and --events-only are mutually exclusive',
} as const;
