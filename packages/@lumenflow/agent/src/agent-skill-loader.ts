/**
 * Agent Skill Loader
 *
 * Parses agent frontmatter to extract skills: field and validates
 * that referenced skills exist in .claude/skills/
 *
 * @module agent-skill-loader
 */

import yaml from 'yaml';

/** @type {string} */
const SKILLS_BASE_PATH = '.claude/skills';

/** @type {string} */
const SKILL_FILENAME = 'SKILL.md';

/** @type {RegExp} */
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Parse skills array from agent markdown frontmatter
 *
 * @param {string} content - Agent markdown file content
 * @returns {string[]} Array of skill names (empty if no skills field)
 */
export function parseAgentSkills(content) {
  try {
    const match = content.match(FRONTMATTER_REGEX);

    if (!match) {
      return [];
    }

    const frontmatterYaml = match[1];
    const data = yaml.parse(frontmatterYaml);

    if (!data || !data.skills) {
      return [];
    }

    // Handle both string and array formats
    const skillsValue = data.skills;

    if (Array.isArray(skillsValue)) {
      return skillsValue.map((s) => String(s).trim()).filter(Boolean);
    }

    // Parse comma-separated string
    return String(skillsValue)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Validate that all skill references point to existing skill directories
 *
 * @param {string[]} skills - Array of skill names
 * @param {{ exists: (path: string) => boolean }} deps - Dependencies
 * @returns {string[]} Array of error messages (empty if all valid)
 */
export function validateSkillReferences(skills, deps) {
  const errors = [];

  for (const skill of skills) {
    const skillPath = \`\${SKILLS_BASE_PATH}/\${skill}/\${SKILL_FILENAME}\`;

    if (!deps.exists(skillPath)) {
      errors.push(\`Skill "\${skill}" not found at \${skillPath}\`);
    }
  }

  return errors;
}

/**
 * Get file paths for an array of skill names
 *
 * @param {string[]} skills - Array of skill names
 * @returns {string[]} Array of skill file paths
 */
export function getSkillPaths(skills) {
  return skills.map((skill) => \`\${SKILLS_BASE_PATH}/\${skill}/\${SKILL_FILENAME}\`);
}

/**
 * Load and validate skills from an agent file
 *
 * @param {string} agentPath - Path to agent markdown file
 * @param {{ readFile: (path: string) => Promise<string>, exists: (path: string) => boolean }} deps
 * @returns {Promise<{ valid: boolean, skills: string[], errors: string[], paths: string[] }>}
 */
export async function loadAgentSkills(agentPath, deps) {
  const content = await deps.readFile(agentPath);
  const skills = parseAgentSkills(content);
  const errors = validateSkillReferences(skills, deps);
  const paths = getSkillPaths(skills);

  return {
    valid: errors.length === 0,
    skills,
    errors,
    paths,
  };
}

/**
 * Validate all agents in a directory
 *
 * @param {string} agentsDir - Path to agents directory
 * @param {{ readdir: (path: string) => Promise<string[]>, readFile: (path: string) => Promise<string>, exists: (path: string) => boolean }} deps
 * @returns {Promise<{ valid: boolean, results: Map<string, { skills: string[], errors: string[] }> }>}
 */
export async function validateAllAgents(agentsDir, deps) {
  const files = await deps.readdir(agentsDir);
  const agentFiles = files.filter(
    (f) => f.endsWith('.md') && f !== 'README.md'
  );

  const results = new Map();
  let allValid = true;

  for (const file of agentFiles) {
    const agentPath = \`\${agentsDir}/\${file}\`;
    const result = await loadAgentSkills(agentPath, deps);
    results.set(file, { skills: result.skills, errors: result.errors });

    if (!result.valid) {
      allValid = false;
    }
  }

  return { valid: allValid, results };
}
