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

  it('should generate .lumenflow.config.yaml with lanes.definitions', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    expect(fs.existsSync(configPath)).toBe(true);

    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    // Should have lanes.definitions
    expect(config.lanes).toBeDefined();
    expect(config.lanes.definitions).toBeDefined();
    expect(Array.isArray(config.lanes.definitions)).toBe(true);
  });

  it('should include Framework parent lane with sublanes', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const lanes = config.lanes?.definitions || [];
    const frameworkLanes = lanes.filter((l: { name: string }) => l.name.startsWith('Framework:'));

    expect(frameworkLanes.length).toBeGreaterThan(0);

    // Should have at least Framework: Core and Framework: CLI
    const laneNames = frameworkLanes.map((l: { name: string }) => l.name);
    expect(laneNames).toContain('Framework: Core');
    expect(laneNames).toContain('Framework: CLI');
  });

  it('should include Experience parent lane for frontend work', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const lanes = config.lanes?.definitions || [];
    const experienceLanes = lanes.filter((l: { name: string }) => l.name.startsWith('Experience:'));

    // Should have at least one Experience lane
    expect(experienceLanes.length).toBeGreaterThan(0);
  });

  it('should include Content: Documentation lane', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const lanes = config.lanes?.definitions || [];
    const contentLane = lanes.find((l: { name: string }) => l.name === 'Content: Documentation');

    expect(contentLane).toBeDefined();
    expect(contentLane.code_paths).toBeDefined();
    expect(contentLane.code_paths).toContain('docs/**');
  });

  it('should include Operations parent lanes', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const lanes = config.lanes?.definitions || [];
    const operationsLanes = lanes.filter((l: { name: string }) => l.name.startsWith('Operations:'));

    expect(operationsLanes.length).toBeGreaterThan(0);

    // Should have Infrastructure and CI/CD
    const laneNames = operationsLanes.map((l: { name: string }) => l.name);
    expect(laneNames).toContain('Operations: Infrastructure');
    expect(laneNames).toContain('Operations: CI/CD');
  });

  it('should have wip_limit: 1 for code lanes by default', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const lanes = config.lanes?.definitions || [];
    const frameworkCore = lanes.find((l: { name: string }) => l.name === 'Framework: Core');

    expect(frameworkCore).toBeDefined();
    expect(frameworkCore.wip_limit).toBe(1);
  });

  it('should have code_paths for each lane', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const lanes = config.lanes?.definitions || [];

    // Every lane should have code_paths
    for (const lane of lanes) {
      expect(lane.code_paths).toBeDefined();
      expect(Array.isArray(lane.code_paths)).toBe(true);
      expect(lane.code_paths.length).toBeGreaterThan(0);
    }
  });

  it('should use "Parent: Sublane" format for lane names', async () => {
    // Arrange
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');

    // Act
    await scaffoldProject(tempDir, { force: true, full: true });

    // Assert
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = YAML.parse(configContent);

    const lanes = config.lanes?.definitions || [];

    // All lanes should follow "Parent: Sublane" format (colon + space)
    for (const lane of lanes) {
      expect(lane.name).toMatch(/^[A-Z][a-z]+: [A-Z]/);
    }
  });
});
