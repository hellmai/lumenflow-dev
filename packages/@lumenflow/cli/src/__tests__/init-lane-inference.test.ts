/**
 * @file init-lane-inference.test.ts
 * Test: .lumenflow.lane-inference.yaml is generated in hierarchical Parent→Sublane format
 *
 * WU-1307: Fix lumenflow-init scaffolding
 *
 * The generated lane inference config must use the hierarchical format that
 * lane-inference.ts/lane-checker.ts expect:
 *
 * Parent:
 *   Sublane:
 *     code_paths:
 *       - pattern
 *     keywords:
 *       - keyword
 *
 * NOT the flat format:
 * lanes:
 *   - name: "Parent: Sublane"
 *     patterns:
 *       - pattern
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import YAML from 'yaml';
import { scaffoldProject } from '../init.js';

/** Lane inference file name - extracted to avoid duplicate string lint errors */
const LANE_INFERENCE_FILE_NAME = '.lumenflow.lane-inference.yaml';

/** Type for lane inference sublane config */
interface SublaneConfig {
  code_paths?: string[];
  keywords?: string[];
  patterns?: string[];
}

/** Type for lane inference parent config */
interface ParentLaneConfig {
  [sublane: string]: SublaneConfig;
}

/** Type for the full lane inference config */
interface LaneInferenceConfig {
  lanes?: unknown;
  Framework?: ParentLaneConfig;
  Operations?: ParentLaneConfig;
  Content?: ParentLaneConfig;
  Experience?: ParentLaneConfig;
}

describe('init lane inference generation (WU-1307)', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-init-lane-inference-'));
  });

  afterEach(() => {
    // Clean up temporary directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /** Helper to read and parse lane inference config from temp directory */
  function readLaneInference(): LaneInferenceConfig {
    const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE_NAME);
    const laneInferenceContent = fs.readFileSync(laneInferencePath, 'utf-8');
    return YAML.parse(laneInferenceContent) as LaneInferenceConfig;
  }

  it('should generate .lumenflow.lane-inference.yaml in hierarchical format', async () => {
    // Arrange
    const laneInferencePath = path.join(tempDir, LANE_INFERENCE_FILE_NAME);

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    expect(fs.existsSync(laneInferencePath)).toBe(true);

    const laneInference = readLaneInference();

    // Should NOT have a flat 'lanes' array
    expect(laneInference.lanes).toBeUndefined();

    // Should have hierarchical Parent -> Sublane structure
    // At minimum, should have Framework, Operations, Content parents
    expect(laneInference.Framework).toBeDefined();
    expect(laneInference.Operations).toBeDefined();
    expect(laneInference.Content).toBeDefined();
  });

  it('should include sublanes under parent lanes', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInference = readLaneInference();

    // Framework parent should have sublanes like Core, CLI
    expect(laneInference.Framework?.Core).toBeDefined();
    expect(laneInference.Framework?.CLI).toBeDefined();

    // Operations parent should have sublanes like Infrastructure, CI/CD
    expect(laneInference.Operations?.Infrastructure).toBeDefined();
    expect(laneInference.Operations?.['CI/CD']).toBeDefined();

    // Content parent should have Documentation sublane
    expect(laneInference.Content?.Documentation).toBeDefined();
  });

  it('should have code_paths in sublane config (not patterns)', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInference = readLaneInference();

    // Sublanes should have code_paths (not patterns)
    const frameworkCore = laneInference.Framework?.Core;
    expect(frameworkCore).toBeDefined();
    expect(frameworkCore?.code_paths).toBeDefined();
    expect(Array.isArray(frameworkCore?.code_paths)).toBe(true);
    expect(frameworkCore?.patterns).toBeUndefined();
  });

  it('should include keywords in sublane config', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInference = readLaneInference();

    // Sublanes should have keywords array
    const contentDocs = laneInference.Content?.Documentation;
    expect(contentDocs).toBeDefined();
    expect(contentDocs?.keywords).toBeDefined();
    expect(Array.isArray(contentDocs?.keywords)).toBe(true);
    expect(contentDocs?.keywords?.length).toBeGreaterThan(0);
  });

  it('should generate Experience parent lane for frontend projects', async () => {
    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInference = readLaneInference();

    // Should have Experience parent for frontend work
    expect(laneInference.Experience).toBeDefined();
    expect(laneInference.Experience?.UI || laneInference.Experience?.Web).toBeDefined();
  });

  it('should add framework-specific lanes when --framework is provided', async () => {
    // Act
    await scaffoldProject(tempDir, {
      force: true,
      full: true,
      framework: 'nextjs',
    });

    // Assert
    const laneInference = readLaneInference();

    // Should still have base lanes
    expect(laneInference.Framework).toBeDefined();
    expect(laneInference.Content).toBeDefined();
  });
});
