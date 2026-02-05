#!/usr/bin/env node
/**
 * Centralized wu:create defaults (WU-1444)
 *
 * Single source of truth for placeholder text used when creating plan-first WUs.
 */

export const WU_CREATE_DEFAULTS = {
  AUTO_NOTES_PLACEHOLDER:
    '(auto) Add implementation notes, rollout context, or a short summary of the plan/conversation.',
  AUTO_MANUAL_TEST_PLACEHOLDER:
    '(auto) Manual check: verify acceptance criteria; add automated tests before changing code files.',
} as const;
