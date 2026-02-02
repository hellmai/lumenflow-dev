#!/usr/bin/env tsx
/* eslint-disable no-console -- CLI tool uses console for output */
/**
 * @file tools/onboarding-smoke-test.ts
 * CLI entry point for running the onboarding smoke test standalone (WU-1315)
 *
 * This script runs the onboarding smoke test outside of the gates pipeline,
 * useful for debugging or validating init + wu:create flows in isolation.
 *
 * Usage:
 *   npx tsx tools/onboarding-smoke-test.ts
 *   npx tsx tools/onboarding-smoke-test.ts --no-cleanup
 */

import {
  runOnboardingSmokeTest,
  type OnboardingSmokeTestResult,
} from '../packages/@lumenflow/cli/src/onboarding-smoke-test.js';

/** Exit codes for CLI */
const EXIT_CODES = {
  SUCCESS: 0,
  FAILURE: 1,
} as const;

/** CLI arguments */
interface CliArgs {
  noCleanup: boolean;
  help: boolean;
}

/**
 * Parse command line arguments
 */
function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  return {
    noCleanup: args.includes('--no-cleanup'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Usage: npx tsx tools/onboarding-smoke-test.ts [options]

Run the LumenFlow onboarding smoke test.

Options:
  --no-cleanup  Keep temp directory after test (for debugging)
  --help, -h    Show this help message

Description:
  Creates a temporary directory and runs:
  1. lumenflow init --full
  2. Validates package.json scripts use standalone binary format
  3. Validates lane-inference.yaml uses hierarchical format
  4. Validates wu:create works with requireRemote=false

Exit codes:
  0  All validations passed
  1  One or more validations failed
`);
}

/**
 * Format result for console output
 */
function formatResult(result: OnboardingSmokeTestResult): void {
  if (result.success) {
    console.log('\n✅ Onboarding smoke test passed!\n');

    if (result.initScriptsValidation) {
      console.log('  ✓ Package.json scripts validated');
    }
    if (result.laneInferenceValidation) {
      console.log('  ✓ Lane-inference format validated');
    }
    if (result.wuCreateValidation) {
      console.log('  ✓ wu:create with requireRemote=false validated');
    }
  } else {
    console.log('\n❌ Onboarding smoke test failed!\n');

    for (const error of result.errors) {
      console.log(`  - ${error}`);
    }
  }

  if (result.tempDir) {
    console.log(`\n  Temp directory: ${result.tempDir}`);
  }

  console.log('');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  console.log('Running onboarding smoke test...\n');

  const result = await runOnboardingSmokeTest({
    cleanup: !args.noCleanup,
  });

  formatResult(result);

  process.exit(result.success ? EXIT_CODES.SUCCESS : EXIT_CODES.FAILURE);
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(EXIT_CODES.FAILURE);
});
