/**
 * Tokenizer Constants
 *
 * Configuration for token estimation in documentation files.
 * Used by token-count.mjs.
 */

/** Token estimation configuration */
export const TOKENIZER = {
  /**
   * Word to token ratio for estimation.
   * Industry standard approximation for GPT-family models.
   * Anthropic's Claude uses similar tokenization.
   */
  WORD_TO_TOKEN_RATIO: 1.33,
};
