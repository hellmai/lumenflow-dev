// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Constants module tests (WU-2011)
 *
 * Validates that all extracted constants are properly exported
 * and have sensible values.
 */

import { describe, it, expect } from 'vitest';
import {
  GIT_SUMMARY_PREVIEW_LENGTH,
  GIT_CONTEXT_MAX_TOKENS,
  SYSTEM_PROMPT_PREVIEW_LENGTH,
  USER_PROMPT_PREVIEW_LENGTH,
  CONTENT_PREVIEW_LENGTH,
  DISCOVERY_CONTENT_TRUNCATION_LENGTH,
  MARKDOWN_TABLE_TITLE_LENGTH,
  ISSUE_TITLE_TRUNCATION_LENGTH,
  ISSUE_TITLE_TRUNCATED_TEXT_LENGTH,
  FLOW_REPORT_TITLE_COLUMN_WIDTH,
  WU_ID_COLUMN_WIDTH,
  LANE_COLUMN_WIDTH,
  GATE_NAME_COLUMN_WIDTH,
  CLEANUP_LIST_DISPLAY_LIMIT,
  TRACE_FILES_DISPLAY_LIMIT,
  FLOW_REPORT_WU_DISPLAY_LIMIT,
  TOP_ISSUES_DISPLAY_LIMIT,
  RECENT_ISSUES_DISPLAY_LIMIT,
  SEVERITY_PADDING_WIDTH,
  CATEGORY_PADDING_WIDTH,
  MIN_AGENT_CONTENT_LENGTH,
  MIN_SKILL_CONTENT_LENGTH,
  MAX_WU_ID_LENGTH,
  COMMIT_SHA_DISPLAY_LENGTH,
  LOG_TAIL_MAX_LINES,
  LOG_TAIL_MAX_BYTES,
  MS_PER_HOUR,
  ONE_DECIMAL_ROUNDING_FACTOR,
  JSON_INDENT,
} from '../src/constants.js';

describe('CLI constants (WU-2011)', () => {
  describe('display truncation constants', () => {
    it('exports positive truncation lengths', () => {
      expect(GIT_SUMMARY_PREVIEW_LENGTH).toBeGreaterThan(0);
      expect(SYSTEM_PROMPT_PREVIEW_LENGTH).toBeGreaterThan(0);
      expect(USER_PROMPT_PREVIEW_LENGTH).toBeGreaterThan(0);
      expect(CONTENT_PREVIEW_LENGTH).toBeGreaterThan(0);
      expect(DISCOVERY_CONTENT_TRUNCATION_LENGTH).toBeGreaterThan(0);
      expect(MARKDOWN_TABLE_TITLE_LENGTH).toBeGreaterThan(0);
      expect(ISSUE_TITLE_TRUNCATION_LENGTH).toBeGreaterThan(0);
    });

    it('truncated text length is less than full truncation length', () => {
      expect(ISSUE_TITLE_TRUNCATED_TEXT_LENGTH).toBeLessThan(ISSUE_TITLE_TRUNCATION_LENGTH);
    });

    it('exports specific expected values', () => {
      expect(GIT_SUMMARY_PREVIEW_LENGTH).toBe(500);
      expect(SYSTEM_PROMPT_PREVIEW_LENGTH).toBe(500);
      expect(USER_PROMPT_PREVIEW_LENGTH).toBe(1000);
      expect(CONTENT_PREVIEW_LENGTH).toBe(200);
      expect(DISCOVERY_CONTENT_TRUNCATION_LENGTH).toBe(60);
      expect(MARKDOWN_TABLE_TITLE_LENGTH).toBe(30);
      expect(ISSUE_TITLE_TRUNCATION_LENGTH).toBe(40);
      expect(ISSUE_TITLE_TRUNCATED_TEXT_LENGTH).toBe(37);
    });
  });

  describe('column width constants', () => {
    it('exports positive column widths', () => {
      expect(FLOW_REPORT_TITLE_COLUMN_WIDTH).toBeGreaterThan(0);
      expect(WU_ID_COLUMN_WIDTH).toBeGreaterThan(0);
      expect(LANE_COLUMN_WIDTH).toBeGreaterThan(0);
      expect(GATE_NAME_COLUMN_WIDTH).toBeGreaterThan(0);
      expect(SEVERITY_PADDING_WIDTH).toBeGreaterThan(0);
      expect(CATEGORY_PADDING_WIDTH).toBeGreaterThan(0);
    });
  });

  describe('list display limit constants', () => {
    it('exports positive display limits', () => {
      expect(CLEANUP_LIST_DISPLAY_LIMIT).toBeGreaterThan(0);
      expect(TRACE_FILES_DISPLAY_LIMIT).toBeGreaterThan(0);
      expect(FLOW_REPORT_WU_DISPLAY_LIMIT).toBeGreaterThan(0);
      expect(TOP_ISSUES_DISPLAY_LIMIT).toBeGreaterThan(0);
      expect(RECENT_ISSUES_DISPLAY_LIMIT).toBeGreaterThan(0);
    });

    it('exports specific expected values', () => {
      expect(CLEANUP_LIST_DISPLAY_LIMIT).toBe(10);
      expect(TRACE_FILES_DISPLAY_LIMIT).toBe(20);
      expect(FLOW_REPORT_WU_DISPLAY_LIMIT).toBe(10);
      expect(TOP_ISSUES_DISPLAY_LIMIT).toBe(5);
      expect(RECENT_ISSUES_DISPLAY_LIMIT).toBe(5);
    });
  });

  describe('validation threshold constants', () => {
    it('exports positive thresholds', () => {
      expect(MIN_AGENT_CONTENT_LENGTH).toBeGreaterThan(0);
      expect(MIN_SKILL_CONTENT_LENGTH).toBeGreaterThan(0);
      expect(MAX_WU_ID_LENGTH).toBeGreaterThan(0);
    });

    it('skill minimum is greater than agent minimum', () => {
      expect(MIN_SKILL_CONTENT_LENGTH).toBeGreaterThan(MIN_AGENT_CONTENT_LENGTH);
    });
  });

  describe('git and trace constants', () => {
    it('exports valid SHA display length', () => {
      expect(COMMIT_SHA_DISPLAY_LENGTH).toBe(8);
    });

    it('exports valid git context max tokens', () => {
      expect(GIT_CONTEXT_MAX_TOKENS).toBe(500);
    });
  });

  describe('log tail constants', () => {
    it('exports positive log tail defaults', () => {
      expect(LOG_TAIL_MAX_LINES).toBeGreaterThan(0);
      expect(LOG_TAIL_MAX_BYTES).toBeGreaterThan(0);
    });

    it('max bytes is 64 KB', () => {
      expect(LOG_TAIL_MAX_BYTES).toBe(65536);
    });
  });

  describe('time conversion constants', () => {
    it('MS_PER_HOUR equals 3600000', () => {
      expect(MS_PER_HOUR).toBe(3_600_000);
    });

    it('ONE_DECIMAL_ROUNDING_FACTOR is 10', () => {
      expect(ONE_DECIMAL_ROUNDING_FACTOR).toBe(10);
    });
  });

  describe('JSON formatting constants', () => {
    it('JSON_INDENT is 2', () => {
      expect(JSON_INDENT).toBe(2);
    });
  });
});
