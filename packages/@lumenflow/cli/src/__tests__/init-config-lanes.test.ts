/**
 * @file init-config-lanes.test.ts
 * Test: .lumenflow.config.yaml includes default lane definitions for parent lanes
 *
 * WU-1307: Fix lumenflow-init scaffolding
 *
 * The generated config must include lane definitions that match the parent
 * lanes used in the documentation examples (Framework, Experience, Content, Operations).
 * These lanes should have sensible defaults for code_paths and wip_limit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { scaffoldProject } from '../init.js';

/** Config file name - extracted to avoid duplicate string lint errors */
const CONFIG_FILE_NAME = '.lumenflow.config.yaml';

describe('init config default lanes (WU-1307)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-config-lanes-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read and parse config from temp directory */
  function readConfig(): Record<string, unknown> {
    const configPath = path.join(tempDir, CONFIG_FILE_NAME);
    const configContent = fs.readFileSync(configPath, 'utf-8');
    return YAML.parse(configContent) as Record<string, unknown>;
  }

  it('should generate .lumenflow.config.yaml with lanes.definitions', async () => {
    // Arrange
    const configPath = path.join(tempDir, CONFIG_FILE_NAME);

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    expect(fs.existsSync(configPath)).toBe(true);

    const config = readConfig();

    // Should have lanes.definitions
    expect(config.lanes).toBeDefined();
    expect((config.lanes as Record<string, unknown>).definitions).toBeDefined();
    expect(Array.isArray((config.lanes as Record<string, unknown>).definitions)).toBe(true);
  });

  it('should include Framework parent lane with sublanes', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();

    const lanes = ((config.lanes as Record<string, unknown>)?.definitions || []) as Array<{
      name: string;
    }>;
    const frameworkLanes = lanes.filter((l) => l.name.startsWith('Framework:'));

    expect(frameworkLanes.length).toBeGreaterThan(0);

    // Should have at least Framework: Core and Framework: CLI
    const laneNames = frameworkLanes.map((l) => l.name);
    expect(laneNames).toContain('Framework: Core');
    expect(laneNames).toContain('Framework: CLI');
  });

  it('should include Experience parent lane for frontend work', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();

    const lanes = ((config.lanes as Record<string, unknown>)?.definitions || []) as Array<{
      name: string;
    }>;
    const experienceLanes = lanes.filter((l) => l.name.startsWith('Experience:'));

    // Should have at least one Experience lane
    expect(experienceLanes.length).toBeGreaterThan(0);
  });

  it('should include Content: Documentation lane', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();

    const lanes = ((config.lanes as Record<string, unknown>)?.definitions || []) as Array<{
      name: string;
      code_paths?: string[];
    }>;
    const contentLane = lanes.find((l) => l.name === 'Content: Documentation');

    expect(contentLane).toBeDefined();
    expect(contentLane?.code_paths).toBeDefined();
    expect(contentLane?.code_paths).toContain('docs/**');
  });

  it('should include Operations parent lanes', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();

    const lanes = ((config.lanes as Record<string, unknown>)?.definitions || []) as Array<{
      name: string;
    }>;
    const operationsLanes = lanes.filter((l) => l.name.startsWith('Operations:'));

    expect(operationsLanes.length).toBeGreaterThan(0);

    // Should have Infrastructure and CI/CD
    const laneNames = operationsLanes.map((l) => l.name);
    expect(laneNames).toContain('Operations: Infrastructure');
    expect(laneNames).toContain('Operations: CI/CD');
  });

  it('should have wip_limit: 1 for code lanes by default', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();

    const lanes = ((config.lanes as Record<string, unknown>)?.definitions || []) as Array<{
      name: string;
      wip_limit?: number;
    }>;
    const frameworkCore = lanes.find((l) => l.name === 'Framework: Core');

    expect(frameworkCore).toBeDefined();
    expect(frameworkCore?.wip_limit).toBe(1);
  });

  it('should have code_paths for each lane', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();

    const lanes = ((config.lanes as Record<string, unknown>)?.definitions || []) as Array<{
      name: string;
      code_paths?: string[];
    }>;

    // Every lane should have code_paths
    for (const lane of lanes) {
      expect(lane.code_paths).toBeDefined();
      expect(Array.isArray(lane.code_paths)).toBe(true);
      expect(lane.code_paths?.length).toBeGreaterThan(0);
    }
  });

  it('should use "Parent: Sublane" format for lane names', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const config = readConfig();

    const lanes = ((config.lanes as Record<string, unknown>)?.definitions || []) as Array<{
      name: string;
    }>;

    // All lanes should follow "Parent: Sublane" format (colon + space)
    for (const lane of lanes) {
      expect(lane.name).toMatch(/^[A-Z][a-z]+: [A-Z]/);
    }
  });
});

/** WU template file name - extracted to avoid duplicate string lint errors */
const WU_TEMPLATE_FILE_NAME = 'wu-template.yaml';

describe('init WU template lane neutrality (WU-1499)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-wu-template-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read the generated WU template YAML as raw text */
  function readWuTemplate(): string {
    // The template is scaffolded under the docs tasks path templates dir.
    // With arc42 (default), that is docs/04-operations/tasks/templates/wu-template.yaml
    const templatePath = path.join(
      tempDir,
      'docs',
      '04-operations',
      'tasks',
      'templates',
      WU_TEMPLATE_FILE_NAME,
    );
    if (!fs.existsSync(templatePath)) {
      // Try simple docs structure fallback
      const simplePath = path.join(tempDir, 'docs', 'tasks', 'templates', WU_TEMPLATE_FILE_NAME);
      return fs.readFileSync(simplePath, 'utf-8');
    }
    return fs.readFileSync(templatePath, 'utf-8');
  }

  /** Helper to parse the generated WU template YAML */
  function parseWuTemplate(): Record<string, unknown> {
    return YAML.parse(readWuTemplate()) as Record<string, unknown>;
  }

  it('should NOT hardcode "Framework: CLI" as the default lane value', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const template = parseWuTemplate();
    expect(template.lane).not.toBe('Framework: CLI');
  });

  it('should use a neutral placeholder lane value that requires explicit selection', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const template = parseWuTemplate();
    const laneValue = template.lane as string;

    // The placeholder should indicate it needs to be replaced (angle brackets or similar)
    // It should NOT be UnsafeAny specific real lane
    expect(laneValue).toContain('<');
    expect(laneValue).toContain('>');
    // Should demonstrate the Parent: Sublane format
    expect(laneValue).toContain(':');
  });

  it('should include the lane format pattern in the raw template', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const rawTemplate = readWuTemplate();

    // The raw template should contain the lane field with a placeholder
    expect(rawTemplate).toContain("lane: '<Parent: Sublane>'");
    // Should NOT contain the biased default
    expect(rawTemplate).not.toContain("lane: 'Framework: CLI'");
  });
});
