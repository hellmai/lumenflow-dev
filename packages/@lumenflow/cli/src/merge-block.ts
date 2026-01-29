/**
 * @file merge-block.ts
 * Merge block utilities for safe, idempotent config insertion (WU-1171)
 *
 * This module provides utilities to safely merge LumenFlow configuration
 * into existing files using bounded markers (LUMENFLOW:START/END).
 */

/**
 * Marker comments for LumenFlow blocks
 */
export const MARKERS = {
  START: '<!-- LUMENFLOW:START -->',
  END: '<!-- LUMENFLOW:END -->',
} as const;

/**
 * Result of extracting a merge block from content
 */
export interface MergeBlockExtraction {
  /** Whether a complete block was found */
  found: boolean;
  /** The content between markers (if found) */
  content?: string;
  /** Start index of the START marker */
  startIndex?: number;
  /** End index (after END marker) */
  endIndex?: number;
  /** Whether markers are malformed */
  malformed?: boolean;
  /** Reason for malformed state */
  malformedReason?: 'missing-start' | 'missing-end' | 'multiple-start' | 'multiple-end';
}

/**
 * Result of updating a merge block
 */
export interface MergeBlockResult {
  /** The resulting content */
  content: string;
  /** Whether any update was made */
  updated: boolean;
  /** Whether block was inserted (vs updated) */
  wasInserted?: boolean;
  /** Whether content was unchanged */
  unchanged?: boolean;
  /** Warning message if there were issues */
  warning?: string;
}

/**
 * Detect the predominant line ending in content.
 *
 * @param content - The file content to analyze
 * @returns '\r\n' for CRLF, '\n' for LF (default)
 */
export function detectLineEnding(content: string): '\n' | '\r\n' {
  if (!content) {
    return '\n';
  }

  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;

  // If no line endings found, default to LF
  if (crlfCount === 0 && lfCount === 0) {
    return '\n';
  }

  // Use majority line ending
  return crlfCount >= lfCount ? '\r\n' : '\n';
}

/**
 * Normalize line endings in content to the specified style.
 *
 * @param content - The content to normalize
 * @param lineEnding - The target line ending
 * @returns Content with normalized line endings
 */
export function normalizeLineEndings(content: string, lineEnding: '\n' | '\r\n'): string {
  // First normalize to LF, then convert to target
  const normalized = content.replace(/\r\n/g, '\n');
  if (lineEnding === '\r\n') {
    return normalized.replace(/\n/g, '\r\n');
  }
  return normalized;
}

/**
 * Extract the LumenFlow block from content if it exists.
 *
 * @param content - The file content to search
 * @returns Extraction result with block details
 */
export function extractMergeBlock(content: string): MergeBlockExtraction {
  // Use indexOf for simple string matching instead of regex to avoid DOS vulnerability
  const startIndexes: number[] = [];
  const endIndexes: number[] = [];

  let pos = 0;
  while ((pos = content.indexOf(MARKERS.START, pos)) !== -1) {
    startIndexes.push(pos);
    pos += MARKERS.START.length;
  }

  pos = 0;
  while ((pos = content.indexOf(MARKERS.END, pos)) !== -1) {
    endIndexes.push(pos);
    pos += MARKERS.END.length;
  }

  // Check for malformed cases
  if (startIndexes.length > 1) {
    return { found: false, malformed: true, malformedReason: 'multiple-start' };
  }

  if (endIndexes.length > 1) {
    return { found: false, malformed: true, malformedReason: 'multiple-end' };
  }

  const hasStart = startIndexes.length === 1;
  const hasEnd = endIndexes.length === 1;

  if (hasStart && !hasEnd) {
    return { found: false, malformed: true, malformedReason: 'missing-end' };
  }

  if (!hasStart && hasEnd) {
    return { found: false, malformed: true, malformedReason: 'missing-start' };
  }

  if (!hasStart && !hasEnd) {
    return { found: false };
  }

  // Both markers present - extract content
  const startIndex = startIndexes[0];
  const endMarkerIndex = endIndexes[0];
  const endIndex = endMarkerIndex + MARKERS.END.length;

  // Verify END comes after START
  if (endMarkerIndex <= startIndex) {
    return { found: false, malformed: true, malformedReason: 'missing-end' };
  }

  // Extract content between markers (excluding the markers and surrounding newlines)
  const afterStart = startIndex + MARKERS.START.length;
  const beforeEnd = endMarkerIndex;

  let blockContent = content.slice(afterStart, beforeEnd);

  // Trim leading/trailing newlines from the block content
  // Use simple loop to avoid regex ReDoS vulnerability
  blockContent = trimNewlines(blockContent);

  return {
    found: true,
    content: blockContent,
    startIndex,
    endIndex,
  };
}

/**
 * Insert a new merge block into content.
 *
 * @param originalContent - The existing file content
 * @param blockContent - The content to place inside the block
 * @returns The content with the new block appended
 */
export function insertMergeBlock(originalContent: string, blockContent: string): string {
  const lineEnding = detectLineEnding(originalContent);
  const normalizedBlock = normalizeLineEndings(blockContent, lineEnding);

  // Ensure content ends with newlines for separation
  let content = originalContent;
  if (!content.endsWith(lineEnding)) {
    content += lineEnding;
  }
  if (!content.endsWith(lineEnding + lineEnding) && content.trim().length > 0) {
    content += lineEnding;
  }

  // Build the block
  const block = [MARKERS.START, normalizedBlock, MARKERS.END, ''].join(lineEnding);

  return content + block;
}

/**
 * Update or insert a merge block in content.
 *
 * @param originalContent - The existing file content
 * @param newBlockContent - The new content for the block
 * @returns Result with the updated content and metadata
 */
export function updateMergeBlock(
  originalContent: string,
  newBlockContent: string,
): MergeBlockResult {
  const lineEnding = detectLineEnding(originalContent);
  const extraction = extractMergeBlock(originalContent);

  // If malformed, warn and append fresh block
  if (extraction.malformed) {
    const warning = `LumenFlow markers are malformed (${extraction.malformedReason}). Appending fresh block.`;
    const result = insertMergeBlock(originalContent, newBlockContent);
    return {
      content: result,
      updated: true,
      wasInserted: true,
      warning,
    };
  }

  // If no existing block, insert new one
  if (!extraction.found) {
    return {
      content: insertMergeBlock(originalContent, newBlockContent),
      updated: true,
      wasInserted: true,
    };
  }

  // Check if content is unchanged
  const normalizedNew = normalizeLineEndings(newBlockContent, lineEnding).trim();
  const normalizedExisting = (extraction.content || '').trim();

  if (normalizedNew === normalizedExisting) {
    return {
      content: originalContent,
      updated: false,
      unchanged: true,
    };
  }

  // Replace existing block - at this point we know extraction.found is true
  // so startIndex and endIndex are defined
  const startIdx = extraction.startIndex ?? 0;
  const endIdx = extraction.endIndex ?? originalContent.length;
  const before = originalContent.slice(0, startIdx);
  const after = originalContent.slice(endIdx);

  // Build the new block with preserved line endings
  const newBlock = [
    MARKERS.START,
    normalizeLineEndings(newBlockContent, lineEnding),
    MARKERS.END,
  ].join(lineEnding);

  // Combine parts, ensuring proper line ending between before and block
  let result = before;
  if (!result.endsWith(lineEnding) && result.length > 0) {
    result += lineEnding;
  }
  result += newBlock;

  // Handle after part
  if (after.trim().length > 0) {
    if (!result.endsWith(lineEnding)) {
      result += lineEnding;
    }
    result += after;
  } else if (after.includes(lineEnding)) {
    // Preserve trailing newline if original had it
    if (!result.endsWith(lineEnding)) {
      result += lineEnding;
    }
  }

  return {
    content: result,
    updated: true,
  };
}

/**
 * Trim leading and trailing newlines from a string.
 * Uses simple loop to avoid regex ReDoS vulnerability.
 */
function trimNewlines(str: string): string {
  let start = 0;
  let end = str.length;

  // Trim leading newlines
  while (start < end && (str[start] === '\r' || str[start] === '\n')) {
    start++;
  }

  // Trim trailing newlines
  while (end > start && (str[end - 1] === '\r' || str[end - 1] === '\n')) {
    end--;
  }

  return str.slice(start, end);
}
