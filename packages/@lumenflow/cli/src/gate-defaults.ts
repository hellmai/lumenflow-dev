// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Default Gate Registration
 *
 * WU-1550: Extracts the hardcoded gate arrays from executeGates() into
 * declarative registration functions. This satisfies the Open-Closed Principle:
 * new gates can be added by creating a file and calling registry.register()
 * without modifying executeGates().
 *
 * @module gate-defaults
 */

import type { GateRegistry, GateDefinition } from './gate-registry.js';
import type { DocsOnlyTestPlan } from './gates-types.js';
import { GATE_NAMES, GATE_COMMANDS, SCRIPTS } from '@lumenflow/core/wu-constants';
import { runCoChangeGate } from './gates-runners.js';

/**
 * Options for docs-only gate registration.
 */
export interface DocsOnlyGateOptions {
  laneHealthMode: string;
  testsRequired: boolean;
  docsOnlyTestPlan: DocsOnlyTestPlan | null;
}

/**
 * Options for code gate registration.
 */
export interface CodeGateOptions {
  isFullLint: boolean;
  isFullTests: boolean;
  isFullCoverage: boolean;
  laneHealthMode: string;
  testsRequired: boolean;
  shouldRunIntegration: boolean;
  configuredTestFullCmd: string;
}

/**
 * Register the default docs-only gates into the registry.
 *
 * These gates run when --docs-only is passed or when risk detection
 * identifies the change as documentation-only.
 *
 * @param registry - Gate registry to populate
 * @param options - Configuration options affecting gate behavior
 */
export function registerDocsOnlyGates(registry: GateRegistry, options: DocsOnlyGateOptions): void {
  const { laneHealthMode, testsRequired, docsOnlyTestPlan } = options;

  // WU-2252: Invariants check runs first (non-bypassable)
  registry.register({
    name: GATE_NAMES.INVARIANTS,
    cmd: GATE_COMMANDS.INVARIANTS,
  });

  registry.register({
    name: GATE_NAMES.FORMAT_CHECK,
    scriptName: SCRIPTS.FORMAT_CHECK,
    // run function is injected by the gate runner (runFormatCheckGate)
    // We use a sentinel to indicate this gate needs its run function set
    cmd: undefined,
    run: undefined,
  } as GateDefinition);

  registry.register({
    name: GATE_NAMES.SPEC_LINTER,
    scriptName: SCRIPTS.SPEC_LINTER,
  } as GateDefinition);

  // WU-1467: prompts:lint removed -- was a stub (exit 0)
  registry.register({
    name: GATE_NAMES.BACKLOG_SYNC,
  } as GateDefinition);

  registry.register({
    name: GATE_NAMES.CLAIM_VALIDATION,
  } as GateDefinition);

  // WU-1191: Lane health check (configurable: warn/error/off)
  registry.register({
    name: GATE_NAMES.LANE_HEALTH,
    warnOnly: laneHealthMode !== 'error',
  } as GateDefinition);

  // WU-1315: Onboarding smoke test
  registry.register({
    name: GATE_NAMES.ONBOARDING_SMOKE_TEST,
    cmd: GATE_COMMANDS.ONBOARDING_SMOKE_TEST,
  });

  // WU-1299: Filtered tests for packages in code_paths (if UnsafeAny)
  if (docsOnlyTestPlan && docsOnlyTestPlan.mode === 'filtered') {
    registry.register({
      name: GATE_NAMES.TEST,
      warnOnly: !testsRequired,
    } as GateDefinition);
  }
}

/**
 * Register the default code gates into the registry.
 *
 * These gates run for non-docs-only changes and include the full
 * lint, typecheck, and test pipeline.
 *
 * @param registry - Gate registry to populate
 * @param options - Configuration options affecting gate behavior
 */
export function registerCodeGates(registry: GateRegistry, options: CodeGateOptions): void {
  const {
    isFullLint,
    isFullTests,
    isFullCoverage,
    laneHealthMode,
    testsRequired,
    shouldRunIntegration,
    configuredTestFullCmd,
  } = options;

  // WU-2252: Invariants check runs first (non-bypassable)
  registry.register({
    name: GATE_NAMES.INVARIANTS,
    cmd: GATE_COMMANDS.INVARIANTS,
  });

  registry.register({
    name: GATE_NAMES.FORMAT_CHECK,
    scriptName: SCRIPTS.FORMAT_CHECK,
  } as GateDefinition);

  registry.register({
    name: GATE_NAMES.LINT,
    cmd: isFullLint ? `pnpm ${SCRIPTS.LINT}` : GATE_COMMANDS.INCREMENTAL,
    scriptName: SCRIPTS.LINT,
  });

  registry.register({
    name: GATE_NAMES.CO_CHANGE,
    run: runCoChangeGate,
  } as GateDefinition);

  registry.register({
    name: GATE_NAMES.TYPECHECK,
    cmd: `pnpm ${SCRIPTS.TYPECHECK}`,
    scriptName: SCRIPTS.TYPECHECK,
  });

  registry.register({
    name: GATE_NAMES.SPEC_LINTER,
    scriptName: SCRIPTS.SPEC_LINTER,
  } as GateDefinition);

  // WU-1467: prompts:lint removed -- was a stub (exit 0)
  registry.register({
    name: GATE_NAMES.BACKLOG_SYNC,
  } as GateDefinition);

  registry.register({
    name: GATE_NAMES.CLAIM_VALIDATION,
  } as GateDefinition);

  registry.register({
    name: GATE_NAMES.SUPABASE_DOCS_LINTER,
  } as GateDefinition);

  // WU-1191: Lane health check
  registry.register({
    name: GATE_NAMES.LANE_HEALTH,
    warnOnly: laneHealthMode !== 'error',
  } as GateDefinition);

  // WU-1315: Onboarding smoke test
  registry.register({
    name: GATE_NAMES.ONBOARDING_SMOKE_TEST,
    cmd: GATE_COMMANDS.ONBOARDING_SMOKE_TEST,
  });

  // WU-2062: Safety-critical tests ALWAYS run
  registry.register({
    name: GATE_NAMES.SAFETY_CRITICAL_TEST,
    cmd: GATE_COMMANDS.SAFETY_CRITICAL_TEST,
    warnOnly: !testsRequired,
  });

  // WU-1920: Changed tests by default, full suite with --full-tests
  registry.register({
    name: GATE_NAMES.TEST,
    cmd: isFullTests || isFullCoverage ? configuredTestFullCmd : GATE_COMMANDS.INCREMENTAL_TEST,
    warnOnly: !testsRequired,
  });

  // WU-2062: Integration tests only for high-risk changes
  if (shouldRunIntegration) {
    registry.register({
      name: GATE_NAMES.INTEGRATION_TEST,
      cmd: GATE_COMMANDS.TIERED_TEST,
      warnOnly: !testsRequired,
    });
  }

  // WU-1433: Coverage gate
  registry.register({
    name: GATE_NAMES.COVERAGE,
    cmd: GATE_COMMANDS.COVERAGE_GATE,
  });
}
