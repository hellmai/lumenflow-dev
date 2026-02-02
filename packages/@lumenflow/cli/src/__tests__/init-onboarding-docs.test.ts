/**
 * @file init-onboarding-docs.test.ts
 * Tests for onboarding docs scaffold (WU-1309)
 * Verifies: starting-prompt, first-15-mins, local-only, lane-inference
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { scaffoldProject, type ScaffoldOptions } from '../init.js';

describe('onboarding docs scaffold', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lumenflow-onboarding-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Constants to avoid duplicate strings (sonarjs/no-duplicate-string)
  const ARC42_DOCS_STRUCTURE = 'arc42' as const;
  const STARTING_PROMPT_FILE = 'starting-prompt.md';
  const FIRST_15_MINS_FILE = 'first-15-mins.md';
  const LOCAL_ONLY_FILE = 'local-only.md';
  const LANE_INFERENCE_FILE = 'lane-inference.md';

  function getOnboardingDir(docsStructure: 'simple' | 'arc42' = ARC42_DOCS_STRUCTURE): string {
    if (docsStructure === 'simple') {
      return path.join(tempDir, 'docs', '_frameworks', 'lumenflow', 'agent', 'onboarding');
    }
    return path.join(
      tempDir,
      'docs',
      '04-operations',
      '_frameworks',
      'lumenflow',
      'agent',
      'onboarding',
    );
  }

  function getArc42Options(): ScaffoldOptions {
    return {
      force: false,
      full: true,
      docsStructure: ARC42_DOCS_STRUCTURE,
    };
  }

  describe('required onboarding docs', () => {
    it('should scaffold starting-prompt.md', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const docPath = path.join(getOnboardingDir(), STARTING_PROMPT_FILE);
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, 'utf-8');
      expect(content).toContain('Starting Prompt');
      expect(content).toContain('LUMENFLOW.md');
    });

    it('should scaffold first-15-mins.md', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const docPath = path.join(getOnboardingDir(), FIRST_15_MINS_FILE);
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, 'utf-8');
      expect(content).toContain('First 15 Minutes');
    });

    it('should scaffold local-only.md', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const docPath = path.join(getOnboardingDir(), LOCAL_ONLY_FILE);
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, 'utf-8');
      expect(content).toContain('requireRemote');
      expect(content).toContain('local');
    });

    it('should scaffold lane-inference.md', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const docPath = path.join(getOnboardingDir(), LANE_INFERENCE_FILE);
      expect(fs.existsSync(docPath)).toBe(true);

      const content = fs.readFileSync(docPath, 'utf-8');
      expect(content).toContain('lane');
      expect(content).toContain('.lumenflow.lane-inference.yaml');
    });
  });

  describe('onboarding docs with simple structure', () => {
    it('should scaffold onboarding docs in simple structure', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: true,
        docsStructure: 'simple',
      };

      await scaffoldProject(tempDir, options);

      const onboardingDir = getOnboardingDir('simple');

      expect(fs.existsSync(path.join(onboardingDir, STARTING_PROMPT_FILE))).toBe(true);
      expect(fs.existsSync(path.join(onboardingDir, FIRST_15_MINS_FILE))).toBe(true);
      expect(fs.existsSync(path.join(onboardingDir, LOCAL_ONLY_FILE))).toBe(true);
      expect(fs.existsSync(path.join(onboardingDir, LANE_INFERENCE_FILE))).toBe(true);
    });
  });

  describe('complete onboarding docs set', () => {
    it('should scaffold all required onboarding docs with --full', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const onboardingDir = getOnboardingDir();

      // Required docs from WU-1309
      const requiredDocs = [
        STARTING_PROMPT_FILE,
        FIRST_15_MINS_FILE,
        LOCAL_ONLY_FILE,
        LANE_INFERENCE_FILE,
        // Previously existing docs
        'quick-ref-commands.md',
        'first-wu-mistakes.md',
        'troubleshooting-wu-done.md',
        'agent-safety-card.md',
        'wu-create-checklist.md',
      ];

      for (const doc of requiredDocs) {
        const docPath = path.join(onboardingDir, doc);
        expect(fs.existsSync(docPath), `Expected ${doc} to exist`).toBe(true);
      }
    });

    it('should not scaffold onboarding docs without --full', async () => {
      const options: ScaffoldOptions = {
        force: false,
        full: false,
      };

      await scaffoldProject(tempDir, options);

      const onboardingDir = getOnboardingDir();

      // Onboarding docs should not exist without --full (unless --client claude)
      expect(fs.existsSync(path.join(onboardingDir, STARTING_PROMPT_FILE))).toBe(false);
    });
  });

  describe('onboarding docs content quality', () => {
    it('should have consistent date placeholder in all docs', async () => {
      await scaffoldProject(tempDir, getArc42Options());

      const onboardingDir = getOnboardingDir();
      const docs = fs.readdirSync(onboardingDir).filter((f) => f.endsWith('.md'));

      for (const doc of docs) {
        const content = fs.readFileSync(path.join(onboardingDir, doc), 'utf-8');
        // Should have a date in YYYY-MM-DD format (not {{DATE}} placeholder)
        expect(content).toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(content).not.toContain('{{DATE}}');
      }
    });
  });
});
