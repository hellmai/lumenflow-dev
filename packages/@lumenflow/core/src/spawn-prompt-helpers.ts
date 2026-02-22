// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file spawn-prompt-helpers.ts
 * WU-2012: Extracted from spawn-task-builder.ts
 *
 * Private helper functions used during spawn prompt assembly:
 * - WU field formatting (acceptance, spec_refs, risks, manual tests)
 * - Implementation context generation
 * - Invariant matching and formatting
 * - Mandatory agent detection
 * - Preamble and client blocks generation
 *
 * Single responsibility: Format WU data and match invariants for
 * inclusion in spawn prompts.
 *
 * @module spawn-prompt-helpers
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import type { ClientConfig } from './lumenflow-config-schema.js';
import type { SpawnStrategy } from './spawn-strategy.js';
import type { WUDoc } from './spawn-agent-guidance.js';
import { minimatch } from 'minimatch';
import { loadInvariants, INVARIANT_TYPES } from './invariants-runner.js';

// ============================================================================
// Private Types and Constants
// ============================================================================

interface InvariantDefinition {
  id: string;
  type: string;
  description: string;
  message?: string;
  path?: string;
  paths?: string[];
  scope?: string[];
  from?: string;
  cannot_import?: string[];
  pattern?: string;
}

/**
 * Client context for spawn generation
 */
export interface ClientContext {
  name: string;
  config?: ClientConfig;
}

/**
 * Mandatory agent trigger patterns.
 * Mirrors MANDATORY_TRIGGERS from orchestration.constants.ts.
 *
 * Note: For LumenFlow framework development, this is empty since we don't have
 * application-specific concerns. Projects using LumenFlow
 * should configure their own triggers based on their domain requirements.
 */
const MANDATORY_TRIGGERS: Record<string, readonly string[]> = {
  // No mandatory triggers for LumenFlow framework development.
};

// ============================================================================
// Formatting Functions
// ============================================================================

/**
 * Format acceptance criteria as markdown list
 */
export function formatAcceptance(acceptance: string[] | undefined): string {
  if (!acceptance || acceptance.length === 0) {
    return '- No acceptance criteria defined';
  }
  return acceptance.map((item) => `- [ ] ${item}`).join('\n');
}

/**
 * Format spec_refs as markdown links
 *
 * WU-1062: Handles external paths (lumenflow://, ~/.lumenflow/, $LUMENFLOW_HOME/)
 * by expanding them to absolute paths and adding a note about reading them.
 */
function formatSpecRefs(specRefs: string[] | undefined): string {
  if (!specRefs || specRefs.length === 0) {
    return '';
  }

  const formattedRefs = specRefs.map((ref) => {
    if (
      ref.startsWith('lumenflow://') ||
      ref.startsWith('~/') ||
      ref.startsWith('$LUMENFLOW_HOME') ||
      (ref.startsWith('/') && ref.includes('.lumenflow'))
    ) {
      return `- ${ref} (external - read with filesystem access)`;
    }
    return `- ${ref}`;
  });

  return formattedRefs.join('\n');
}

/**
 * Format risks as markdown list
 */
function formatRisks(risks: string[] | undefined): string {
  if (!risks || risks.length === 0) {
    return '';
  }
  return risks.map((risk) => `- ${risk}`).join('\n');
}

/**
 * Format manual tests as markdown checklist
 */
function formatManualTests(manualTests: string[] | undefined): string {
  if (!manualTests || manualTests.length === 0) {
    return '';
  }
  return manualTests.map((test) => `- [ ] ${test}`).join('\n');
}

// ============================================================================
// Context and Section Generators
// ============================================================================

/**
 * Generate implementation context section (WU-1833)
 *
 * Includes spec_refs, notes, risks, and tests.manual if present.
 * Sections with no content are omitted to keep prompts lean.
 */
export function generateImplementationContext(doc: WUDoc): string {
  const sections: string[] = [];

  const refs = formatSpecRefs(doc.spec_refs);
  if (refs) {
    sections.push(`## References\n\n${refs}`);
  }

  if (doc.notes && doc.notes.trim()) {
    sections.push(`## Implementation Notes\n\n${doc.notes.trim()}`);
  }

  const risks = formatRisks(doc.risks);
  if (risks) {
    sections.push(`## Risks\n\n${risks}`);
  }

  const manualTests = formatManualTests(doc.tests?.manual);
  if (manualTests) {
    sections.push(`## Manual Verification\n\n${manualTests}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return sections.join('\n\n---\n\n');
}

/**
 * Detect mandatory agents based on code paths.
 */
export function detectMandatoryAgents(codePaths: string[] | undefined): string[] {
  if (!codePaths || codePaths.length === 0) {
    return [];
  }

  const triggeredAgents = new Set<string>();

  for (const [agentName, patterns] of Object.entries(MANDATORY_TRIGGERS)) {
    const isTriggered = codePaths.some((filePath) =>
      patterns.some((pattern) => minimatch(filePath, pattern)),
    );

    if (isTriggered) {
      triggeredAgents.add(agentName);
    }
  }

  return Array.from(triggeredAgents);
}

/**
 * Generate the mandatory agents section
 */
export function generateMandatoryAgentSection(mandatoryAgents: string[], _id: string): string {
  if (mandatoryAgents.length === 0) {
    return '';
  }

  const agentList = mandatoryAgents.map((agent) => `  - ${agent}`).join('\n');
  return `
## Mandatory Agents (MUST invoke before wu:done)

Based on code_paths, the following agents MUST be invoked:

${agentList}

Run: pnpm orchestrate:monitor to check agent status
`;
}

/**
 * Generate the context loading preamble using the strategy
 */
export function generatePreamble(id: string, strategy: SpawnStrategy): string {
  return strategy.getPreamble(id);
}

/**
 * Generate client blocks section from config
 */
export function generateClientBlocksSection(clientContext: ClientContext | undefined): string {
  if (!clientContext?.config?.blocks?.length) return '';
  const blocks = clientContext.config.blocks
    .map((block) => `### ${block.title}\n\n${block.content}`)
    .join('\n\n');
  return `## Client Guidance (${clientContext.name})\n\n${blocks}`;
}

// ============================================================================
// Invariant Matching and Formatting
// ============================================================================

/**
 * Check if a code path matches an invariant based on type
 */
function codePathMatchesInvariant(invariant: InvariantDefinition, codePaths: string[]): boolean {
  switch (invariant.type) {
    case INVARIANT_TYPES.FORBIDDEN_FILE:
    case INVARIANT_TYPES.REQUIRED_FILE: {
      const invariantPath = invariant.path;
      if (!invariantPath) return false;
      return codePaths.some(
        (p) => p === invariantPath || minimatch(p, invariantPath) || minimatch(invariantPath, p),
      );
    }

    case INVARIANT_TYPES.MUTUAL_EXCLUSIVITY: {
      const invariantPaths = invariant.paths ?? [];
      return codePaths.some((p) =>
        invariantPaths.some((invPath) => p === invPath || minimatch(p, invPath)),
      );
    }

    case INVARIANT_TYPES.FORBIDDEN_PATTERN:
    case INVARIANT_TYPES.REQUIRED_PATTERN:
      return (
        invariant.scope?.some((scopePattern) =>
          codePaths.some((p) => minimatch(p, scopePattern)),
        ) ?? false
      );

    case INVARIANT_TYPES.FORBIDDEN_IMPORT: {
      const fromPattern = invariant.from;
      if (!fromPattern) return false;
      return codePaths.some((p) => minimatch(p, fromPattern));
    }

    default:
      return false;
  }
}

/**
 * Format a single invariant for output
 */
function formatInvariantForOutput(inv: InvariantDefinition): string[] {
  const lines = [`### ${inv.id} (${inv.type})`, '', inv.description, ''];

  if (inv.message) {
    lines.push(`**Action:** ${inv.message}`, '');
  }

  if (inv.path) {
    lines.push(`**Path:** \`${inv.path}\``);
  }

  if (inv.paths) {
    const formattedPaths = inv.paths.map((p) => `\`${p}\``).join(', ');
    lines.push(`**Paths:** ${formattedPaths}`);
  }

  if (inv.from) {
    lines.push(`**From:** \`${inv.from}\``);
  }

  if (inv.cannot_import && Array.isArray(inv.cannot_import)) {
    const formattedImports = inv.cannot_import.map((m) => `\`${m}\``).join(', ');
    lines.push(`**Cannot Import:** ${formattedImports}`);
  }

  if (
    inv.pattern &&
    (inv.type === INVARIANT_TYPES.REQUIRED_PATTERN ||
      inv.type === INVARIANT_TYPES.FORBIDDEN_PATTERN)
  ) {
    lines.push(`**Pattern:** \`${inv.pattern}\``);
  }

  if (inv.scope && Array.isArray(inv.scope)) {
    const formattedScope = inv.scope.map((s) => `\`${s}\``).join(', ');
    lines.push(`**Scope:** ${formattedScope}`);
  }

  lines.push('');
  return lines;
}

/**
 * WU-2252: Generate invariants/prior-art section for code_paths
 *
 * Loads relevant invariants from invariants.yml and generates a section
 * that surfaces constraints and prior-art for the WU's code_paths.
 */
export function generateInvariantsPriorArtSection(codePaths: string[]): string {
  if (!codePaths || codePaths.length === 0) {
    return '';
  }

  const invariantsPath = path.resolve('tools/invariants.yml');
  if (!existsSync(invariantsPath)) {
    return '';
  }

  let invariants: InvariantDefinition[];
  try {
    invariants = loadInvariants(invariantsPath);
  } catch {
    return '';
  }

  if (!invariants || invariants.length === 0) {
    return '';
  }

  const relevantInvariants = invariants.filter((inv) => codePathMatchesInvariant(inv, codePaths));

  if (relevantInvariants.length === 0) {
    return '';
  }

  const lines = [
    '## Invariants/Prior-Art (WU-2252)',
    '',
    'The following repo invariants are relevant to your code_paths:',
    '',
    ...relevantInvariants.flatMap(formatInvariantForOutput),
    '**IMPORTANT:** Do not create specs or acceptance criteria that conflict with these invariants.',
  ];

  return lines.join('\n');
}
