import { describe, it, expect } from 'vitest';
import {
  buildCrossReferences,
  extractPromptVersions,
  parseHazardLog,
  validateCrossReferences,
} from '../generate-traceability.js';

describe('generate-traceability helpers', () => {
  it('parses hazard sections and control rows from markdown', () => {
    const markdown = [
      '# Hazard Log',
      '',
      '### HAZ-001: Prompt injection',
      '**Hazard ID** | HAZ-001',
      '**Initial Severity** | 4',
      '**Initial Likelihood** | 3',
      '**Initial Risk Score** | 12',
      '| C-001 | Validate user input | Preventive | Implemented |',
      'Residual Risk Score | 4',
      'Acceptability | Low',
    ].join('\n');

    const hazards = parseHazardLog(markdown);

    expect(hazards).toHaveLength(1);
    expect(hazards[0]).toEqual({
      id: 'HAZ-001',
      title: 'Prompt injection',
      severity: 4,
      likelihood: 3,
      riskScore: 12,
      controls: [
        {
          id: 'C-001',
          description: 'Validate user input',
          type: 'Preventive',
          status: 'Implemented',
        },
      ],
      residualRiskScore: 4,
      acceptability: 'Low',
    });
  });

  it('extracts and sorts prompt versions while skipping invalid YAML', () => {
    const versions = extractPromptVersions([
      { path: 'prompts/zeta.yaml', content: 'version: 2' },
      { path: 'prompts/alpha.yaml', content: 'version: 1.0.0' },
      { path: 'prompts/bad.yaml', content: 'version: [1,2' },
    ]);

    expect(versions).toEqual([
      {
        filePath: 'prompts/alpha.yaml',
        fileName: 'alpha.yaml',
        version: '1.0.0',
        relativePath: 'prompts/alpha.yaml',
      },
      {
        filePath: 'prompts/zeta.yaml',
        fileName: 'zeta.yaml',
        version: '2',
        relativePath: 'prompts/zeta.yaml',
      },
    ]);
  });

  it('reports missing control coverage through validation summary', () => {
    const refs = buildCrossReferences(
      [
        {
          id: 'HAZ-001',
          controls: [{ id: 'C-001' }, { id: 'C-002' }],
        },
      ],
      [],
      [{ file: 'golden/example.md', mentionsControls: ['C-001'] }],
    );

    const summary = validateCrossReferences(refs);

    expect(refs).toHaveLength(4);
    expect(summary.valid).toBe(false);
    expect(summary.invalidCount).toBe(1);
    expect(summary.errors).toContain('No golden test coverage for C-002');
  });
});
