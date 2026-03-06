// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared manifest of onboarding docs scaffolded by `init --full`
 * and refreshed by `docs:sync`.
 */

export const SCAFFOLDED_ONBOARDING_TEMPLATE_PATHS: Record<string, string> = {
  'starting-prompt.md': 'core/ai/onboarding/starting-prompt.md.template',
  'first-15-mins.md': 'core/ai/onboarding/first-15-mins.md.template',
  'local-only.md': 'core/ai/onboarding/local-only.md.template',
  'quick-ref-commands.md': 'core/ai/onboarding/quick-ref-commands.md.template',
  'first-wu-mistakes.md': 'core/ai/onboarding/first-wu-mistakes.md.template',
  'troubleshooting-wu-done.md': 'core/ai/onboarding/troubleshooting-wu-done.md.template',
  'agent-safety-card.md': 'core/ai/onboarding/agent-safety-card.md.template',
  'wu-create-checklist.md': 'core/ai/onboarding/wu-create-checklist.md.template',
  'wu-sizing-guide.md': 'core/ai/onboarding/wu-sizing-guide.md.template',
};
