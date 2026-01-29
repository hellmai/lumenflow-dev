/**
 * lane-suggest-prompt Tests (WU-1189)
 *
 * Tests for the lane suggestion prompt generation module.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';

// Mock the fs module
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(),
  };
});

import {
  gatherProjectContext,
  generateSystemPrompt,
  generateUserPrompt,
  parseLLMResponse,
  isValidLaneFormat,
  getDefaultSuggestions,
  LaneSuggestResponseSchema,
  type ProjectContext,
} from '../lane-suggest-prompt.js';

// Test constants to avoid duplication
const LANE_FRAMEWORK_CORE = 'Framework: Core';
const LANE_OPS_CICD = 'Operations: CI/CD';
const CODE_PATH_CORE = 'packages/core/**';
const FILE_PACKAGE_JSON = 'package.json';

describe('lane-suggest-prompt', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateSystemPrompt', () => {
    it('should include lane format instructions', () => {
      const prompt = generateSystemPrompt();

      expect(prompt).toContain('Parent: Sublane');
      expect(prompt).toContain(LANE_FRAMEWORK_CORE);
      expect(prompt).toContain(LANE_OPS_CICD);
    });

    it('should request JSON response', () => {
      const prompt = generateSystemPrompt();

      expect(prompt).toContain('JSON');
      expect(prompt).toContain('suggestions');
    });

    it('should include required fields', () => {
      const prompt = generateSystemPrompt();

      expect(prompt).toContain('lane:');
      expect(prompt).toContain('description:');
      expect(prompt).toContain('rationale:');
      expect(prompt).toContain('code_paths:');
      expect(prompt).toContain('keywords:');
    });
  });

  describe('generateUserPrompt', () => {
    it('should include project type information', () => {
      const context: ProjectContext = {
        packageNames: [],
        directoryStructure: [],
        readme: null,
        packageJson: null,
        existingLanes: [],
        hasDocsDir: true,
        hasAppsDir: false,
        hasPackagesDir: true,
        isMonorepo: true,
      };

      const prompt = generateUserPrompt(context);

      expect(prompt).toContain('Monorepo: Yes');
      expect(prompt).toContain('Has docs/: Yes');
      expect(prompt).toContain('Has packages/: Yes');
    });

    it('should include package names', () => {
      const context: ProjectContext = {
        packageNames: ['@myorg/core', '@myorg/cli'],
        directoryStructure: [],
        readme: null,
        packageJson: null,
        existingLanes: [],
        hasDocsDir: false,
        hasAppsDir: false,
        hasPackagesDir: true,
        isMonorepo: true,
      };

      const prompt = generateUserPrompt(context);

      expect(prompt).toContain('@myorg/core');
      expect(prompt).toContain('@myorg/cli');
    });

    it('should include existing lanes for reference', () => {
      const context: ProjectContext = {
        packageNames: [],
        directoryStructure: [],
        readme: null,
        packageJson: null,
        existingLanes: [LANE_FRAMEWORK_CORE, LANE_OPS_CICD],
        hasDocsDir: false,
        hasAppsDir: false,
        hasPackagesDir: false,
        isMonorepo: false,
      };

      const prompt = generateUserPrompt(context);

      expect(prompt).toContain('Existing Lanes');
      expect(prompt).toContain(LANE_FRAMEWORK_CORE);
      expect(prompt).toContain(LANE_OPS_CICD);
    });

    it('should include README excerpt', () => {
      const context: ProjectContext = {
        packageNames: [],
        directoryStructure: [],
        readme: 'This is a workflow framework for AI development.',
        packageJson: null,
        existingLanes: [],
        hasDocsDir: false,
        hasAppsDir: false,
        hasPackagesDir: false,
        isMonorepo: false,
      };

      const prompt = generateUserPrompt(context);

      expect(prompt).toContain('README Excerpt');
      expect(prompt).toContain('workflow framework');
    });
  });

  describe('parseLLMResponse', () => {
    it('should parse valid JSON response', () => {
      const response = JSON.stringify({
        suggestions: [
          {
            lane: LANE_FRAMEWORK_CORE,
            description: 'Core library',
            rationale: 'Found core package',
            code_paths: [CODE_PATH_CORE],
            keywords: ['core', 'library'],
          },
        ],
      });

      const result = parseLLMResponse(response);

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].lane).toBe(LANE_FRAMEWORK_CORE);
    });

    it('should handle JSON with markdown code fences', () => {
      const response = `\`\`\`json
{
  "suggestions": [
    {
      "lane": "Framework: Core",
      "description": "Core lib",
      "rationale": "Found core",
      "code_paths": ["packages/core/**"],
      "keywords": ["core"]
    }
  ]
}
\`\`\``;

      const result = parseLLMResponse(response);

      expect(result.suggestions).toHaveLength(1);
    });

    it('should throw on invalid JSON', () => {
      const response = 'This is not valid JSON';

      expect(() => parseLLMResponse(response)).toThrow();
    });

    it('should validate response schema', () => {
      const response = JSON.stringify({
        suggestions: [
          {
            lane: LANE_FRAMEWORK_CORE,
            // Missing required fields
          },
        ],
      });

      expect(() => parseLLMResponse(response)).toThrow();
    });
  });

  describe('isValidLaneFormat', () => {
    it('should accept valid lane formats', () => {
      expect(isValidLaneFormat(LANE_FRAMEWORK_CORE)).toBe(true);
      expect(isValidLaneFormat(LANE_OPS_CICD)).toBe(true);
      expect(isValidLaneFormat('Content: Documentation')).toBe(true);
    });

    it('should reject invalid lane formats', () => {
      expect(isValidLaneFormat('framework-core')).toBe(false);
      expect(isValidLaneFormat('Core')).toBe(false);
      expect(isValidLaneFormat('framework: core')).toBe(false); // lowercase
      expect(isValidLaneFormat('')).toBe(false);
    });
  });

  describe('getDefaultSuggestions', () => {
    it('should suggest documentation lane when docs exist', () => {
      const context: ProjectContext = {
        packageNames: [],
        directoryStructure: ['docs'],
        readme: null,
        packageJson: null,
        existingLanes: [],
        hasDocsDir: true,
        hasAppsDir: false,
        hasPackagesDir: false,
        isMonorepo: false,
      };

      const suggestions = getDefaultSuggestions(context);

      const docsLane = suggestions.find((s) => s.lane === 'Content: Documentation');
      expect(docsLane).toBeDefined();
      expect(docsLane?.code_paths).toContain('docs/**');
    });

    it('should suggest lanes based on monorepo packages', () => {
      const context: ProjectContext = {
        packageNames: ['core', 'cli'],
        directoryStructure: ['packages'],
        readme: null,
        packageJson: null,
        existingLanes: [],
        hasDocsDir: false,
        hasAppsDir: false,
        hasPackagesDir: true,
        isMonorepo: true,
      };

      const suggestions = getDefaultSuggestions(context);

      expect(suggestions.some((s) => s.lane.includes('Core'))).toBe(true);
      expect(suggestions.some((s) => s.lane.includes('Cli'))).toBe(true);
    });

    it('should return default development lane for minimal projects', () => {
      const context: ProjectContext = {
        packageNames: [],
        directoryStructure: [],
        readme: null,
        packageJson: null,
        existingLanes: [],
        hasDocsDir: false,
        hasAppsDir: false,
        hasPackagesDir: false,
        isMonorepo: false,
      };

      const suggestions = getDefaultSuggestions(context);

      expect(suggestions.length).toBeGreaterThanOrEqual(1);
      expect(suggestions[0].lane).toBe('Development: Core');
    });
  });

  describe('LaneSuggestResponseSchema', () => {
    it('should validate correct response structure', () => {
      const validResponse = {
        suggestions: [
          {
            lane: LANE_FRAMEWORK_CORE,
            description: 'Core library',
            rationale: 'Contains shared utils',
            code_paths: [CODE_PATH_CORE],
            keywords: ['core', 'utils'],
          },
        ],
      };

      expect(() => LaneSuggestResponseSchema.parse(validResponse)).not.toThrow();
    });

    it('should reject missing required fields', () => {
      const invalidResponse = {
        suggestions: [
          {
            lane: LANE_FRAMEWORK_CORE,
            // Missing description, rationale, code_paths, keywords
          },
        ],
      };

      expect(() => LaneSuggestResponseSchema.parse(invalidResponse)).toThrow();
    });

    it('should accept multiple suggestions', () => {
      const response = {
        suggestions: [
          {
            lane: LANE_FRAMEWORK_CORE,
            description: 'Core',
            rationale: 'Core pkg',
            code_paths: [CODE_PATH_CORE],
            keywords: ['core'],
          },
          {
            lane: 'Framework: CLI',
            description: 'CLI',
            rationale: 'CLI pkg',
            code_paths: ['packages/cli/**'],
            keywords: ['cli'],
          },
        ],
      };

      const parsed = LaneSuggestResponseSchema.parse(response);
      expect(parsed.suggestions).toHaveLength(2);
    });
  });

  describe('gatherProjectContext (mocked)', () => {
    it('should handle empty project gracefully', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      const mockReaddirSync = vi.mocked(fs.readdirSync);

      mockExistsSync.mockReturnValue(false);
      mockReaddirSync.mockReturnValue([]);

      const context = gatherProjectContext('/nonexistent');

      expect(context.packageNames).toHaveLength(0);
      expect(context.readme).toBeNull();
      expect(context.isMonorepo).toBe(false);
    });

    it('should detect monorepo via package.json workspaces', () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      const mockReadFileSync = vi.mocked(fs.readFileSync);
      const mockReaddirSync = vi.mocked(fs.readdirSync);

      mockExistsSync.mockImplementation((p: fs.PathLike) => {
        const pathStr = String(p);
        return pathStr.endsWith(FILE_PACKAGE_JSON);
      });

      mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
        const pathStr = String(p);
        if (pathStr.endsWith(FILE_PACKAGE_JSON)) {
          return JSON.stringify({
            name: 'test-project',
            workspaces: ['packages/*'],
          });
        }
        return '';
      });

      mockReaddirSync.mockReturnValue([]);

      const context = gatherProjectContext('/test');

      expect(context.isMonorepo).toBe(true);
      expect(context.packageJson?.workspaces).toContain('packages/*');
    });
  });
});
