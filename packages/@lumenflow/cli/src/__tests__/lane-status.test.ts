import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveLaneLifecycleForStatus } from '../lane-status.js';

describe('WU-1753: lane:status lifecycle reads are non-mutating', () => {
  it('does not rewrite legacy config when lifecycle status is inferred', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-status-readonly-'));
    const configPath = path.join(tempDir, '.lumenflow.config.yaml');
    const inferencePath = path.join(tempDir, '.lumenflow.lane-inference.yaml');

    try {
      const configWithComments = `version: "2.0"
project: test
# keep this comment
lanes:
  definitions:
    - name: "Framework: Core"
      wip_limit: 1
      code_paths:
        - "src/core/**"
`;

      fs.writeFileSync(configPath, configWithComments, 'utf-8');
      fs.writeFileSync(
        inferencePath,
        `Framework:
  Core:
    code_paths:
      - src/core/**
`,
        'utf-8',
      );

      const before = fs.readFileSync(configPath, 'utf-8');
      const classification = resolveLaneLifecycleForStatus(tempDir);
      const after = fs.readFileSync(configPath, 'utf-8');

      expect(classification.status).toBe('locked');
      expect(classification.persisted).toBe(false);
      expect(after).toBe(before);
      expect(after).toContain('# keep this comment');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
