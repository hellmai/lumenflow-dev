import {
  validateWURulesSync,
  validateWURulesWithResolvers,
  type ValidationPhase,
  type WUValidationContextInput,
  type WUValidationResult,
} from './wu-rules-core.js';
import { createDefaultWURuleResolvers } from './wu-rules-resolvers.js';

export * from './wu-rules-core.js';
export {
  pathReferenceExistsSync,
  pathReferenceExists,
  resolveBaseRef,
  resolveChangedFiles,
  resolveCliBinDiff,
  createDefaultWURuleResolvers,
} from './wu-rules-resolvers.js';

/**
 * Backward-compatible facade for the shared WU rules engine.
 *
 * Reality-phase validation is resolved via explicit git/fs adapters
 * from wu-rules-resolvers so rule evaluation in wu-rules-core stays pure.
 */
export async function validateWURules(
  input: WUValidationContextInput,
  options: { phase?: ValidationPhase } = {},
): Promise<WUValidationResult> {
  return validateWURulesWithResolvers(input, options, createDefaultWURuleResolvers());
}

export { validateWURulesSync };
