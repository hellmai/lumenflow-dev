/**
 * Memory Index Core Tests (WU-1235)
 *
 * TDD: Tests for mem:index command that scans project
 * conventions and creates project-lifecycle summary nodes.
 *
 * @see {@link packages/@lumenflow/memory/src/mem-index-core.ts} - Implementation
 * @see {@link packages/@lumenflow/cli/src/mem-index.ts} - CLI wrapper
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { indexProject } from '../src/mem-index-core.js';

/** Test file path constants to avoid lint duplicate string warnings */
const TEST_FILES = {
  README: 'README.md',
  LUMENFLOW: 'LUMENFLOW.md',
  PACKAGE_JSON: 'package.json',
  CONFIG_YAML: '.lumenflow.config.yaml',
  CONSTRAINTS: '.lumenflow/constraints.md',
} as const;

/** Test content constants */
const TEST_CONTENT = {
  SIMPLE_README: '# Test\n\nContent.',
} as const;

describe('mem-index-core (WU-1235)', () => {
  let testDir: string;
  let memoryDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mem-index-test-'));
    memoryDir = path.join(testDir, '.lumenflow', 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /**
   * Helper to write a file in the test directory
   */
  async function writeFile(relativePath: string, content: string): Promise<void> {
    const filePath = path.join(testDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
  }

  /**
   * Helper to read memory.jsonl and return parsed nodes
   */
  async function readMemoryNodes(): Promise<unknown[]> {
    const filePath = path.join(memoryDir, 'memory.jsonl');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));
    } catch {
      return [];
    }
  }

  describe('source scanning', () => {
    it('scans README.md if present', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Test Project\n\nProject description here.');

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sourcesScanned).toContain(TEST_FILES.README);
    });

    it('scans LUMENFLOW.md if present', async () => {
      // Arrange
      await writeFile(TEST_FILES.LUMENFLOW, '# LumenFlow Guide\n\nWorkflow conventions.');

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sourcesScanned).toContain(TEST_FILES.LUMENFLOW);
    });

    it('scans package.json if present', async () => {
      // Arrange
      await writeFile(
        TEST_FILES.PACKAGE_JSON,
        JSON.stringify({
          name: 'test-project',
          workspaces: ['packages/*'],
        }),
      );

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sourcesScanned).toContain(TEST_FILES.PACKAGE_JSON);
    });

    it('scans .lumenflow.config.yaml if present', async () => {
      // Arrange
      await writeFile(
        TEST_FILES.CONFIG_YAML,
        'lanes:\n  definitions:\n    - name: Framework: Core\n',
      );

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sourcesScanned).toContain(TEST_FILES.CONFIG_YAML);
    });

    it('scans .lumenflow/constraints.md if present', async () => {
      // Arrange
      await writeFile(TEST_FILES.CONSTRAINTS, '# Constraints\n\nNon-negotiable rules.');

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.success).toBe(true);
      expect(result.sourcesScanned).toContain(TEST_FILES.CONSTRAINTS);
    });

    it('handles missing files gracefully', async () => {
      // Arrange - empty directory (no sources)

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.success).toBe(true);
      expect(result.nodesCreated).toBe(0);
      expect(result.nodesUpdated).toBe(0);
    });
  });

  describe('node creation', () => {
    it('creates memory nodes with lifecycle=project', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Test Project\n\nDescription.');

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      expect(nodes.length).toBeGreaterThan(0);
      expect((nodes[0] as { lifecycle: string }).lifecycle).toBe('project');
    });

    it('creates memory nodes with type=summary', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Test Project\n\nDescription.');

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      expect(nodes.length).toBeGreaterThan(0);
      expect((nodes[0] as { type: string }).type).toBe('summary');
    });

    it('creates nodes tagged with index:architecture for README', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Architecture\n\nProject structure.');

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      const readmeNode = nodes.find(
        (n) =>
          (n as { metadata?: { source_path?: string } }).metadata?.source_path ===
          TEST_FILES.README,
      );
      expect(readmeNode).toBeDefined();
      expect((readmeNode as { tags: string[] }).tags).toContain('index:architecture');
    });

    it('creates nodes tagged with index:conventions for LUMENFLOW.md', async () => {
      // Arrange
      await writeFile(TEST_FILES.LUMENFLOW, '# Workflow\n\nConventions.');

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      const lumenflowNode = nodes.find(
        (n) =>
          (n as { metadata?: { source_path?: string } }).metadata?.source_path ===
          TEST_FILES.LUMENFLOW,
      );
      expect(lumenflowNode).toBeDefined();
      expect((lumenflowNode as { tags: string[] }).tags).toContain('index:conventions');
    });

    it('creates nodes tagged with index:invariants for constraints.md', async () => {
      // Arrange
      await writeFile(TEST_FILES.CONSTRAINTS, '# Constraints\n\nRules.');

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      const constraintsNode = nodes.find(
        (n) =>
          (n as { metadata?: { source_path?: string } }).metadata?.source_path ===
          TEST_FILES.CONSTRAINTS,
      );
      expect(constraintsNode).toBeDefined();
      expect((constraintsNode as { tags: string[] }).tags).toContain('index:invariants');
    });
  });

  describe('provenance metadata', () => {
    it('includes source_path in metadata', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, TEST_CONTENT.SIMPLE_README);

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      expect(nodes.length).toBeGreaterThan(0);
      expect((nodes[0] as { metadata: { source_path: string } }).metadata.source_path).toBe(
        TEST_FILES.README,
      );
    });

    it('includes source_hash in metadata', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, TEST_CONTENT.SIMPLE_README);

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      expect(nodes.length).toBeGreaterThan(0);
      const metadata = (nodes[0] as { metadata: { source_hash: string } }).metadata;
      expect(metadata.source_hash).toBeDefined();
      expect(typeof metadata.source_hash).toBe('string');
      expect(metadata.source_hash.length).toBeGreaterThan(0);
    });

    it('includes indexed_at timestamp in metadata', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, TEST_CONTENT.SIMPLE_README);

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      expect(nodes.length).toBeGreaterThan(0);
      const metadata = (nodes[0] as { metadata: { indexed_at: string } }).metadata;
      expect(metadata.indexed_at).toBeDefined();
      // Should be a valid ISO 8601 date
      expect(() => new Date(metadata.indexed_at)).not.toThrow();
    });
  });

  describe('idempotency', () => {
    it('does not create duplicates on re-run', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, TEST_CONTENT.SIMPLE_README);

      // Act
      const result1 = await indexProject(testDir);
      const result2 = await indexProject(testDir);

      // Assert
      // Should have same number of nodes (no duplicates)
      expect(result1.nodesCreated).toBeGreaterThan(0);
      expect(result2.nodesCreated).toBe(0);
      expect(result2.nodesUpdated).toBe(0); // unchanged content, no update
    });

    it('updates existing node when source content changes', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Test\n\nOriginal content.');

      // Act
      const result1 = await indexProject(testDir);

      // Change the file content
      await writeFile(TEST_FILES.README, '# Test\n\nUpdated content.');
      const result2 = await indexProject(testDir);

      // Assert
      expect(result1.nodesCreated).toBeGreaterThan(0);
      expect(result2.nodesCreated).toBe(0);
      expect(result2.nodesUpdated).toBeGreaterThan(0);
    });

    it('skips unchanged sources', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, TEST_CONTENT.SIMPLE_README);

      // Act
      await indexProject(testDir);
      const result = await indexProject(testDir);

      // Assert
      expect(result.nodesSkipped).toBeGreaterThan(0);
    });
  });

  describe('result reporting', () => {
    it('returns count of nodes created', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, TEST_CONTENT.SIMPLE_README);
      await writeFile(TEST_FILES.LUMENFLOW, '# Workflow\n\nGuide.');

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.nodesCreated).toBe(2);
    });

    it('returns count of nodes updated', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Test\n\nOriginal.');
      await indexProject(testDir);

      // Change content
      await writeFile(TEST_FILES.README, '# Test\n\nChanged.');

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.nodesUpdated).toBe(1);
    });

    it('returns list of sources scanned', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Test');
      await writeFile(TEST_FILES.PACKAGE_JSON, '{"name": "test"}');

      // Act
      const result = await indexProject(testDir);

      // Assert
      expect(result.sourcesScanned).toContain(TEST_FILES.README);
      expect(result.sourcesScanned).toContain(TEST_FILES.PACKAGE_JSON);
    });
  });

  describe('dry-run mode', () => {
    it('does not write to memory file in dry-run mode', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, TEST_CONTENT.SIMPLE_README);

      // Act
      const result = await indexProject(testDir, { dryRun: true });

      // Assert
      expect(result.success).toBe(true);
      expect(result.nodesCreated).toBeGreaterThan(0);

      // Memory file should not exist
      const nodes = await readMemoryNodes();
      expect(nodes.length).toBe(0);
    });

    it('returns what would be indexed in dry-run mode', async () => {
      // Arrange
      await writeFile(TEST_FILES.README, '# Test');
      await writeFile(TEST_FILES.LUMENFLOW, '# Guide');

      // Act
      const result = await indexProject(testDir, { dryRun: true });

      // Assert
      expect(result.sourcesScanned.length).toBe(2);
      expect(result.nodesCreated).toBe(2);
    });
  });

  describe('content extraction', () => {
    it('extracts workspace structure from package.json', async () => {
      // Arrange
      await writeFile(
        TEST_FILES.PACKAGE_JSON,
        JSON.stringify({
          name: 'monorepo',
          workspaces: ['packages/*', 'apps/*'],
        }),
      );

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      const pkgNode = nodes.find(
        (n) =>
          (n as { metadata?: { source_path?: string } }).metadata?.source_path ===
          TEST_FILES.PACKAGE_JSON,
      );
      expect(pkgNode).toBeDefined();
      expect((pkgNode as { content: string }).content).toContain('Workspaces');
    });

    it('extracts lane definitions from .lumenflow.config.yaml', async () => {
      // Arrange
      const configContent = `
lanes:
  definitions:
    - name: "Framework: Core"
      code_paths:
        - "packages/@lumenflow/core/**"
    - name: "Framework: CLI"
      code_paths:
        - "packages/@lumenflow/cli/**"
`;
      await writeFile(TEST_FILES.CONFIG_YAML, configContent);

      // Act
      await indexProject(testDir);

      // Assert
      const nodes = await readMemoryNodes();
      const configNode = nodes.find(
        (n) =>
          (n as { metadata?: { source_path?: string } }).metadata?.source_path ===
          TEST_FILES.CONFIG_YAML,
      );
      expect(configNode).toBeDefined();
      expect((configNode as { tags: string[] }).tags).toContain('index:commands');
    });
  });
});
