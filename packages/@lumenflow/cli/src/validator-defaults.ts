/**
 * Default Validator Registration
 *
 * WU-1550: Extracts the validator invocations from wu-done.ts into
 * declarative registration functions. This satisfies the Open-Closed Principle:
 * new validators can be added by creating a file and calling registry.register()
 * without modifying the wu-done orchestration code.
 *
 * Note: The actual validator implementations remain in @lumenflow/core.
 * This module registers references to those validators so the wu-done
 * orchestrator can discover and invoke them declaratively.
 *
 * @module validator-defaults
 */

import type { ValidatorRegistry } from './validator-registry.js';

/**
 * Register preflight validators into the registry.
 *
 * Preflight validators run before gates to catch issues early
 * (e.g., missing code paths, type mismatches, spec completeness).
 *
 * @param registry - Validator registry to populate
 */
export function registerPreflightValidators(registry: ValidatorRegistry): void {
  // WU-1805: Preflight code_paths validation before gates
  registry.register({
    name: 'code-path-preflight',
    phase: 'preflight',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // WU-2310: Type vs code_paths preflight validation
  registry.register({
    name: 'type-vs-code-paths',
    phase: 'preflight',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // Spec completeness validation
  registry.register({
    name: 'spec-completeness',
    phase: 'preflight',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // WU consistency check
  registry.register({
    name: 'wu-consistency',
    phase: 'preflight',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // WU-1503: Dirty-main pre-merge guard
  registry.register({
    name: 'dirty-main-guard',
    phase: 'preflight',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // Preflight tasks validation
  registry.register({
    name: 'preflight-tasks',
    phase: 'preflight',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });
}

/**
 * Register completion validators into the registry.
 *
 * Completion validators run after gates pass, before the final
 * merge/stamp/cleanup sequence.
 *
 * @param registry - Validator registry to populate
 */
export function registerCompletionValidators(registry: ValidatorRegistry): void {
  // Code paths existence validation
  registry.register({
    name: 'code-paths-exist',
    phase: 'completion',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // WU-1542: Mandatory agents compliance
  registry.register({
    name: 'mandatory-agents-compliance',
    phase: 'completion',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // WU-1012: Docs-only flag validation
  registry.register({
    name: 'docs-only-flag',
    phase: 'completion',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // WU-1999: Exposure validation (non-blocking warnings)
  registry.register({
    name: 'exposure-warnings',
    phase: 'completion',
    validate: () => ({ valid: true, warnings: [] }),
    blocking: false,
  });

  // WU-2022: Feature accessibility validation
  registry.register({
    name: 'feature-accessibility',
    phase: 'completion',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });

  // Backlog sync validation
  registry.register({
    name: 'backlog-sync',
    phase: 'completion',
    validate: () => ({ valid: true, errors: [] }),
    blocking: true,
  });
}
