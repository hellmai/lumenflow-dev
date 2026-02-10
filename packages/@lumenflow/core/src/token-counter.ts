/**
 * Token Counter Utility
 *
 * Wraps tiktoken for counting tokens in prompts using the o200k_base encoding
 * (used by gpt-5-nano). Provides caching and hash computation for stability checks.
 *
 * Part of WU-676: Single-Call LLM Orchestrator token budget enforcement.
 */

import { get_encoding } from 'tiktoken';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { parseYAML } from './wu-yaml.js';
import { createError, ErrorCodes } from './error-handler.js';
import { EXIT_CODES, STRING_LITERALS } from './wu-constants.js';

// Cache tokenizer instance (expensive to create)
let tokenizerCache = null;

/**
 * Get or create tiktoken instance with o200k_base encoding (gpt-5-nano)
 * @returns {Tiktoken} Tokenizer instance
 */
function getTokenizer() {
  if (!tokenizerCache) {
    tokenizerCache = get_encoding('o200k_base');
  }
  return tokenizerCache;
}

/**
 * Count tokens in text using gpt-5-nano tokenizer
 * @param {string} text - Text to tokenize
 * @returns {number} Token count
 */
export function countTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  const tokenizer = getTokenizer();
  const tokens = tokenizer.encode(text);
  return tokens.length;
}

/**
 * Compute SHA256 hash of text (for stability checks)
 * @param {string} text - Text to hash
 * @returns {string} Hex hash
 */
export function computeHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Strip YAML comments from prompt text
 * @param {string} text - YAML text
 * @returns {string} Text with comments removed
 */
function stripYAMLComments(text) {
  return text
    .split(STRING_LITERALS.NEWLINE)
    .filter((line) => !line.trim().startsWith('#'))
    .join(STRING_LITERALS.NEWLINE);
}

/**
 * Load and render a prompt file (resolves includes, strips comments)
 * @param {string} promptPath - Absolute path to prompt YAML file
 * @returns {{text: string, raw: string}} Rendered text and raw YAML
 */
export function loadPrompt(promptPath) {
  try {
    const raw = readFileSync(promptPath, { encoding: 'utf-8' });

    // Parse YAML to access prompt structure
    const parsed = parseYAML(raw) as
      | { prompt?: string; system?: string; content?: string }
      | string
      | null;

    // Extract prompt text (handle different YAML structures)
    let promptText = '';
    if (typeof parsed === 'string') {
      promptText = parsed;
    } else if (parsed && parsed.prompt) {
      promptText = parsed.prompt;
    } else if (parsed && parsed.system) {
      promptText = parsed.system;
    } else if (parsed && parsed.content) {
      promptText = parsed.content;
    } else {
      // Fallback: use entire YAML stringified (for complex structures)
      promptText = JSON.stringify(parsed, null, 2);
    }

    // Strip comments from rendered text
    const renderedText = stripYAMLComments(promptText);

    return { text: renderedText, raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createError(
      ErrorCodes.FILE_NOT_FOUND,
      `Failed to load prompt from ${promptPath}: ${message}`,
      { path: promptPath, originalError: message },
    );
  }
}

/**
 * Analyze a prompt file (count tokens, compute hash, extract metadata)
 * @param {string} promptPath - Absolute path to prompt YAML file
 * @returns {{tokenCount: number, hash: string, text: string, raw: string}}
 */
export function analyzePrompt(promptPath) {
  const { text, raw } = loadPrompt(promptPath);
  const tokenCount = countTokens(text);
  const hash = computeHash(text);

  return {
    tokenCount,
    hash,
    text,
    raw,
  };
}

/**
 * Get top N longest lines from text (for cleanup targeting)
 * @param {string} text - Text to analyze
 * @param {number} n - Number of lines to return
 * @returns {Array<{line: string, length: number, number: number}>} Longest lines
 */
export function getLongestLines(text, n = 3) {
  const lines = text.split(STRING_LITERALS.NEWLINE);
  const linesWithMetadata = lines.map((line, index) => ({
    line: line.trim(),
    length: line.length,
    number: index + 1,
  }));

  // Sort by length descending, take top N
  return linesWithMetadata
    .filter((l) => l.line.length > 0)
    .sort((a, b) => b.length - a.length)
    .slice(0, n);
}

/**
 * Cleanup function (call on process exit to free tokenizer)
 */
export function cleanup() {
  if (tokenizerCache) {
    tokenizerCache.free();
    tokenizerCache = null;
  }
}

// Auto-cleanup on process exit
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(EXIT_CODES.SUCCESS);
});
