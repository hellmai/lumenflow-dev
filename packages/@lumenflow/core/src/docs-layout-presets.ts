// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Canonical docs layout presets used across scaffolding and defaults.
 *
 * Keeping presets in one place avoids path-literal drift between:
 * - schema defaults
 * - init docs-structure mapping
 * - runtime prompt/path helpers
 */

function buildDocsLayout(operations: string, tasks: string) {
  const frameworkRoot = `${operations}/_frameworks/lumenflow`;
  const onboarding = `${frameworkRoot}/agent/onboarding`;

  return {
    operations,
    tasks,
    onboarding,
    quickRefLink: `${onboarding}/quick-ref-commands.md`,
    completeGuidePath: `${frameworkRoot}/lumenflow-complete.md`,
    quickRefPath: `${onboarding}/quick-ref-commands.md`,
    startingPromptPath: `${onboarding}/starting-prompt.md`,
    governancePath: `${operations}/governance/project-governance.md`,
  } as const;
}

export const DOCS_LAYOUT_PRESETS = {
  simple: buildDocsLayout('docs', 'docs/tasks'),
  arc42: buildDocsLayout('docs/04-operations', 'docs/04-operations/tasks'),
} as const;

export type DocsLayoutType = keyof typeof DOCS_LAYOUT_PRESETS;
export type DocsLayoutPreset = (typeof DOCS_LAYOUT_PRESETS)[DocsLayoutType];

export const DEFAULT_DOCS_LAYOUT: DocsLayoutType = 'simple';

export function getDocsLayoutPreset(layout: DocsLayoutType): DocsLayoutPreset {
  return DOCS_LAYOUT_PRESETS[layout];
}

