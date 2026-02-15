import { existsSync } from 'node:fs';

/**
 * Strategy interface for client-specific spawn behavior
 */
export interface SpawnStrategy {
  /**
   * Get the context loading preamble for the specific client
   */
  getPreamble(wuId: string): string;

  /**
   * Get instructions for loading agent skills/tools
   */
  getSkillLoadingInstruction(): string;
}

/**
 * Base class with shared preamble logic
 */
abstract class BaseSpawnStrategy implements SpawnStrategy {
  protected getCorePreamble(wuId: string): string {
    return `Load the following context in this order:

1. Read LUMENFLOW.md (workflow fundamentals and critical rules)
2. Read .lumenflow/constraints.md (non-negotiable constraints)
3. Read README.md (project structure and tech stack)
4. Read docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md sections 1-7 (TDD, gates, Definition of Done)
5. Read docs/04-operations/tasks/wu/${wuId}.yaml (the specific WU you're working on)
6. Read docs/04-operations/_frameworks/lumenflow/agent/onboarding/quick-ref-commands.md (CLI tooling reference - USE THESE COMMANDS)`;
  }

  abstract getPreamble(wuId: string): string;

  /**
   * Default skill loading instruction - shared by GenericStrategy and GeminiCliStrategy
   * ClaudeCodeStrategy overrides this with Claude-specific paths
   */
  getSkillLoadingInstruction(): string {
    return `## Skills Selection

1. Check \`.lumenflow/agents\` for available skills.
2. Select relevant skills for this task.`;
  }
}

/**
 * Strategy for Claude Code (Local/Terminal)
 */
export class ClaudeCodeStrategy extends BaseSpawnStrategy {
  getPreamble(wuId: string): string {
    let preamble = this.getCorePreamble(wuId);

    // Vendor overlay
    if (existsSync('.claude/CLAUDE.md')) {
      // Insert after LUMENFLOW.md if possible, or just append/prepend
      // For simplicity and clarity, we'll prepend the vendor specific instructions
      // relying on the user to follow the specific order if stated.
      // Actually, checking original behavior: CLAUDE.md was #1.
      // But new plan says LUMENFLOW.md is core.
      // We will append it as an overlay step.
      preamble += `\n7. Read .claude/CLAUDE.md (Claude-specific workflow overlay)`;
    }

    return preamble;
  }

  getSkillLoadingInstruction(): string {
    return `## Skills Selection
    
1. Check \`.lumenflow/agents\` for available skills.
2. Check \`.claude/agents\` for Claude-specific overrides or additions.
3. Select relevant skills for this task.`;
  }
}

/**
 * Strategy for Gemini CLI (Multimodal/Ecosystem)
 * Uses default getSkillLoadingInstruction from base class
 */
export class GeminiCliStrategy extends BaseSpawnStrategy {
  getPreamble(wuId: string): string {
    let preamble = this.getCorePreamble(wuId);

    if (existsSync('GEMINI.md')) {
      preamble += `\n7. Read GEMINI.md (Gemini-specific workflow overlay)`;
    }

    return preamble;
  }
}

/**
 * Generic Strategy (Unknown/Other clients)
 * Uses default getSkillLoadingInstruction from base class
 */
export class GenericStrategy extends BaseSpawnStrategy {
  getPreamble(wuId: string): string {
    return this.getCorePreamble(wuId);
  }
}

/**
 * Create a strategy for the given client
 * @param clientName - Client name (e.g. 'claude-code', 'codex-cli', 'gemini-cli')
 */
export function createSpawnStrategy(clientName: string): SpawnStrategy {
  switch (clientName.toLowerCase()) {
    case 'claude': // Legacy alias
    case 'claude-code':
      return new ClaudeCodeStrategy();

    case 'gemini': // Alias
    case 'gemini-cli':
      return new GeminiCliStrategy();

    case 'codex': // Deprecated alias
    case 'codex-cli':
      // Codex might need its own strategy later (sandbox), but for now generic or claude-like?
      // Plan says: "codex: preamble: false, strategy: cloud-sandbox" -> implies Generic or dedicated.
      // For now, let's map to Generic but maybe we should add CodexStrategy if it has diff behavior.
      // Re-reading plan: "CodexStrategy: Emphasizes cloud sandbox constraints"
      // But for this "Minimal" pass, let's stick to Generic with a comment,
      // OR essentially treat it as Generic since we don't have constraints logic here yet (it's in wu-spawn).
      // Actually, let's return GenericStrategy but we might handle constraints elsewhere.
      return new GenericStrategy();

    default:
      // Warn? The factory just creates. The caller should warn if it fell back.
      // But here we just return Generic.
      return new GenericStrategy();
  }
}

/**
 * Factory for creating strategies (legacy wrapper)
 * @deprecated Use createSpawnStrategy function directly
 */
export const SpawnStrategyFactory = {
  create: createSpawnStrategy,
};
