/**
 * Type declarations for @lumenflow/core imports used in shims.
 * @lumenflow/core doesn't generate .d.ts files, so we declare the types we need.
 */
declare module '@lumenflow/core' {
  export interface LumenFlowConfig {
    git?: {
      mainBranch?: string;
      agentBranchPatterns?: string[];
      laneBranchPrefix?: string;
    };
  }

  export function isAgentBranch(branch: string | null | undefined): Promise<boolean>;
  export function isAgentBranchSync(branch: string | null | undefined): boolean;
  export function isHeadlessAllowed(): boolean;
  export function getConfig(): LumenFlowConfig;
}
