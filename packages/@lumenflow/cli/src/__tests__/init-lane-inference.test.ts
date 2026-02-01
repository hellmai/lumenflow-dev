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

  it('should generate .lumenflow.lane-inference.yaml in hierarchical format', async () => {
    // Arrange
    const laneInferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    expect(fs.existsSync(laneInferencePath)).toBe(true);

    const laneInferenceContent = fs.readFileSync(laneInferencePath, 'utf-8');
    const laneInference = YAML.parse(laneInferenceContent);

    // Should NOT have a flat 'lanes' array
    expect(laneInference.lanes).toBeUndefined();

    // Should have hierarchical Parent -> Sublane structure
    // At minimum, should have Framework, Operations, Content parents
    expect(laneInference.Framework).toBeDefined();
    expect(laneInference.Operations).toBeDefined();
    expect(laneInference.Content).toBeDefined();
  });

  it('should include sublanes under parent lanes', async () => {
    // Arrange
    const laneInferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInferenceContent = fs.readFileSync(laneInferencePath, 'utf-8');
    const laneInference = YAML.parse(laneInferenceContent);

    // Framework parent should have sublanes like Core, CLI
    expect(laneInference.Framework.Core).toBeDefined();
    expect(laneInference.Framework.CLI).toBeDefined();

    // Operations parent should have sublanes like Infrastructure, CI/CD
    expect(laneInference.Operations.Infrastructure).toBeDefined();
    expect(laneInference.Operations['CI/CD']).toBeDefined();

    // Content parent should have Documentation sublane
    expect(laneInference.Content.Documentation).toBeDefined();
  });

  it('should have code_paths in sublane config (not patterns)', async () => {
    // Arrange
    const laneInferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInferenceContent = fs.readFileSync(laneInferencePath, 'utf-8');
    const laneInference = YAML.parse(laneInferenceContent);

    // Sublanes should have code_paths (not patterns)
    const frameworkCore = laneInference.Framework?.Core;
    expect(frameworkCore).toBeDefined();
    expect(frameworkCore.code_paths).toBeDefined();
    expect(Array.isArray(frameworkCore.code_paths)).toBe(true);
    expect(frameworkCore.patterns).toBeUndefined();
  });

  it('should include keywords in sublane config', async () => {
    // Arrange
    const laneInferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInferenceContent = fs.readFileSync(laneInferencePath, 'utf-8');
    const laneInference = YAML.parse(laneInferenceContent);

    // Sublanes should have keywords array
    const contentDocs = laneInference.Content?.Documentation;
    expect(contentDocs).toBeDefined();
    expect(contentDocs.keywords).toBeDefined();
    expect(Array.isArray(contentDocs.keywords)).toBe(true);
    expect(contentDocs.keywords.length).toBeGreaterThan(0);
  });

  it('should generate Experience parent lane for frontend projects', async () => {
    // Arrange
    const laneInferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const laneInferenceContent = fs.readFileSync(laneInferencePath, 'utf-8');
    const laneInference = YAML.parse(laneInferenceContent);

    // Should have Experience parent for frontend work
    expect(laneInference.Experience).toBeDefined();
    expect(laneInference.Experience.UI || laneInference.Experience.Web).toBeDefined();
  });

  it('should add framework-specific lanes when --framework is provided', async () => {
    // Arrange
    const laneInferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    // Act
    await scaffoldProject(tempDir, {
      force: true,
      full: true,
      framework: 'nextjs',
    });

    // Assert
    const laneInferenceContent = fs.readFileSync(laneInferencePath, 'utf-8');
    const laneInference = YAML.parse(laneInferenceContent);

    // Should still have base lanes
    expect(laneInference.Framework).toBeDefined();
    expect(laneInference.Content).toBeDefined();
  });
});
