import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IncidentLogSchema, appendIncident, readIncidents } from '../src/agent-incidents.js';

const TEST_INCIDENTS_DIR = '.lumenflow/incidents-test';

describe('IncidentLogSchema', () => {
  it('validates a complete incident log entry', () => {
    const validIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Unclear documentation',
      description: 'The workspace-modes.md file does not explain when to use branch-only mode',
      tags: ['documentation', 'worktree'],
      context: {
        git_branch: 'lane/operations-tooling/wu-1231',
        current_step: 'implementation',
        related_files: ['ai/onboarding/workspace-modes.md'],
      },
    };

    expect(() => IncidentLogSchema.parse(validIncident)).not.toThrow();
  });

  it('validates a minimal incident log entry', () => {
    const minimalIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'confusion',
      severity: 'info',
      title: 'Minor question',
      description: 'Quick clarification needed',
      tags: [],
      context: {},
    };

    expect(() => IncidentLogSchema.parse(minimalIncident)).not.toThrow();
  });

  it('rejects incident with invalid WU ID format', () => {
    const invalidIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-INVALID',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Test incident',
      description: 'Test description',
      tags: [],
      context: {},
    };

    expect(() => IncidentLogSchema.parse(invalidIncident)).toThrow();
  });

  it('rejects incident with invalid severity', () => {
    const invalidIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'invalid',
      title: 'Test incident',
      description: 'Test description',
      tags: [],
      context: {},
    };

    expect(() => IncidentLogSchema.parse(invalidIncident)).toThrow();
  });

  it('rejects incident with invalid timestamp', () => {
    const invalidIncident = {
      timestamp: 'invalid-date',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Test incident',
      description: 'Test description',
      tags: [],
      context: {},
    };

    expect(() => IncidentLogSchema.parse(invalidIncident)).toThrow();
  });
});

describe('appendIncident', () => {
  beforeEach(() => {
    // Clean up test incidents directory
    if (existsSync(TEST_INCIDENTS_DIR)) {
      rmSync(TEST_INCIDENTS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test incidents directory
    if (existsSync(TEST_INCIDENTS_DIR)) {
      rmSync(TEST_INCIDENTS_DIR, { recursive: true });
    }
  });

  it('should append valid incident to category file', () => {
    const incident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Test incident',
      description: 'Test description',
      tags: [],
      context: {},
    };

    appendIncident(incident, TEST_INCIDENTS_DIR);

    const categoryFile = join(TEST_INCIDENTS_DIR, 'workflow.ndjson');
    expect(existsSync(categoryFile)).toBe(true);

    const content = readFileSync(categoryFile, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsedIncident = JSON.parse(lines[0]!);
    expect(parsedIncident.title).toBe('Test incident');
    expect(parsedIncident.wu_id).toBe('WU-1231');
  });

  it('should create incidents directory if it does not exist', () => {
    const incident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Test incident',
      description: 'Test description',
      tags: [],
      context: {},
    };

    appendIncident(incident, TEST_INCIDENTS_DIR);

    expect(existsSync(TEST_INCIDENTS_DIR)).toBe(true);
  });

  it('should throw on invalid incident data', () => {
    const invalidIncident = {
      // Missing required fields
      timestamp: '2025-11-24T10:00:00.000Z',
    };

    expect(() => appendIncident(invalidIncident, TEST_INCIDENTS_DIR)).toThrow();
  });
});

describe('readIncidents', () => {
  beforeEach(() => {
    // Clean up test incidents directory
    if (existsSync(TEST_INCIDENTS_DIR)) {
      rmSync(TEST_INCIDENTS_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test incidents directory
    if (existsSync(TEST_INCIDENTS_DIR)) {
      rmSync(TEST_INCIDENTS_DIR, { recursive: true });
    }
  });

  it('should return empty array if no incidents directory exists', () => {
    const incidents = readIncidents();
    expect(incidents).toEqual([]);
  });

  it('should return empty array if incidents directory is empty', () => {
    mkdirSync(TEST_INCIDENTS_DIR, { recursive: true });

    const incidents = readIncidents();
    expect(incidents).toEqual([]);
  });

  it('should read incidents from all category files', () => {
    // Create test incidents in different categories
    const workflowIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Workflow issue',
      description: 'Workflow description',
      tags: [],
      context: {},
    };

    const toolingIncident = {
      timestamp: '2025-11-24T10:01:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1232',
      lane: 'Operations: Tooling',
      category: 'tooling',
      severity: 'major',
      title: 'Tooling issue',
      description: 'Tooling description',
      tags: [],
      context: {},
    };

    appendIncident(workflowIncident, TEST_INCIDENTS_DIR);
    appendIncident(toolingIncident, TEST_INCIDENTS_DIR);

    const incidents = readIncidents(null, null, TEST_INCIDENTS_DIR);
    expect(incidents).toHaveLength(2);
    expect(incidents[0]?.title).toBe('Tooling issue'); // Newest timestamp
    expect(incidents[1]?.title).toBe('Workflow issue');
  });

  it('should filter incidents by category', () => {
    const workflowIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Workflow issue',
      description: 'Workflow description',
      tags: [],
      context: {},
    };

    const toolingIncident = {
      timestamp: '2025-11-24T10:01:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1232',
      lane: 'Operations: Tooling',
      category: 'tooling',
      severity: 'major',
      title: 'Tooling issue',
      description: 'Tooling description',
      tags: [],
      context: {},
    };

    appendIncident(workflowIncident, TEST_INCIDENTS_DIR);
    appendIncident(toolingIncident, TEST_INCIDENTS_DIR);

    const workflowIncidents = readIncidents(['workflow'], null, TEST_INCIDENTS_DIR);
    expect(workflowIncidents).toHaveLength(1);
    expect(workflowIncidents[0]?.category).toBe('workflow');
  });

  it('should filter incidents by since date', () => {
    const oldIncident = {
      timestamp: '2025-11-20T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Old incident',
      description: 'Old description',
      tags: [],
      context: {},
    };

    const newIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1232',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'New incident',
      description: 'New description',
      tags: [],
      context: {},
    };

    appendIncident(oldIncident, TEST_INCIDENTS_DIR);
    appendIncident(newIncident, TEST_INCIDENTS_DIR);

    const since = new Date('2025-11-22T00:00:00.000Z');
    const recentIncidents = readIncidents(null, since, TEST_INCIDENTS_DIR);
    expect(recentIncidents).toHaveLength(1);
    expect(recentIncidents[0]?.title).toBe('New incident');
  });

  it('should skip malformed log entries', () => {
    // Create a category file with valid and invalid JSON lines
    const categoryFile = join(TEST_INCIDENTS_DIR, 'workflow.ndjson');
    mkdirSync(TEST_INCIDENTS_DIR, { recursive: true });

    const content = [
      '{"timestamp":"2025-11-24T10:00:00.000Z","session_id":"550e8400-e29b-41d4-a716-446655440000","wu_id":"WU-1231","lane":"Operations: Tooling","category":"workflow","severity":"minor","title":"Valid incident","description":"Valid description","tags":[],"context":{}}',
      'invalid json',
      '{"timestamp":"2025-11-24T10:01:00.000Z","session_id":"550e8400-e29b-41d4-a716-446655440000","wu_id":"WU-1232","lane":"Operations: Tooling","category":"workflow","severity":"minor","title":"Another valid incident","description":"Another valid description","tags":[],"context":{}}',
    ].join('\n');

    writeFileSync(categoryFile, content, 'utf8');

    const incidents = readIncidents(null, null, TEST_INCIDENTS_DIR);
    expect(incidents).toHaveLength(2);
    expect(incidents[0]?.title).toBe('Another valid incident'); // Newest timestamp
    expect(incidents[1]?.title).toBe('Valid incident');
  });

  it('should sort incidents by timestamp (newest first)', () => {
    const oldIncident = {
      timestamp: '2025-11-24T10:00:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1231',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'Old incident',
      description: 'Old description',
      tags: [],
      context: {},
    };

    const newIncident = {
      timestamp: '2025-11-24T10:01:00.000Z',
      session_id: '550e8400-e29b-41d4-a716-446655440000',
      wu_id: 'WU-1232',
      lane: 'Operations: Tooling',
      category: 'workflow',
      severity: 'minor',
      title: 'New incident',
      description: 'New description',
      tags: [],
      context: {},
    };

    appendIncident(oldIncident, TEST_INCIDENTS_DIR);
    appendIncident(newIncident, TEST_INCIDENTS_DIR);

    const incidents = readIncidents(null, null, TEST_INCIDENTS_DIR);
    expect(incidents).toHaveLength(2);
    expect(incidents[0]?.title).toBe('New incident'); // Newest first
    expect(incidents[1]?.title).toBe('Old incident');
  });
});
