// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file spawn-guidance-generators.ts
 * WU-2012: Extracted from wu-spawn.ts
 *
 * Generates methodology-aware guidance sections for spawn prompts:
 * - Test guidance (TDD, test-after, smoke-test, refactor, docs-only)
 * - Architecture guidance (hexagonal, layered, none)
 * - Design context for UI-classified work
 * - Enforcement summary from resolved policy
 * - Mandatory standards section
 * - Worktree block recovery guidance
 *
 * Single responsibility: Generate type-aware and policy-aware guidance sections
 * for test methodology, architecture patterns, and UI design context.
 *
 * @module spawn-guidance-generators
 */

import { DIRECTORIES } from './wu-constants.js';
import { createWuPaths } from './wu-paths.js';
import type { ResolvedPolicy } from './resolve-policy.js';

const DEFAULT_WORKTREES_DIR_SEGMENT = DIRECTORIES.WORKTREES.replace(/\/+$/g, '');

function normalizeDirectorySegment(value: string, fallback: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized.length > 0 ? normalized : fallback;
}

function resolveWorktreePathFallback(): string {
  try {
    const configuredWorktreesDir = createWuPaths({ projectRoot: process.cwd() }).WORKTREES_DIR();
    const normalizedDir = normalizeDirectorySegment(
      configuredWorktreesDir,
      DEFAULT_WORKTREES_DIR_SEGMENT,
    );
    return `${normalizedDir}/<lane>-wu-xxx`;
  } catch {
    return `${DEFAULT_WORKTREES_DIR_SEGMENT}/<lane>-wu-xxx`;
  }
}

/** WU types by test methodology */
const _TDD_REQUIRED_TYPES = ['feature', 'bug', 'tooling', 'enhancement'];
const EXISTING_TESTS_TYPES = ['refactor'];
const SMOKE_TEST_TYPES = ['visual', 'design', 'ui'];
const DOCS_ONLY_TYPES = ['documentation', 'docs', 'config'];

/** Generate type-aware test guidance (WU-1142, WU-1192) */
export function generateTestGuidance(wuType: string): string {
  const type = (wuType || 'feature').toLowerCase();

  // Documentation WUs - no TDD, just format checks
  if (DOCS_ONLY_TYPES.includes(type)) {
    return generateDocsGuidance();
  }

  // Visual/Design WUs - smoke tests + manual QA
  if (SMOKE_TEST_TYPES.includes(type)) {
    return generateSmokeTestGuidance();
  }

  // Refactor WUs - existing tests must pass
  if (EXISTING_TESTS_TYPES.includes(type)) {
    return generateRefactorGuidance();
  }

  // Default: TDD required (feature, bug, tooling, enhancement)
  return generateTDDDirective();
}

/** Generate the TDD directive section (WU-1585, WU-1192) */
function generateTDDDirective() {
  return `## \u26d4 TDD DIRECTIVE \u2014 READ BEFORE CODING

**IF YOU WRITE IMPLEMENTATION CODE BEFORE A FAILING TEST, YOU HAVE FAILED THIS WU.**

### Test-First Workflow (MANDATORY)

1. Write a failing test for the acceptance criteria
2. Run the test to confirm it fails (RED)
3. Implement the minimum code to pass the test
4. Run the test to confirm it passes (GREEN)
5. Refactor if needed, keeping tests green

### Test Ratchet Rule (WU-1253)

Gates compare test results against \`.lumenflow/test-baseline.json\`:

- **NEW failures** (not in baseline) **BLOCK** gates - you must fix them
- **Pre-existing failures** (in baseline) show **WARNING** - do not block your WU
- When tests are **fixed**, baseline auto-updates (ratchet forward)

If gates fail due to test failures:
1. Check if failure is in baseline: \`cat .lumenflow/test-baseline.json\`
2. If pre-existing: continue, it will warn but not block
3. If NEW: fix the test or add to baseline with reason and fix-wu

### Why This Matters

- Tests document expected behavior BEFORE implementation
- Prevents scope creep and over-engineering
- Ensures every feature has verification
- Failing tests prove the test actually tests something
- Ratchet pattern prevents being blocked by unrelated failures`;
}

/** Generate documentation-only guidance */
function generateDocsGuidance(): string {
  return `## Documentation Standards

**Format check only** - No TDD required for documentation WUs.

### Requirements

1. Run \`pnpm gates --docs-only\` before completion
2. Ensure markdown formatting is correct
3. Verify links are valid
4. Check spelling and grammar`;
}

/**
 * WU-1900: Generate smoke-test guidance (extracted from inline)
 */
function generateSmokeTestGuidance(): string {
  return `## Visual/Design Testing

**Smoke test + manual QA** - Visual WUs require different verification.

### Requirements

1. Create smoke test for component rendering (if applicable)
2. Verify visual appearance manually
3. Test responsive behavior across breakpoints
4. Check accessibility (keyboard navigation, screen reader)
5. Document manual QA results in completion notes`;
}

/** Generate refactor testing guidance */
function generateRefactorGuidance(): string {
  return `## Refactor Testing

**Existing tests must pass** - Refactoring must not break current behavior.

### Requirements

1. Run all existing tests BEFORE refactoring
2. Run all existing tests AFTER refactoring
3. No new tests required unless behavior changes
4. If tests fail after refactor, the refactor introduced a bug`;
}

/**
 * WU-1900: Options for classifier-aware test guidance
 */
export interface TestGuidanceOptions {
  /** Test methodology hint from work classifier (e.g., 'smoke-test' for UI work) */
  testMethodologyHint?: string;
}

/** WU-1279: Generate the Mandatory Standards section based on resolved policy */
export function generateMandatoryStandards(policy: ResolvedPolicy): string {
  const lines: string[] = ['## Mandatory Standards', ''];

  // LumenFlow workflow is always required
  lines.push('- **LumenFlow**: Follow trunk-based flow, WIP=1, worktree discipline');

  // Testing methodology based on policy
  if (policy.testing === 'tdd') {
    lines.push(
      `- **TDD**: Failing test first, then implementation, then passing test. ${policy.coverage_threshold}%+ coverage on new application code`,
    );
  } else if (policy.testing === 'test-after') {
    lines.push(
      `- **Test-After**: Write implementation first, then add tests. ${policy.coverage_threshold}%+ coverage on new application code`,
    );
  } else if (policy.testing === 'none') {
    lines.push('- **Testing**: Tests are optional for this project');
  }

  // Architecture based on policy
  if (policy.architecture === 'hexagonal') {
    lines.push(
      '- **Hexagonal Architecture**: Ports-first design. No application -> infrastructure imports',
    );
  } else if (policy.architecture === 'layered') {
    lines.push(
      '- **Layered Architecture**: Clear layer separation. Each layer can only depend on layers below it',
    );
  }
  // For architecture: 'none', we don't add any architecture guidance

  // Always include these standards
  lines.push('- **SOLID/DRY/YAGNI/KISS**: No over-engineering, no premature abstraction');
  lines.push(
    '- **Library-First**: Search context7 before writing custom code. No reinventing wheels',
  );
  lines.push(
    '- **Code Quality**: No string literals, no magic numbers, no brittle regexes when libraries exist',
  );
  lines.push(
    '- **Worktree Discipline**: ALWAYS use `pnpm wu:claim` to create worktrees (never `git worktree add` directly). Work ONLY in the worktree, never edit main',
  );
  lines.push(
    '- **Documentation**: Update tooling docs if changing tools. Keep docs in sync with code',
  );
  lines.push(
    '- **Sub-agents**: Use Explore agent for codebase investigation. Activate mandatory agents as configured for your project',
  );

  return lines.join('\n');
}

/**
 * WU-1261, WU-1900: Generate test guidance based on resolved policy and classifier hint.
 * Type overrides take precedence (docs, visual, refactor). WU-1900: classifier-driven
 * smoke-test for bug WUs with UI code_paths.
 */
export function generatePolicyBasedTestGuidance(
  wuType: string,
  policy: ResolvedPolicy,
  options?: TestGuidanceOptions,
): string {
  const type = (wuType || 'feature').toLowerCase();

  // Type overrides take precedence (documentation never needs TDD)
  if (DOCS_ONLY_TYPES.includes(type)) {
    return generateDocsGuidance();
  }

  // Visual/Design WUs - smoke tests + manual QA
  if (SMOKE_TEST_TYPES.includes(type)) {
    return generateSmokeTestGuidance();
  }

  // WU-1900: Classifier-driven smoke-test for bug WUs with UI code_paths
  // This makes SMOKE_TEST_TYPES reachable through classifier signals
  if (type === 'bug' && options?.testMethodologyHint === 'smoke-test') {
    return generateSmokeTestGuidance();
  }

  // Refactor WUs - existing tests must pass
  if (EXISTING_TESTS_TYPES.includes(type)) {
    return generateRefactorGuidance();
  }

  // Policy-based selection for feature/bug/enhancement/tooling types
  switch (policy.testing) {
    case 'test-after':
      return generateTestAfterDirective(policy.coverage_threshold);
    case 'none':
      return generateTestingOptionalDirective();
    case 'tdd':
    default:
      return generateTDDDirective();
  }
}

/** WU-1261: Generate test-after directive */
function generateTestAfterDirective(coverageThreshold: number): string {
  return `## Test-After Methodology

**Write implementation first, then add tests** - Focus on solving the problem, then verify.

### Test-After Workflow

1. Understand the acceptance criteria
2. Write implementation first
3. Add tests to verify behavior
4. Aim for ${coverageThreshold}% coverage on new code

### When This Works

- Exploratory prototyping where requirements are unclear
- Quick iterations where test-first slows discovery
- Projects configured with \`methodology.testing: 'test-after'\`

### Requirements

- Tests must be added before \`wu:done\`
- Coverage target: ${coverageThreshold}%+ on new application code
- All existing tests must still pass`;
}

/** WU-1261: Generate testing optional directive */
function generateTestingOptionalDirective(): string {
  return `## Testing Optional

**Tests are not required** - Project is configured without test requirements.

### Focus

- Code quality and functionality
- Run \`pnpm gates\` before completion (will skip coverage checks)

### If You Want to Add Tests

You can still add tests for critical functionality:
\`\`\`bash
pnpm test -- --coverage
\`\`\`

But they are not required for WU completion.`;
}

/** WU-1261: Generate architecture guidance based on resolved policy */
export function generatePolicyBasedArchitectureGuidance(policy: ResolvedPolicy): string {
  switch (policy.architecture) {
    case 'hexagonal':
      return `## Hexagonal Architecture

**Ports and Adapters** - Keep domain logic pure, infrastructure at the edges.

### Key Principles

- **Ports**: Interfaces defining what the domain needs (inbound) or uses (outbound)
- **Adapters**: Implementations connecting ports to infrastructure
- **Domain**: Pure business logic with no infrastructure imports
- **Dependency Rule**: Domain -> Ports <- Adapters (never domain -> adapters)

### Directory Structure

\`\`\`
src/
  domain/           # Pure business logic
  ports/            # Interfaces
  adapters/         # Infrastructure implementations
  application/      # Use cases orchestrating domain + ports
\`\`\``;

    case 'layered':
      return `## Layered Architecture

**Traditional layer separation** - Clear boundaries between concerns.

### Layers (Top to Bottom)

1. **Presentation**: UI, API controllers, CLI
2. **Application**: Use cases, orchestration
3. **Domain**: Business logic, entities
4. **Infrastructure**: Database, external services

### Dependency Rule

- Each layer can only depend on layers below it
- Presentation -> Application -> Domain -> Infrastructure
- Never skip layers (Presentation should not directly use Infrastructure)`;

    case 'none':
    default:
      return '';
  }
}

/** WU-1900: Generate design context section for UI-classified work */
export function generateDesignContextSection(classification: {
  domain: string;
  capabilities: string[];
}): string {
  if (classification.domain !== 'ui') {
    return '';
  }

  return `## Design Context

This work involves UI components or styling. Follow these guidelines:

### Pattern Check

- Before creating new components, check for existing patterns in the codebase
- Search for similar components that may already solve the problem
- Verify design system tokens and variables are used instead of hardcoded values

### Viewport Verification

- Test across common viewport sizes (mobile: 375px, tablet: 768px, desktop: 1280px)
- Verify responsive behavior at breakpoints
- Check for overflow, text truncation, and layout shifts

### Accessibility

- Verify keyboard navigation works for interactive elements
- Ensure sufficient color contrast (WCAG 2.1 AA minimum)
- Add appropriate ARIA attributes where needed
- Test with screen reader if applicable

### Codebase Exploration

- Check the project's design system or component library before building custom
- Look for CSS variables, theme tokens, or shared style utilities
- Review existing component patterns for consistency`;
}

/** WU-1261: Generate enforcement summary from resolved policy */
export function generateEnforcementSummary(policy: ResolvedPolicy): string {
  const lines: string[] = ['## You will be judged by', ''];

  // Testing methodology
  const testingStatus = policy.tests_required ? 'required' : 'optional';
  lines.push(`- **Testing**: ${policy.testing} (tests ${testingStatus})`);

  // Coverage
  if (policy.coverage_mode === 'off') {
    lines.push('- **Coverage**: disabled');
  } else {
    const modeLabel = policy.coverage_mode === 'block' ? 'blocking' : 'warn only';
    lines.push(`- **Coverage**: ${policy.coverage_threshold}% (${modeLabel})`);
  }

  // Architecture
  if (policy.architecture !== 'none') {
    lines.push(`- **Architecture**: ${policy.architecture}`);
  }

  return lines.join('\n');
}

/** Generate worktree block recovery section (WU-1192) */
export function generateWorktreeBlockRecoverySection(worktreePath: string): string {
  const worktreePathHint = worktreePath || resolveWorktreePathFallback();
  return `## When Blocked by Worktree Hook

If you encounter a "worktree required" or "commit blocked" error:

1. **Check existing worktrees**: \`git worktree list\`
2. **Navigate to the worktree**: \`cd ${worktreePathHint}\`
3. **Retry your operation** from within the worktree
4. **Use relative paths only** (never absolute paths)

### Common Causes

- Running \`git commit\` from main checkout instead of worktree
- Using absolute paths that bypass worktree isolation
- Forgetting to \`cd\` to worktree after \`wu:claim\`

### Quick Fix

\`\`\`bash
# Check where you are
pwd
git worktree list

# Navigate to your worktree
cd ${worktreePathHint}

# Retry your commit
git add . && git commit -m "your message"
\`\`\``;
}
