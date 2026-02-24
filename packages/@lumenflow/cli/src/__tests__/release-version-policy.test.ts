// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for version-policy.yaml integration in release command
 *
 * WU-2107: Wire version-policy.yaml into pnpm release and bump to 3.4.0
 *
 * Verifies that the release command:
 * - Bumps published_stable.version to the release version
 * - Bumps published_stable.release_tag to vX.Y.Z
 * - Updates published_stable.validated_on to current date
 * - Preserves all other fields in the YAML
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { updateVersionPolicy, VERSION_POLICY_RELATIVE_PATH } from '../release.js';

/** Sample version-policy.yaml content matching real file structure */
const SAMPLE_VERSION_POLICY = `version: 1
published_stable:
  version: 3.3.0
  release_tag: v3.3.0
  source_of_truth:
    npm: https://www.npmjs.com/package/@lumenflow/cli
    github_releases: https://github.com/hellmai/lumenflow-dev/releases
  validated_on: 2026-02-20
policy:
  latest_channel: published_stable
  allow_unreleased_main_claims: false
  note: User-facing docs must describe published stable as latest.
`;

describe('WU-2107: version-policy.yaml release integration', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `release-version-policy-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('exports VERSION_POLICY_RELATIVE_PATH constant', () => {
    expect(VERSION_POLICY_RELATIVE_PATH).toBe('apps/docs/src/data/version-policy.yaml');
  });

  it('bumps published_stable.version to the release version', async () => {
    const policyDir = join(testDir, 'apps', 'docs', 'src', 'data');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(join(policyDir, 'version-policy.yaml'), SAMPLE_VERSION_POLICY);

    await updateVersionPolicy('4.0.0', testDir);

    const content = readFileSync(join(policyDir, 'version-policy.yaml'), 'utf-8');
    expect(content).toContain('version: 4.0.0');
    // The top-level 'version: 1' must still be present
    expect(content).toMatch(/^version: 1/m);
  });

  it('bumps published_stable.release_tag to vX.Y.Z', async () => {
    const policyDir = join(testDir, 'apps', 'docs', 'src', 'data');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(join(policyDir, 'version-policy.yaml'), SAMPLE_VERSION_POLICY);

    await updateVersionPolicy('4.0.0', testDir);

    const content = readFileSync(join(policyDir, 'version-policy.yaml'), 'utf-8');
    expect(content).toContain('release_tag: v4.0.0');
  });

  it('updates published_stable.validated_on to current date', async () => {
    const policyDir = join(testDir, 'apps', 'docs', 'src', 'data');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(join(policyDir, 'version-policy.yaml'), SAMPLE_VERSION_POLICY);

    await updateVersionPolicy('4.0.0', testDir);

    const content = readFileSync(join(policyDir, 'version-policy.yaml'), 'utf-8');
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    expect(content).toContain(`validated_on: ${today}`);
  });

  it('preserves all other fields (source_of_truth, policy block)', async () => {
    const policyDir = join(testDir, 'apps', 'docs', 'src', 'data');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(join(policyDir, 'version-policy.yaml'), SAMPLE_VERSION_POLICY);

    await updateVersionPolicy('4.0.0', testDir);

    const content = readFileSync(join(policyDir, 'version-policy.yaml'), 'utf-8');
    expect(content).toContain('npm: https://www.npmjs.com/package/@lumenflow/cli');
    expect(content).toContain('github_releases: https://github.com/hellmai/lumenflow-dev/releases');
    expect(content).toContain('latest_channel: published_stable');
    expect(content).toContain('allow_unreleased_main_claims: false');
    expect(content).toContain('note: User-facing docs must describe published stable as latest.');
  });

  it('handles pre-release versions correctly', async () => {
    const policyDir = join(testDir, 'apps', 'docs', 'src', 'data');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(join(policyDir, 'version-policy.yaml'), SAMPLE_VERSION_POLICY);

    await updateVersionPolicy('5.0.0-beta.1', testDir);

    const content = readFileSync(join(policyDir, 'version-policy.yaml'), 'utf-8');
    expect(content).toContain('version: 5.0.0-beta.1');
    expect(content).toContain('release_tag: v5.0.0-beta.1');
  });

  it('returns the absolute path of the updated file', async () => {
    const policyDir = join(testDir, 'apps', 'docs', 'src', 'data');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(join(policyDir, 'version-policy.yaml'), SAMPLE_VERSION_POLICY);

    const result = await updateVersionPolicy('4.0.0', testDir);

    expect(result).toBe(join(policyDir, 'version-policy.yaml'));
  });

  it('silently skips when version-policy.yaml does not exist', async () => {
    // No version-policy.yaml created in testDir
    const result = await updateVersionPolicy('4.0.0', testDir);

    expect(result).toBeNull();
  });

  it('preserves YAML structure (top-level version key is not overwritten)', async () => {
    const policyDir = join(testDir, 'apps', 'docs', 'src', 'data');
    mkdirSync(policyDir, { recursive: true });
    writeFileSync(join(policyDir, 'version-policy.yaml'), SAMPLE_VERSION_POLICY);

    await updateVersionPolicy('9.9.9', testDir);

    const content = readFileSync(join(policyDir, 'version-policy.yaml'), 'utf-8');
    // First line must still be 'version: 1' (schema version, not release version)
    const firstLine = content.split('\n')[0];
    expect(firstLine).toBe('version: 1');
  });
});
