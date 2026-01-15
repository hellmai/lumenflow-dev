/**
 * Orchestration module (WU-2537)
 * @module @lumenflow/core/orchestration
 */

export {
  parseOrchestrateCommand,
  ORCHESTRATION_COMMANDS,
  type OrchestrateCommand,
  type OrchestrateCommandName,
  type OrchestrateOptions,
  type ParsedCommand,
  type ParseResult,
  type ParseSuccess,
  type ParseError,
} from './orchestrate-cli.js';
