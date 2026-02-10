/**
 * ComputeContextUseCase
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Use case for computing WU context by orchestrating multiple adapters.
 * Uses constructor injection for all dependencies.
 *
 * Hexagonal Architecture - Application Layer
 * - Depends on port interfaces (ILocationResolver, IGitStateReader, IWuStateReader)
 * - Does NOT import from infrastructure layer
 *
 * @module usecases/compute-context.usecase
 */

import type {
  ILocationResolver,
  IGitStateReader,
  IWuStateReader,
  LocationContext,
  GitState,
} from '../ports/context.ports.js';
import type { WuContext, WuState, SessionState } from '../validation/types.js';
import { WU_STATUS } from '../wu-constants.js';

/**
 * Options for computing WU context.
 */
export interface ComputeContextOptions {
  /** WU ID to look up (optional - will detect from worktree if not provided) */
  wuId?: string;
  /** Current working directory (defaults to process.cwd()) */
  cwd?: string;
}

/**
 * ComputeContextUseCase
 *
 * Orchestrates the computation of WU context by calling multiple adapters
 * and assembling the unified context model.
 *
 * @example
 * // Using default adapters via DI factory
 * const useCase = createComputeContextUseCase();
 * const context = await useCase.execute({ wuId: 'WU-1094' });
 *
 * @example
 * // Using custom adapters for testing
 * const useCase = new ComputeContextUseCase(
 *   mockLocationResolver,
 *   mockGitStateReader,
 *   mockWuStateReader,
 * );
 * const context = await useCase.execute({});
 */
export class ComputeContextUseCase {
  constructor(
    private readonly locationResolver: ILocationResolver,
    private readonly gitStateReader: IGitStateReader,
    private readonly wuStateReader: IWuStateReader,
  ) {}

  /**
   * Execute the use case to compute WU context.
   *
   * @param options - Options including optional wuId and cwd
   * @returns Promise<WuContext> - Computed WU context
   */
  async execute(options: ComputeContextOptions = {}): Promise<WuContext> {
    const { wuId, cwd } = options;

    // Step 1: Resolve location context
    const location = await this.locationResolver.resolveLocation(cwd);

    // Step 2: Read git state for current directory
    const git = await this.gitStateReader.readGitState(cwd);

    // Step 3: Determine WU ID (explicit or from worktree)
    const effectiveWuId = wuId ?? location.worktreeWuId;

    // Step 4: Read WU state if we have a WU ID
    let wu: WuState | null = null;
    let worktreeGit: GitState | undefined;

    if (effectiveWuId) {
      const wuStateResult = await this.wuStateReader.readWuState(
        effectiveWuId,
        location.mainCheckout,
      );

      if (wuStateResult) {
        wu = {
          id: wuStateResult.id,
          status: wuStateResult.status,
          lane: wuStateResult.lane,
          title: wuStateResult.title,
          yamlPath: wuStateResult.yamlPath,
          isConsistent: wuStateResult.isConsistent,
          inconsistencyReason: wuStateResult.inconsistencyReason,
        };

        // Step 5: If running from main and WU is in_progress, read worktree git state
        if (location.type === 'main' && wu.status === WU_STATUS.IN_PROGRESS) {
          const worktreePath = this.getWorktreePath(location.mainCheckout, wu.lane, wu.id);
          worktreeGit = await this.gitStateReader.readGitState(worktreePath);
        }
      }
    }

    // Step 6: Create session state (inactive by default)
    const session: SessionState = {
      isActive: false,
      sessionId: null,
    };

    return {
      location,
      git,
      wu,
      session,
      worktreeGit,
    };
  }

  /**
   * Get expected worktree path for a WU.
   */
  private getWorktreePath(mainCheckout: string, lane: string, wuId: string): string {
    const laneKebab = lane.toLowerCase().replace(/[: ]+/g, '-');
    const wuIdLower = wuId.toLowerCase();
    return `${mainCheckout}/worktrees/${laneKebab}-${wuIdLower}`;
  }
}
