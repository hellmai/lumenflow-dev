/**
 * Types for the pack marketplace pages (WU-1840).
 *
 * View types for marketplace browse, search, and pack detail.
 * Decoupled from server-side registry types.
 */

/* ------------------------------------------------------------------
 * Category for filtering packs
 * ------------------------------------------------------------------ */

export interface MarketplaceCategory {
  readonly id: string;
  readonly label: string;
  readonly count: number;
}

/* ------------------------------------------------------------------
 * Pack summary for browse/listing view
 * ------------------------------------------------------------------ */

export interface MarketplacePackSummary {
  readonly id: string;
  readonly description: string;
  readonly latestVersion: string;
  readonly updatedAt: string;
  readonly categories: readonly string[];
}

/* ------------------------------------------------------------------
 * Pack detail for the detail page
 * ------------------------------------------------------------------ */

/** Tool entry for the detail view. */
export interface MarketplaceToolView {
  readonly name: string;
  readonly permission: 'read' | 'write' | 'admin';
  readonly description?: string;
}

/** Policy entry for the detail view. */
export interface MarketplacePolicyView {
  readonly id: string;
  readonly trigger: string;
  readonly decision: 'allow' | 'deny';
  readonly reason?: string;
}

export interface MarketplacePackDetail {
  readonly id: string;
  readonly description: string;
  readonly latestVersion: string;
  readonly updatedAt: string;
  readonly categories: readonly string[];
  readonly tools: readonly MarketplaceToolView[];
  readonly policies: readonly MarketplacePolicyView[];
}

/* ------------------------------------------------------------------
 * Install command generation
 * ------------------------------------------------------------------ */

const PACK_INSTALL_COMMAND_PREFIX = 'npx lumenflow pack:install';

export function generateInstallCommand(packId: string, version?: string): string {
  if (version) {
    return `${PACK_INSTALL_COMMAND_PREFIX} ${packId}@${version}`;
  }
  return `${PACK_INSTALL_COMMAND_PREFIX} ${packId}`;
}

/* ------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------ */

export const AUTHORING_GUIDE_URL = 'https://lumenflow.dev/guides/authoring-packs/';
export const CREATE_PACK_CTA_LABEL = 'Create a Pack';
export const MARKETPLACE_PAGE_TITLE = 'Pack Marketplace';
export const SEARCH_PLACEHOLDER = 'Search packs...';
export const ALL_CATEGORIES_LABEL = 'All';
export const NO_PACKS_MESSAGE = 'No packs found matching your criteria.';
export const INSTALL_BUTTON_LABEL = 'Copy Install Command';
export const INSTALL_COPIED_LABEL = 'Copied!';
export const BACK_TO_MARKETPLACE_LABEL = 'Back to Marketplace';
