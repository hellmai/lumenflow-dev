/**
 * Orchestrate CLI parser (WU-2537)
 * @module @lumenflow/core/orchestration
 */

export const ORCHESTRATION_COMMANDS = [
  'status',
  'plan',
  'execute',
  'spawn',
  'monitor',
] as const;

export type OrchestrateCommandName = (typeof ORCHESTRATION_COMMANDS)[number];

export interface OrchestrateOptions {
  initiative?: string;
  wu?: string;
  dryRun?: boolean;
  lane?: string;
}

export interface OrchestrateCommand {
  name: OrchestrateCommandName;
  options: OrchestrateOptions;
}

export interface ParsedCommand {
  command: OrchestrateCommand;
}

export interface ParseSuccess {
  success: true;
  command: OrchestrateCommand;
}

export interface ParseError {
  success: false;
  error: string;
}

export type ParseResult = ParseSuccess | ParseError;

export function parseOrchestrateCommand(args: string[]): ParseResult {
  if (args.length === 0) {
    return { success: false, error: 'No command specified' };
  }

  const commandName = args[0];
  if (!ORCHESTRATION_COMMANDS.includes(commandName as OrchestrateCommandName)) {
    return { success: false, error: `Unknown command: ${commandName}` };
  }

  const options: OrchestrateOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--initiative' && args[i + 1]) {
      options.initiative = args[i + 1];
      i++;
    } else if (arg === '--wu' && args[i + 1]) {
      options.wu = args[i + 1];
      i++;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--lane' && args[i + 1]) {
      options.lane = args[i + 1];
      i++;
    }
  }

  if (commandName === 'status' && !options.initiative && !options.wu) {
    return {
      success: false,
      error: 'status command requires --initiative or --wu',
    };
  }

  if (commandName === 'plan' && !options.initiative) {
    return { success: false, error: 'plan command requires --initiative' };
  }

  if (commandName === 'execute' && !options.wu && !options.initiative) {
    return {
      success: false,
      error: 'execute command requires --wu or --initiative',
    };
  }

  return {
    success: true,
    command: { name: commandName as OrchestrateCommandName, options },
  };
}
