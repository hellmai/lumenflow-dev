import { describe, it, expect } from 'vitest';
import { TOKENIZER } from '../tokenizer-constants.js';

describe('tokenizer-constants', () => {
  describe('TOKENIZER', () => {
    it('has positive word-to-token ratio', () => {
      expect(TOKENIZER.WORD_TO_TOKEN_RATIO).toBeGreaterThan(0);
    });

    it('has reasonable word-to-token ratio (between 1 and 2)', () => {
      // Typical tokenizers produce 1-2 tokens per word on average
      expect(TOKENIZER.WORD_TO_TOKEN_RATIO).toBeGreaterThanOrEqual(1);
      expect(TOKENIZER.WORD_TO_TOKEN_RATIO).toBeLessThanOrEqual(2);
    });
  });
});
