/**
 * Generate Traceability Library
 *
 * Core functions for generating compliance traceability documentation:
 * - Hazard log parsing
 * - Prompt version extraction
 * - Cross-reference building
 * - Markdown document generation
 *
 * @module tools/lib/generate-traceability
 * @see WU-2035 - INIT-034
 */

import path from 'node:path';
import yaml from 'yaml';

export interface ControlDefinition {
  id: string;
  description: string;
  type: string;
  status: string;
}

export interface HazardDefinition {
  id: string;
  title: string;
  severity: number;
  likelihood: number;
  riskScore: number;
  controls: ControlDefinition[];
  residualRiskScore: number;
  acceptability: string;
}

interface PromptInput {
  path: string;
  content: string;
}

export interface PromptVersion {
  filePath: string;
  fileName: string;
  version: string;
  relativePath: string;
}

export interface GitCommit {
  hash: string;
  date: string;
  author: string;
  message: string;
  files: string[];
}

export interface CrossReference {
  source: string;
  target: string;
  type: 'hazard_to_control' | 'control_to_prompt' | 'control_to_test';
  valid: boolean;
  error?: string;
}

interface HazardReferenceInput {
  id: string;
  controls: Array<{ id: string }>;
}

interface GoldenTestReference {
  file: string;
  mentionsControls: string[];
}

/**
 * Parse hazard definitions from hazard-log.md content
 * @param {string} content - Markdown content of hazard log
 * @returns {HazardDefinition[]}
 */
export function parseHazardLog(content: string): HazardDefinition[] {
  const hazards: HazardDefinition[] = [];
  const hazardSections = content.split(/### HAZ-\d{3}:/);

  for (const section of hazardSections.slice(1)) {
    const hazard = parseHazardSection(section);
    if (hazard) {
      hazards.push(hazard);
    }
  }

  return hazards;
}

/**
 * Parse a single hazard section
 * @param {string} section
 * @returns {HazardDefinition | null}
 */
function parseHazardSection(section: string): HazardDefinition | null {
  const idMatch = section.match(/\*\*Hazard ID\*\*\s*\|\s*(HAZ-\d{3})/);
  if (!idMatch) return null;
  const id = idMatch[1];
  if (!id) {
    return null;
  }

  const [firstLine = ''] = section.split('\n');
  const titleLine = firstLine.trim();

  // Parse initial risk values
  const severityMatch = section.match(/\*\*Initial Severity\*\*\s*\|\s*(\d)/);
  const likelihoodMatch = section.match(/\*\*Initial Likelihood\*\*\s*\|\s*(\d)/);
  const riskScoreMatch = section.match(/\*\*Initial Risk Score\*\*\s*\|\s*(\d+)/);

  // Parse residual assessment
  const residualRiskMatch = section.match(/Residual Risk Score\s*\|\s*(\d+)/);
  const acceptabilityMatch = section.match(/Acceptability\s*\|\s*([^\n|]+)/);

  // Parse controls
  const controls = parseControls(section);

  return {
    id,
    title: titleLine,
    severity: severityMatch?.[1] ? parseInt(severityMatch[1], 10) : 0,
    likelihood: likelihoodMatch?.[1] ? parseInt(likelihoodMatch[1], 10) : 0,
    riskScore: riskScoreMatch?.[1] ? parseInt(riskScoreMatch[1], 10) : 0,
    controls,
    residualRiskScore: residualRiskMatch?.[1] ? parseInt(residualRiskMatch[1], 10) : 0,
    acceptability: acceptabilityMatch?.[1]?.trim() ?? 'Unknown',
  };
}

/**
 * Parse controls from a hazard section
 * @param {string} section
 * @returns {ControlDefinition[]}
 */
function parseControls(section: string): ControlDefinition[] {
  const controls: ControlDefinition[] = [];
  const controlMatches = section.matchAll(
    /\|\s*(C-\d{3}[a-z]?)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g,
  );

  for (const match of controlMatches) {
    const [, id = '', description = '', type = '', status = ''] = match;
    if (!id) {
      continue;
    }
    controls.push({
      id: id.trim(),
      description: description.trim(),
      type: type.trim(),
      status: status.trim(),
    });
  }

  return controls;
}

/**
 * Extract versions from prompt YAML files
 * @param {Array<{path: string, content: string}>} prompts
 * @returns {PromptVersion[]}
 */
export function extractPromptVersions(prompts: PromptInput[]): PromptVersion[] {
  const versions: PromptVersion[] = [];

  for (const prompt of prompts) {
    try {
      const parsed = yaml.parse(prompt.content) as unknown;
      if (parsed && typeof parsed === 'object' && 'version' in parsed) {
        const versionValue = (parsed as { version?: unknown }).version;
        if (versionValue == null) {
          continue;
        }
        versions.push({
          filePath: prompt.path,
          fileName: path.basename(prompt.path),
          version: String(versionValue),
          relativePath: prompt.path,
        });
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return versions.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/**
 * Build cross-references between hazards, controls, and tests
 * @param {Array<{id: string, controls: Array<{id: string}>}>} hazards
 * @param {PromptVersion[]} prompts
 * @param {Array<{file: string, mentionsControls: string[]}>} goldenTests
 * @returns {CrossReference[]}
 */
export function buildCrossReferences(
  hazards: HazardReferenceInput[],
  _prompts: PromptVersion[],
  goldenTests: GoldenTestReference[],
): CrossReference[] {
  const refs: CrossReference[] = [];

  // Build set of controls covered by tests
  const coveredControls = new Set<string>();
  for (const test of goldenTests) {
    for (const controlId of test.mentionsControls) {
      coveredControls.add(controlId);
    }
  }

  // Create hazard to control references
  for (const hazard of hazards) {
    for (const control of hazard.controls) {
      refs.push({
        source: hazard.id,
        target: control.id,
        type: 'hazard_to_control',
        valid: true,
      });

      // Create control to test references
      const hasCoverage = coveredControls.has(control.id);
      refs.push({
        source: control.id,
        target: 'golden-tests',
        type: 'control_to_test',
        valid: hasCoverage,
        error: hasCoverage ? undefined : `No golden test coverage for ${control.id}`,
      });
    }
  }

  return refs;
}

/**
 * Generate version history markdown from git commits
 * @param {GitCommit[]} commits
 * @returns {string}
 */
export function generateVersionHistory(commits: GitCommit[]): string {
  const lines: string[] = [
    '# Prompt Version History',
    '',
    '> Auto-generated by `tools/generate-traceability.ts`',
    `> Last generated: ${new Date().toISOString()}`,
    '',
    'This document tracks all changes to prompt files for compliance traceability.',
    '',
    '---',
    '',
    '## Recent Changes',
    '',
    '| Date | Commit | Author | Message | Files Changed |',
    '|------|--------|--------|---------|---------------|',
  ];

  for (const commit of commits.slice(0, 50)) {
    const filesStr =
      commit.files.length > 3
        ? `${commit.files
            .slice(0, 3)
            .map((f) => path.basename(f))
            .join(', ')}... (+${commit.files.length - 3})`
        : commit.files.map((f) => path.basename(f)).join(', ');

    lines.push(
      `| ${commit.date} | \`${commit.hash.slice(0, 7)}\` | ${commit.author} | ${commit.message.slice(0, 60)}${commit.message.length > 60 ? '...' : ''} | ${filesStr} |`,
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Change Categories');
  lines.push('');

  // Group by month
  const byMonth = new Map<string, GitCommit[]>();
  for (const commit of commits) {
    const month = commit.date.slice(0, 7); // YYYY-MM
    if (!byMonth.has(month)) {
      byMonth.set(month, []);
    }
    byMonth.get(month)?.push(commit);
  }

  lines.push('| Month | Total Changes | Safety-Related | Feature |');
  lines.push('|-------|---------------|----------------|---------|');

  for (const [month, monthCommits] of [...byMonth.entries()].sort().reverse()) {
    const safetyCount = monthCommits.filter(
      (c) =>
        c.message.toLowerCase().includes('safety') ||
        c.message.toLowerCase().includes('red-flag') ||
        c.message.toLowerCase().includes('emergency'),
    ).length;
    const featureCount = monthCommits.length - safetyCount;
    lines.push(`| ${month} | ${monthCommits.length} | ${safetyCount} | ${featureCount} |`);
  }

  return lines.join('\n');
}

/**
 * Generate prompt inventory markdown
 * @param {PromptVersion[]} prompts
 * @returns {string}
 */
export function generatePromptInventory(prompts: PromptVersion[]): string {
  const lines: string[] = [
    '# Prompt Inventory',
    '',
    '> Auto-generated by `tools/generate-traceability.ts`',
    `> Last generated: ${new Date().toISOString()}`,
    '',
    'Complete inventory of all versioned prompt files in the system.',
    '',
    '---',
    '',
    '## Prompt Files',
    '',
    '| Prompt | Version | Path |',
    '|--------|---------|------|',
  ];

  for (const prompt of prompts) {
    lines.push(`| ${prompt.fileName} | \`${prompt.version}\` | \`${prompt.relativePath}\` |`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Version Summary');
  lines.push('');
  lines.push(`- **Total Prompts**: ${prompts.length}`);

  const majorVersions = new Map<string, number>();
  for (const prompt of prompts) {
    const [major = '0'] = prompt.version.split('.');
    majorVersions.set(major, (majorVersions.get(major) || 0) + 1);
  }

  lines.push('- **By Major Version**:');
  for (const [major, count] of [...majorVersions.entries()].sort()) {
    lines.push(`  - v${major}.x: ${count} prompts`);
  }

  return lines.join('\n');
}

/**
 * Generate hazard matrix markdown
 * @param {HazardDefinition[]} hazards
 * @returns {string}
 */
export function generateHazardMatrix(hazards: HazardDefinition[]): string {
  const lines: string[] = [
    '# Hazard Traceability Matrix',
    '',
    '> Auto-generated by `tools/generate-traceability.ts`',
    `> Last generated: ${new Date().toISOString()}`,
    '',
    'Maps hazards to controls for DCB0129 compliance.',
    '',
    '---',
    '',
    '## Hazard Summary',
    '',
    '| Hazard ID | Title | Initial Risk | Residual Risk | Acceptability | Controls |',
    '|-----------|-------|--------------|---------------|---------------|----------|',
  ];

  for (const hazard of hazards) {
    const controlList = hazard.controls.map((c) => c.id).join(', ');
    const title = hazard.title || '';
    lines.push(
      `| ${hazard.id} | ${title.slice(0, 50)}${title.length > 50 ? '...' : ''} | ${hazard.riskScore} | ${hazard.residualRiskScore} | ${hazard.acceptability} | ${controlList} |`,
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Control Implementation Status');
  lines.push('');
  lines.push('| Control ID | Hazard | Description | Type | Status |');
  lines.push('|------------|--------|-------------|------|--------|');

  for (const hazard of hazards) {
    for (const control of hazard.controls) {
      const desc = control.description || '';
      lines.push(
        `| ${control.id} | ${hazard.id} | ${desc.slice(0, 60)}${desc.length > 60 ? '...' : ''} | ${control.type} | ${control.status} |`,
      );
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Risk Distribution');
  lines.push('');

  const riskLevels: Record<string, number> = {
    Acceptable: 0,
    Low: 0,
    Medium: 0,
    High: 0,
    Unacceptable: 0,
    Tolerable: 0,
  };

  for (const hazard of hazards) {
    const level = hazard.acceptability.replace(/\s*\(.*\)/, '');
    if (level in riskLevels) {
      riskLevels[level] = (riskLevels[level] ?? 0) + 1;
    }
  }

  lines.push('| Risk Level | Count |');
  lines.push('|------------|-------|');
  for (const [level, count] of Object.entries(riskLevels)) {
    if (count > 0) {
      lines.push(`| ${level} | ${count} |`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate validation report markdown
 * @param {CrossReference[]} crossRefs
 * @returns {string}
 */
export function generateValidationReport(crossRefs: CrossReference[]): string {
  const lines: string[] = [
    '# Traceability Validation Report',
    '',
    '> Auto-generated by `tools/generate-traceability.ts`',
    `> Last generated: ${new Date().toISOString()}`,
    '',
    'Validates cross-references between hazards, controls, and test coverage.',
    '',
    '---',
    '',
    '## Summary',
    '',
  ];

  const valid = crossRefs.filter((r) => r.valid).length;
  const invalid = crossRefs.filter((r) => !r.valid).length;
  const total = crossRefs.length;
  const coverage = total > 0 ? ((valid / total) * 100).toFixed(1) : '0.0';

  lines.push(`- **Total References**: ${total}`);
  lines.push(`- **Valid**: ${valid}`);
  lines.push(`- **Invalid/Missing**: ${invalid}`);
  lines.push(`- **Coverage**: ${coverage}%`);
  lines.push('');

  if (invalid > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Issues Found');
    lines.push('');
    lines.push('| Source | Target | Type | Issue |');
    lines.push('|--------|--------|------|-------|');

    for (const ref of crossRefs.filter((r) => !r.valid)) {
      lines.push(`| ${ref.source} | ${ref.target} | ${ref.type} | ${ref.error || 'Unknown'} |`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## All References');
  lines.push('');
  lines.push('| Source | Target | Type | Valid |');
  lines.push('|--------|--------|------|-------|');

  for (const ref of crossRefs) {
    lines.push(`| ${ref.source} | ${ref.target} | ${ref.type} | ${ref.valid ? 'Yes' : 'No'} |`);
  }

  return lines.join('\n');
}

/**
 * Validate cross-references and return summary
 * @param {CrossReference[]} refs
 * @returns {{valid: boolean, invalidCount: number, errors: string[]}}
 */
export function validateCrossReferences(refs: CrossReference[]): {
  valid: boolean;
  invalidCount: number;
  errors: string[];
} {
  const invalid = refs.filter((r) => !r.valid);
  const errors = invalid
    .map((r) => r.error)
    .filter((error): error is string => typeof error === 'string' && error.length > 0);

  return {
    valid: invalid.length === 0,
    invalidCount: invalid.length,
    errors,
  };
}
