/**
 * ScopeChecker - File scope validation utility (WU-2537)
 * @module @lumenflow/core/lib
 */

import { minimatch } from 'minimatch';

export class ScopeChecker {
  private readonly codePaths: string[];

  constructor(codePaths: string[]) {
    this.codePaths = codePaths;
  }

  isInScope(filePath: string): boolean {
    return this.codePaths.some((pattern) => {
      if (pattern.includes('*')) {
        return minimatch(filePath, pattern);
      }
      return filePath.startsWith(pattern);
    });
  }

  filterInScope(files: string[]): string[] {
    return files.filter((f) => this.isInScope(f));
  }

  assertInScope(filePath: string): void {
    if (!this.isInScope(filePath)) {
      throw new Error(
        `File ${filePath} is out of scope. Allowed: ${this.codePaths.join(', ')}`
      );
    }
  }
}
