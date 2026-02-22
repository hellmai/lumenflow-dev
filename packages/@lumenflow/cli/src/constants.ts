// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared constants for CLI commands (WU-2011)
 *
 * Extracts magic numbers and string literals from business logic
 * into named, exported constants for maintainability.
 *
 * @module constants
 */

// ── Display Truncation ────────────────────────────────────────────────

/** Maximum characters for git summary preview in dry-run output */
export const GIT_SUMMARY_PREVIEW_LENGTH = 500;

/** Maximum characters for system prompt preview in dry-run output */
export const SYSTEM_PROMPT_PREVIEW_LENGTH = 500;

/** Maximum characters for user prompt preview in dry-run output */
export const USER_PROMPT_PREVIEW_LENGTH = 1000;

/** Maximum characters for memory content preview */
export const CONTENT_PREVIEW_LENGTH = 200;

/** Maximum characters for discovery node content display */
export const DISCOVERY_CONTENT_TRUNCATION_LENGTH = 60;

/** Maximum characters for markdown table title column */
export const MARKDOWN_TABLE_TITLE_LENGTH = 30;

/** Maximum characters for issue title display */
export const ISSUE_TITLE_TRUNCATION_LENGTH = 40;

/** Length of truncated title text (before appending ellipsis) */
export const ISSUE_TITLE_TRUNCATED_TEXT_LENGTH = 37;

/** Maximum characters for WU title column in flow report table */
export const FLOW_REPORT_TITLE_COLUMN_WIDTH = 25;

/** Padding width for WU ID column in flow report table */
export const WU_ID_COLUMN_WIDTH = 8;

/** Padding width for lane column in flow report table */
export const LANE_COLUMN_WIDTH = 15;

// ── List Display Limits ───────────────────────────────────────────────

/** Maximum number of items to show in a cleanup list before truncation */
export const CLEANUP_LIST_DISPLAY_LIMIT = 10;

/** Maximum number of files to show in a trace report before truncation */
export const TRACE_FILES_DISPLAY_LIMIT = 20;

/** Maximum number of WUs to show in a flow report table before truncation */
export const FLOW_REPORT_WU_DISPLAY_LIMIT = 10;

/** Number of top common issues to display in summary */
export const TOP_ISSUES_DISPLAY_LIMIT = 5;

/** Number of recent issues to display in summary */
export const RECENT_ISSUES_DISPLAY_LIMIT = 5;

// ── Padding Widths ────────────────────────────────────────────────────

/** Padding width for gate name column in flow report table */
export const GATE_NAME_COLUMN_WIDTH = 20;

/** Padding width for severity label in issue display */
export const SEVERITY_PADDING_WIDTH = 10;

/** Padding width for category label in issue display */
export const CATEGORY_PADDING_WIDTH = 20;

// ── Validation Thresholds ─────────────────────────────────────────────

/** Minimum content length for agent definition files (characters) */
export const MIN_AGENT_CONTENT_LENGTH = 50;

/** Minimum content length for skill definition files (characters) */
export const MIN_SKILL_CONTENT_LENGTH = 100;

/** Maximum length for WU ID string validation */
export const MAX_WU_ID_LENGTH = 32;

// ── Git / Trace ───────────────────────────────────────────────────────

/** Number of hex characters to keep when truncating commit SHAs */
export const COMMIT_SHA_DISPLAY_LENGTH = 8;

/** Maximum tokens for git context summary in LLM prompts */
export const GIT_CONTEXT_MAX_TOKENS = 500;

// ── Log Tail ──────────────────────────────────────────────────────────

/** Default maximum number of lines to read from log tail */
export const LOG_TAIL_MAX_LINES = 40;

/** Default maximum bytes to read from log tail (64 KB) */
export const LOG_TAIL_MAX_BYTES = 64 * 1024;

// ── Time Conversion ───────────────────────────────────────────────────

/** Milliseconds per hour (1000 ms * 60 s * 60 min) */
export const MS_PER_HOUR = 1000 * 60 * 60;

/** Factor for rounding to one decimal place */
export const ONE_DECIMAL_ROUNDING_FACTOR = 10;

// ── JSON Formatting ───────────────────────────────────────────────────

/** Standard indentation for JSON.stringify pretty-print output */
export const JSON_INDENT = 2;
