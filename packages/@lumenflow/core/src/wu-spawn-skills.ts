import { existsSync } from 'node:fs';
import type { ClientConfig } from './lumenflow-config-schema.js';
import { LUMENFLOW_PATHS } from './wu-constants.js';

/** WU-1430: Compose known skills directories from centralized constants */
const KNOWN_SKILLS_DIRS = [
  LUMENFLOW_PATHS.SKILLS_DIR,
  '.claude/skills',
  '.codex/skills',
  '.gemini/skills',
];
/** WU-1430: Compose known agents directories from centralized constants */
const KNOWN_AGENTS_DIRS = [
  LUMENFLOW_PATHS.AGENTS_DIR,
  '.claude/agents',
  '.codex/agents',
  '.gemini/agents',
];
const SECTION = {
  skillsSelection: '## Skills Selection',
  skillsCatalog: '### Skills Catalog',
  softPolicy: '### Soft Policy (baselines for this WU)',
  additionalSkills: '### Additional Skills (load if needed)',
  gracefulDegradation: '### Graceful Degradation',
  clientSkills: '### Client Skills Guidance',
};
const MESSAGES = {
  skillsIntro: '**IMPORTANT**: Before starting work, select and load relevant skills.',
  catalogMissing:
    'No skills directories configured or found. Set `directories.skillsDir` or `agents.clients.<client>.skillsDir` in .lumenflow.config.yaml.',
  baselineFallback:
    '- Load baseline skills: `/skill wu-lifecycle`, `/skill tdd-workflow` (for features)\n- Continue with implementation using Mandatory Standards below',
};
const CONTEXT_HINTS = {
  wuLifecycle: '- `wu-lifecycle` — ALL WUs need workflow automation',
  worktreeDiscipline: '- `worktree-discipline` — ALL WUs need path safety',
  tddWorkflow: '- `tdd-workflow` — TDD is mandatory for feature/enhancement WUs',
  bugClassification: '- `bug-classification` — Bug severity assessment',
  lumenflowGates: '- `lumenflow-gates` — Tooling often affects gates',
  llmCompliance: '- `llm-compliance` — Intelligence lane requires LLM validation',
  promptManagement: '- `prompt-management` — For prompt template work',
  frontendDesign: '- `frontend-design` — For UI component work',
};
const ADDITIONAL_SKILLS_TABLE = `| Skill | Use When |
|-------|----------|
| lumenflow-gates | Gates fail, debugging format/lint/typecheck errors |
| bug-classification | Bug discovered mid-WU, need priority classification |
| llm-compliance | Code touches LLM, prompts, classification |
| prompt-management | Working with prompt templates, golden datasets |
| frontend-design | Building UI components, pages |
| initiative-management | Multi-phase projects, INIT-XXX coordination |
| multi-agent-coordination | Spawning sub-agents, parallel WU work |
| orchestration | Agent coordination, mandatory agent checks |
| ops-maintenance | Metrics, validation, health checks |`;

interface ClientContext {
  name: string;
  config?: ClientConfig;
}

export function resolveClientConfig(config, clientName) {
  const clients = config?.agents?.clients || {};
  if (!clientName) return undefined;
  if (clients[clientName]) return clients[clientName];
  const matchKey = Object.keys(clients).find(
    (key) => key.toLowerCase() === clientName.toLowerCase(),
  );
  return matchKey ? clients[matchKey] : undefined;
}

function uniqueNonEmpty(values: Array<string | undefined>) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function resolveSkillsPaths(config, clientName) {
  const clientConfig = resolveClientConfig(config, clientName);
  const configuredSkillsDir = clientConfig?.skillsDir || config?.directories?.skillsDir;
  const configuredAgentsDir = config?.directories?.agentsDir;
  const skillsCandidates = uniqueNonEmpty([configuredSkillsDir, ...KNOWN_SKILLS_DIRS]);
  const agentsCandidates = uniqueNonEmpty([configuredAgentsDir, ...KNOWN_AGENTS_DIRS]);
  const skillsDir = skillsCandidates.find((candidate) => existsSync(candidate));
  const agentsDir = agentsCandidates.find((candidate) => existsSync(candidate));
  const configuredSkillsMissing = Boolean(configuredSkillsDir && !existsSync(configuredSkillsDir));
  const configuredAgentsMissing = Boolean(configuredAgentsDir && !existsSync(configuredAgentsDir));

  return {
    clientConfig,
    configuredSkillsDir,
    configuredAgentsDir,
    skillsDir,
    agentsDir,
    configuredSkillsMissing,
    configuredAgentsMissing,
  };
}

export function generateSkillsCatalogGuidance(config, clientName) {
  const resolution = resolveSkillsPaths(config, clientName);
  const lines = [];

  if (resolution.skillsDir) {
    lines.push(`- Check \`${resolution.skillsDir}\` for available skills.`);
  }
  if (resolution.agentsDir) {
    lines.push(`- Check \`${resolution.agentsDir}\` for agent configs (optional).`);
  }

  if (lines.length > 0) {
    return `${SECTION.skillsCatalog}\n\n${lines.join('\n')}\n`;
  }

  const configuredHint = resolution.configuredSkillsDir
    ? `Configured skillsDir \`${resolution.configuredSkillsDir}\` was not found. `
    : '';

  const clientHint = clientName
    ? `agents.clients.${clientName}.skillsDir`
    : 'agents.clients.<client>.skillsDir';
  return `${SECTION.skillsCatalog}\n\n${configuredHint}No skills directories configured or found. Set \`directories.skillsDir\` or \`${clientHint}\` in .lumenflow.config.yaml.\n`;
}

/**
 * WU-1142: Get byLane skills for a specific lane
 *
 * @param clientContext - Client context with config
 * @param lane - Lane name (e.g., "Framework: Core")
 * @returns Array of skill names for the lane, or empty array
 */
export function getByLaneSkills(clientContext: ClientContext | undefined, lane: string): string[] {
  const byLane = clientContext?.config?.skills?.byLane;
  if (!byLane || !lane) return [];
  return byLane[lane] || [];
}

export function generateClientSkillsGuidance(
  clientContext: ClientContext | undefined,
  lane?: string,
) {
  const skills = clientContext?.config?.skills;
  if (!skills) {
    return '';
  }

  // WU-1142: Check for byLane skills
  const byLaneSkills = lane ? getByLaneSkills(clientContext, lane) : [];
  const hasRecommended = skills.recommended && skills.recommended.length > 0;
  const hasByLane = byLaneSkills.length > 0;
  const hasInstructions = Boolean(skills.instructions);

  if (!hasInstructions && !hasRecommended && !hasByLane) {
    return '';
  }

  const instructions = skills.instructions ? `${skills.instructions.trim()}\n\n` : '';

  const recommendedSection =
    hasRecommended || hasByLane
      ? `Recommended skills:\n${[...(skills.recommended || []), ...byLaneSkills]
          .filter((s, i, arr) => arr.indexOf(s) === i) // dedupe
          .map((s) => `- \`${s}\``)
          .join('\n')}\n`
      : '';

  return `${SECTION.clientSkills} (${clientContext?.name})\n\n${instructions}${recommendedSection}`;
}

export function generateSkillsSelectionSection(doc, config, clientName) {
  const lane = doc.lane || '';
  const type = doc.type || 'feature';
  const laneParent = lane.split(':')[0].trim();

  const contextHints = [];

  contextHints.push(CONTEXT_HINTS.wuLifecycle);
  contextHints.push(CONTEXT_HINTS.worktreeDiscipline);

  if (type === 'feature' || type === 'enhancement') {
    contextHints.push(CONTEXT_HINTS.tddWorkflow);
  }
  if (type === 'bug') {
    contextHints.push(CONTEXT_HINTS.bugClassification);
  }

  if (laneParent === 'Operations' && lane.includes('Tooling')) {
    contextHints.push(CONTEXT_HINTS.lumenflowGates);
  }
  if (laneParent === 'Intelligence') {
    contextHints.push(CONTEXT_HINTS.llmCompliance);
    contextHints.push(CONTEXT_HINTS.promptManagement);
  }
  if (laneParent === 'Experience') {
    contextHints.push(CONTEXT_HINTS.frontendDesign);
  }

  const softPolicySection = `${SECTION.softPolicy}\n\nBased on WU context, consider loading:\n\n${contextHints.join('\n')}\n\n`;
  const catalogGuidance = generateSkillsCatalogGuidance(config, clientName);

  return `${SECTION.skillsSelection}\n\n${MESSAGES.skillsIntro}\n\n${catalogGuidance}${softPolicySection}${SECTION.additionalSkills}\n\n${ADDITIONAL_SKILLS_TABLE}\n\n${SECTION.gracefulDegradation}\n\nIf the skill catalogue is missing or invalid:\n${MESSAGES.baselineFallback}\n`;
}
