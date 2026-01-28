#!/usr/bin/env node
/**
 * wu:done validators - aggregated exports
 *
 * WU-1049: Split validators into focused modules while preserving exports.
 */

export { validateInputs } from './wu-done-inputs.js';
export {
  readWUPreferWorktree,
  detectCurrentWorktree,
  defaultWorktreeFrom,
  detectWorkspaceMode,
  defaultBranchFrom,
  branchExists,
  detectModeAndPaths,
} from './wu-done-paths.js';
export {
  generateCommitMessage,
  validateMetadataFilesExist,
  updateMetadataFiles,
  collectMetadataToTransaction,
  stageAndFormatMetadata,
} from './wu-done-metadata.js';
export { runCleanup } from './wu-done-cleanup.js';
export {
  applyExposureDefaults,
  validateCodePathsExist,
  validateSpecCompleteness,
  validatePostMutation,
  validateTestPathsRequired,
  validateTypeVsCodePathsPreflight,
  buildTypeVsCodePathsErrorMessage,
} from './wu-done-validation.js';
export {
  buildPreflightErrorMessage,
  executePreflightCodePathValidation,
  buildPreflightCodePathErrorMessage,
  runPreflightTasksValidation,
  validateAllPreCommitHooks,
} from './wu-done-preflight.js';

export { validateAutomatedTestRequirement } from './manual-test-validator.js';

// Type exports
export type { ValidateCodePathsExistOptions } from './wu-done-validation.js';
export type {
  ExecutePreflightCodePathValidationOptions,
  ValidateAllPreCommitHooksOptions,
} from './wu-done-preflight.js';
