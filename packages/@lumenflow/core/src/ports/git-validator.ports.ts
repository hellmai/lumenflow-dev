/**
 * Git Adapter and Validator Port Interfaces
 *
 * WU-1103: INIT-003 Phase 2c - Migrate git & validator modules
 *
 * Hexagonal Architecture - Input Ports:
 * These abstractions allow external users to inject custom implementations
 * for git operations and PHI scanning.
 *
 * @module ports/git-validator
 */

/**
 * Merge options for git merge operations
 */
export interface MergeOptions {
  /** Fast-forward only merge (--ff-only flag) */
  ffOnly?: boolean;
}

/**
 * Merge result from git merge operations
 */
export interface MergeResult {
  /** Whether the merge succeeded */
  success: boolean;
}

/**
 * Push options for git push operations
 */
export interface PushOptions {
  /** Set upstream tracking (-u flag) */
  setUpstream?: boolean;
}

/**
 * Delete branch options
 */
export interface DeleteBranchOptions {
  /** Force delete (use -D instead of -d) */
  force?: boolean;
}

/**
 * Worktree remove options
 */
export interface WorktreeRemoveOptions {
  /** Force removal */
  force?: boolean;
}

/**
 * Git Adapter Port Interface
 *
 * Abstracts git operations to allow dependency injection and testing.
 * The default implementation uses simple-git library.
 *
 * @example
 * // Custom implementation for testing
 * const mockGit: IGitAdapter = {
 *   getCurrentBranch: vi.fn().mockResolvedValue('main'),
 *   getStatus: vi.fn().mockResolvedValue(''),
 *   // ... other methods
 * };
 *
 * @example
 * // Using default implementation
 * import { GitAdapter } from './git-adapter.js';
 * const adapter: IGitAdapter = new GitAdapter({ baseDir: '/path' });
 */
export interface IGitAdapter {
  /**
   * Get current branch name
   * @returns Promise resolving to branch name
   * @example
   * await git.getCurrentBranch(); // "lane/operations/wu-1213"
   */
  getCurrentBranch(): Promise<string>;

  /**
   * Get git status (porcelain format string)
   * @returns Promise resolving to status output in porcelain format
   * @example
   * await git.getStatus(); // " M file.txt\n?? untracked.txt"
   */
  getStatus(): Promise<string>;

  /**
   * Check if a branch exists
   * @param branch - Branch name to check
   * @returns Promise resolving to true if branch exists
   * @example
   * await git.branchExists('main'); // true
   */
  branchExists(branch: string): Promise<boolean>;

  /**
   * Check if a remote branch exists
   * @param remote - Remote name (e.g., 'origin')
   * @param branch - Branch name
   * @returns Promise resolving to true if remote branch exists
   * @example
   * await git.remoteBranchExists('origin', 'feature'); // true/false
   */
  remoteBranchExists(remote: string, branch: string): Promise<boolean>;

  /**
   * Check if working tree is clean (no uncommitted changes)
   * @returns Promise resolving to true if clean
   * @example
   * await git.isClean(); // true or false
   */
  isClean(): Promise<boolean>;

  /**
   * Fetch from remote
   * @param remote - Remote name (optional, defaults to fetching all)
   * @param branch - Branch name (optional)
   * @example
   * await git.fetch('origin', 'main');
   * await git.fetch(); // Fetch all remotes
   */
  fetch(remote?: string, branch?: string): Promise<void>;

  /**
   * Pull from remote branch
   * @param remote - Remote name
   * @param branch - Branch name
   * @example
   * await git.pull('origin', 'main');
   */
  pull(remote: string, branch: string): Promise<void>;

  /**
   * Add files to staging area
   * @param files - Files to add (single file or array)
   * @example
   * await git.add('file.txt');
   * await git.add(['file1.txt', 'file2.txt']);
   */
  add(files: string | string[]): Promise<void>;

  /**
   * Commit changes
   * @param message - Commit message
   * @example
   * await git.commit('feat: add new feature');
   */
  commit(message: string): Promise<void>;

  /**
   * Push to remote
   * @param remote - Remote name (defaults to 'origin')
   * @param branch - Branch name (optional, uses current branch if not specified)
   * @param options - Push options
   * @example
   * await git.push('origin', 'main');
   * await git.push('origin', 'feature', { setUpstream: true });
   */
  push(remote?: string, branch?: string, options?: PushOptions): Promise<void>;

  /**
   * Checkout a branch
   * @param branch - Branch name
   * @example
   * await git.checkout('main');
   */
  checkout(branch: string): Promise<void>;

  /**
   * Create and checkout a new branch
   * @param branch - Branch name
   * @param startPoint - Starting commit (optional, defaults to HEAD)
   * @example
   * await git.createBranch('feature/new-feature');
   * await git.createBranch('hotfix/bug', 'main');
   */
  createBranch(branch: string, startPoint?: string): Promise<void>;

  /**
   * Delete a branch
   * @param branch - Branch name
   * @param options - Delete options
   * @example
   * await git.deleteBranch('feature');
   * await git.deleteBranch('feature', { force: true });
   */
  deleteBranch(branch: string, options?: DeleteBranchOptions): Promise<void>;

  /**
   * Merge a branch
   * @param branch - Branch to merge
   * @param options - Merge options
   * @returns Promise resolving to merge result
   * @example
   * await git.merge('feature-branch');
   * await git.merge('feature-branch', { ffOnly: true });
   */
  merge(branch: string, options?: MergeOptions): Promise<MergeResult>;

  /**
   * Get commit hash
   * @param ref - Git ref (optional, defaults to 'HEAD')
   * @returns Promise resolving to commit hash
   * @example
   * await git.getCommitHash(); // "a1b2c3d..."
   * await git.getCommitHash('main'); // "e4f5g6h..."
   */
  getCommitHash(ref?: string): Promise<string>;

  /**
   * Add a worktree with new branch
   * @param path - Worktree path
   * @param branch - Branch name
   * @param startPoint - Starting commit (optional, defaults to HEAD)
   * @example
   * await git.worktreeAdd('worktrees/feature', 'feature-branch', 'main');
   */
  worktreeAdd(path: string, branch: string, startPoint?: string): Promise<void>;

  /**
   * Remove a worktree
   * @param worktreePath - Worktree path
   * @param options - Remove options
   * @example
   * await git.worktreeRemove('worktrees/feature');
   * await git.worktreeRemove('worktrees/feature', { force: true });
   */
  worktreeRemove(worktreePath: string, options?: WorktreeRemoveOptions): Promise<void>;

  /**
   * List all worktrees
   * @returns Promise resolving to worktree list in porcelain format
   * @example
   * await git.worktreeList();
   */
  worktreeList(): Promise<string>;

  /**
   * Execute arbitrary git command via raw()
   * @param args - Git command arguments
   * @returns Promise resolving to command output
   * @example
   * await git.raw(['status', '--porcelain']);
   */
  raw(args: string[]): Promise<string>;
}

/**
 * PHI (Protected Health Information) match result
 */
export interface PHIMatch {
  /** PHI type identifier (e.g., 'NHS_NUMBER', 'POSTCODE_MEDICAL_CONTEXT') */
  type: string;
  /** The matched value */
  value: string;
  /** Start position in content */
  startIndex: number;
  /** End position in content */
  endIndex: number;
  /** Medical keyword that triggered postcode detection (optional) */
  medicalKeyword?: string;
}

/**
 * PHI scan result
 */
export interface PHIScanResult {
  /** Whether PHI was detected */
  hasPHI: boolean;
  /** Array of PHI matches found */
  matches: PHIMatch[];
  /** Non-blocking warnings (e.g., test data detected) */
  warnings: string[];
}

/**
 * Options for PHI scanning
 */
export interface PHIScanOptions {
  /** File path for exclusion check */
  filePath?: string;
}

/**
 * PHI Scanner Port Interface
 *
 * Abstracts PHI (Protected Health Information) detection to allow
 * dependency injection and testing. Detects NHS numbers and UK
 * postcodes in medical context.
 *
 * @example
 * // Custom implementation for testing
 * const mockScanner: IPhiScanner = {
 *   scanForPHI: vi.fn().mockReturnValue({ hasPHI: false, matches: [], warnings: [] }),
 *   isPathExcluded: vi.fn().mockReturnValue(false),
 *   formatPHISummary: vi.fn().mockReturnValue('No PHI detected'),
 * };
 *
 * @example
 * // Using default implementation
 * import { scanForPHI, isPathExcluded, formatPHISummary } from './validators/phi-scanner.js';
 * const scanner: IPhiScanner = { scanForPHI, isPathExcluded, formatPHISummary };
 */
export interface IPhiScanner {
  /**
   * Scan content for PHI (Protected Health Information)
   *
   * Detects:
   * - Valid NHS numbers (validated with Modulus 11 checksum)
   * - UK postcodes in medical context
   *
   * @param content - Content to scan
   * @param options - Scan options
   * @returns Scan result with matches and warnings
   * @example
   * scanner.scanForPHI('Patient NHS: 2983396339'); // { hasPHI: true, matches: [...], warnings: [] }
   */
  scanForPHI(content: string, options?: PHIScanOptions): PHIScanResult;

  /**
   * Check if a file path should be excluded from PHI scanning
   *
   * Test files, fixtures, mocks, and documentation are typically excluded.
   *
   * @param filePath - Path to check
   * @returns True if path should be excluded
   * @example
   * scanner.isPathExcluded('src/__tests__/file.test.ts'); // true
   * scanner.isPathExcluded('src/utils/helper.ts'); // false
   */
  isPathExcluded(filePath: string | null | undefined): boolean;

  /**
   * Create a human-readable summary of PHI matches
   *
   * @param matches - PHI matches from scanForPHI
   * @returns Summary message
   * @example
   * scanner.formatPHISummary([{ type: 'NHS_NUMBER', ... }]); // "PHI detected: 1 NHS number"
   */
  formatPHISummary(matches: PHIMatch[]): string;
}
