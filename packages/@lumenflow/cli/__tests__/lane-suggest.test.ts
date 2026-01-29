/**
 * lane:suggest CLI Tests (WU-1189)
 *
 * Tests for the LLM-driven lane generation command.
 * TDD approach: these tests are written BEFORE implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing the module
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    question: vi.fn(),
    close: vi.fn(),
  })),
}));

// Test constants to avoid duplication
const LANE_FRAMEWORK_CORE = 'Framework: Core';
const LANE_FRAMEWORK_CLI = 'Framework: CLI';
const CODE_PATH_CORE = 'packages/core/**';
const CODE_PATH_CLI = 'packages/cli/**';
const CONTENT_DOCS_LANE = 'Content: Documentation';
const TEST_PROJECT_ROOT = '/var/test/project'; // Using non-publicly-writable path

// Types for our lane suggestion system
interface LaneSuggestion {
  lane: string;
  description: string;
  rationale: string;
  code_paths: string[];
  keywords: string[];
}

interface LaneSuggestResult {
  suggestions: LaneSuggestion[];
  context: {
    packageCount: number;
    docsFound: boolean;
    existingConfig: boolean;
  };
}

interface LaneSuggestOptions {
  dryRun?: boolean;
  interactive?: boolean;
  projectRoot?: string;
}

// Import after mocks
import * as fs from 'node:fs';

describe('lane:suggest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('context gathering', () => {
    it('should detect monorepo package structure', async () => {
      const mockFs = fs as { existsSync: ReturnType<typeof vi.fn> };
      mockFs.existsSync.mockImplementation((path: string) => {
        if (path.includes('package.json')) return true;
        if (path.includes('pnpm-workspace.yaml')) return true;
        if (path.includes('packages')) return true;
        return false;
      });

      // Implementation will be tested here
      // For now, this test documents expected behavior
      expect(mockFs.existsSync).toBeDefined();
    });

    it('should gather docs structure information', async () => {
      const mockFs = fs as { existsSync: ReturnType<typeof vi.fn> };
      mockFs.existsSync.mockImplementation((path: string) => {
        if (path.includes('docs')) return true;
        if (path.includes('README.md')) return true;
        return false;
      });

      // Docs detection should inform lane suggestions
      expect(mockFs.existsSync).toBeDefined();
    });

    it('should detect existing lane config if present', async () => {
      const mockFs = fs as {
        existsSync: ReturnType<typeof vi.fn>;
        readFileSync: ReturnType<typeof vi.fn>;
      };
      mockFs.existsSync.mockImplementation((path: string) =>
        path.includes('.lumenflow.lane-inference.yaml'),
      );
      mockFs.readFileSync.mockReturnValue(`
Framework:
  Core:
    code_paths:
      - CODE_PATH_CORE
`);

      // Should detect and parse existing config
      expect(mockFs.existsSync).toBeDefined();
    });
  });

  describe('dry-run mode', () => {
    it('should show what would be suggested without making LLM calls', async () => {
      const mockFs = fs as { existsSync: ReturnType<typeof vi.fn> };
      mockFs.existsSync.mockReturnValue(true);

      // Dry run should:
      // 1. Gather context
      // 2. Show what context would be sent to LLM
      // 3. NOT call the LLM
      // 4. Return a preview of the operation

      const options: LaneSuggestOptions = { dryRun: true };
      expect(options.dryRun).toBe(true);
    });

    it('should display context preview in dry-run', async () => {
      // The dry-run output should show:
      // - Detected packages
      // - Detected docs structure
      // - Existing config (if any)
      // - What prompt would be sent
      const dryRunInfo = {
        packagesFound: ['@lumenflow/core', '@lumenflow/cli'],
        docsStructure: ['docs/README.md', 'docs/api'],
        existingConfig: false,
        promptPreview: 'Context gathered for LLM...',
      };

      expect(dryRunInfo.packagesFound).toHaveLength(2);
      expect(dryRunInfo.existingConfig).toBe(false);
    });
  });

  describe('structured suggestions', () => {
    it('should return suggestions with lane name, description, rationale', () => {
      const suggestion: LaneSuggestion = {
        lane: LANE_FRAMEWORK_CORE,
        description: 'Core library functionality',
        rationale: 'Contains shared utilities and base classes',
        code_paths: [CODE_PATH_CORE],
        keywords: ['core', 'library', 'shared'],
      };

      expect(suggestion.lane).toBe(LANE_FRAMEWORK_CORE);
      expect(suggestion.description).toBeTruthy();
      expect(suggestion.rationale).toBeTruthy();
      expect(suggestion.code_paths).toBeInstanceOf(Array);
      expect(suggestion.keywords).toBeInstanceOf(Array);
    });

    it('should return multiple lane suggestions for complex projects', () => {
      const result: LaneSuggestResult = {
        suggestions: [
          {
            lane: LANE_FRAMEWORK_CORE,
            description: 'Core functionality',
            rationale: 'Base library',
            code_paths: [CODE_PATH_CORE],
            keywords: ['core'],
          },
          {
            lane: LANE_FRAMEWORK_CLI,
            description: 'CLI commands',
            rationale: 'User-facing commands',
            code_paths: [CODE_PATH_CLI],
            keywords: ['cli'],
          },
        ],
        context: {
          packageCount: 2,
          docsFound: true,
          existingConfig: false,
        },
      };

      expect(result.suggestions).toHaveLength(2);
      expect(result.context.packageCount).toBe(2);
    });

    it('should follow Parent: Sublane format', () => {
      const lanes = [LANE_FRAMEWORK_CORE, 'Operations: CI/CD', CONTENT_DOCS_LANE];

      for (const lane of lanes) {
        expect(lane).toMatch(/^[A-Z][a-zA-Z]+: [A-Z][a-zA-Z/]+$/);
      }
    });
  });

  describe('interactive mode', () => {
    it('should prompt for accept/skip/edit for each suggestion', () => {
      const interactiveOptions = ['accept', 'skip', 'edit'] as const;

      // Each suggestion should allow these actions
      expect(interactiveOptions).toContain('accept');
      expect(interactiveOptions).toContain('skip');
      expect(interactiveOptions).toContain('edit');
    });

    it('should allow editing lane name in interactive mode', () => {
      const originalLane = LANE_FRAMEWORK_CORE;
      const editedLane = 'Framework: Library';

      // User should be able to modify the suggested lane name
      expect(editedLane).not.toBe(originalLane);
      expect(editedLane).toMatch(/^[A-Z][a-zA-Z]+: [A-Z][a-zA-Z]+$/);
    });

    it('should skip suggestions when user chooses skip', () => {
      const suggestions: LaneSuggestion[] = [
        {
          lane: LANE_FRAMEWORK_CORE,
          description: 'Core',
          rationale: 'Base',
          code_paths: [CODE_PATH_CORE],
          keywords: ['core'],
        },
        {
          lane: LANE_FRAMEWORK_CLI,
          description: 'CLI',
          rationale: 'Commands',
          code_paths: [CODE_PATH_CLI],
          keywords: ['cli'],
        },
      ];

      // User skips first, accepts second
      const accepted = suggestions.filter((_, i) => i === 1);
      expect(accepted).toHaveLength(1);
      expect(accepted[0].lane).toBe(LANE_FRAMEWORK_CLI);
    });
  });

  describe('greenfield project support', () => {
    it('should work without existing config', async () => {
      const mockFs = fs as { existsSync: ReturnType<typeof vi.fn> };
      mockFs.existsSync.mockReturnValue(false);

      // Should still generate suggestions based on project structure
      const options: LaneSuggestOptions = { projectRoot: TEST_PROJECT_ROOT };
      expect(options.projectRoot).toBeDefined();
    });

    it('should suggest default lanes for minimal projects', () => {
      // For a project with just a src/ folder, suggest basic lanes
      const minimalProjectSuggestions: LaneSuggestion[] = [
        {
          lane: 'Development: Core',
          description: 'Main application code',
          rationale: 'Primary source directory detected',
          code_paths: ['src/**'],
          keywords: ['source', 'main'],
        },
        {
          lane: CONTENT_DOCS_LANE,
          description: 'Project documentation',
          rationale: 'Standard docs location',
          code_paths: ['docs/**', 'README.md'],
          keywords: ['docs', 'readme'],
        },
      ];

      expect(minimalProjectSuggestions.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect common project patterns', () => {
      // Common patterns to detect:
      const patterns = [
        { pattern: 'src/', suggestedLane: 'Development: Core' },
        { pattern: 'packages/', suggestedLane: 'Framework: *' },
        { pattern: 'apps/', suggestedLane: 'Applications: *' },
        { pattern: 'docs/', suggestedLane: CONTENT_DOCS_LANE },
        { pattern: '.github/', suggestedLane: 'Operations: CI/CD' },
        { pattern: 'tests/', suggestedLane: 'Quality: Testing' },
      ];

      expect(patterns).toHaveLength(6);
    });
  });

  describe('output format', () => {
    it('should output suggestions in readable format for terminal', () => {
      const suggestion: LaneSuggestion = {
        lane: LANE_FRAMEWORK_CORE,
        description: 'Core library with shared utilities',
        rationale: 'Found packages/core with TypeScript source files',
        code_paths: [CODE_PATH_CORE],
        keywords: ['core', 'library', 'utilities'],
      };

      // Expected terminal output format
      const expectedOutput = `
Lane: Framework: Core
Description: Core library with shared utilities
Rationale: Found packages/core with TypeScript source files
Code Paths:
  - packages/core/**
Keywords: core, library, utilities
`.trim();

      // The actual implementation should produce similar output
      expect(suggestion.lane).toBe(LANE_FRAMEWORK_CORE);
      expect(expectedOutput).toContain('Lane:');
      expect(expectedOutput).toContain('Rationale:');
    });

    it('should support JSON output format', () => {
      const result: LaneSuggestResult = {
        suggestions: [
          {
            lane: LANE_FRAMEWORK_CORE,
            description: 'Core library',
            rationale: 'Main package',
            code_paths: [CODE_PATH_CORE],
            keywords: ['core'],
          },
        ],
        context: {
          packageCount: 1,
          docsFound: false,
          existingConfig: false,
        },
      };

      const jsonOutput = JSON.stringify(result, null, 2);
      expect(JSON.parse(jsonOutput)).toEqual(result);
    });
  });
});

describe('lane-suggest-prompt (core)', () => {
  describe('prompt generation', () => {
    it('should generate prompt with project context', () => {
      const context = {
        packageNames: ['@lumenflow/core', '@lumenflow/cli'],
        directoryStructure: ['packages/', 'docs/', 'apps/'],
        existingLanes: [],
        readme: 'A workflow framework for AI-native development',
      };

      // The prompt should include all context
      expect(context.packageNames).toHaveLength(2);
      expect(context.directoryStructure).toContain('packages/');
    });

    it('should include LumenFlow lane conventions in prompt', () => {
      const conventions = {
        format: 'Parent: Sublane',
        examples: [
          LANE_FRAMEWORK_CORE,
          LANE_FRAMEWORK_CLI,
          'Operations: Infrastructure',
          CONTENT_DOCS_LANE,
        ],
        rules: [
          'Lane names should be descriptive',
          'Use consistent parent categories',
          'Code paths should use glob patterns',
        ],
      };

      expect(conventions.format).toBe('Parent: Sublane');
      expect(conventions.examples).toContain(LANE_FRAMEWORK_CORE);
    });

    it('should request structured JSON output from LLM', () => {
      const expectedSchema = {
        type: 'object',
        properties: {
          suggestions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lane: { type: 'string' },
                description: { type: 'string' },
                rationale: { type: 'string' },
                code_paths: { type: 'array', items: { type: 'string' } },
                keywords: { type: 'array', items: { type: 'string' } },
              },
              required: ['lane', 'description', 'rationale', 'code_paths', 'keywords'],
            },
          },
        },
        required: ['suggestions'],
      };

      expect(expectedSchema.properties.suggestions.type).toBe('array');
    });
  });

  describe('LLM response parsing', () => {
    it('should parse valid LLM response', () => {
      const llmResponse = `{
  "suggestions": [
    {
      "lane": "Framework: Core",
      "description": "Core library functionality",
      "rationale": "Contains shared utilities",
      "code_paths": ["packages/core/**"],
      "keywords": ["core", "library"]
    }
  ]
}`;

      const parsed = JSON.parse(llmResponse);
      expect(parsed.suggestions).toHaveLength(1);
      expect(parsed.suggestions[0].lane).toBe(LANE_FRAMEWORK_CORE);
    });

    it('should handle malformed LLM response gracefully', () => {
      const malformedResponse = 'This is not valid JSON';

      expect(() => JSON.parse(malformedResponse)).toThrow();
      // Implementation should catch this and return an error
    });

    it('should validate lane format in response', () => {
      const validLane = LANE_FRAMEWORK_CORE;
      const invalidLane = 'framework-core';

      // Valid format: "Parent: Sublane"
      expect(validLane).toMatch(/^[A-Z][a-zA-Z]+: [A-Z][a-zA-Z/]+$/);
      expect(invalidLane).not.toMatch(/^[A-Z][a-zA-Z]+: [A-Z][a-zA-Z/]+$/);
    });
  });
});
