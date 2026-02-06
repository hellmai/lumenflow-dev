/**
 * Build the canonical claim-repair command shown in wu:done preflight errors.
 *
 * We route all guidance through this helper so deprecated aliases do not
 * accidentally leak back into user-facing output.
 */
export function buildClaimRepairCommand(id: string): string {
  return `pnpm wu:repair --claim --id ${id}`;
}
