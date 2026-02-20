/**
 * Types and constants for the community landing page (WU-1928).
 *
 * View types for the pack ecosystem overview, getting started guide,
 * and pack showcase. Decoupled from server-side registry types.
 */

/* ------------------------------------------------------------------
 * Featured pack for showcase section
 * ------------------------------------------------------------------ */

export interface CommunityPackShowcase {
  readonly id: string;
  readonly description: string;
  readonly latestVersion: string;
  readonly categories: readonly string[];
}

/* ------------------------------------------------------------------
 * Getting started step
 * ------------------------------------------------------------------ */

export interface GettingStartedStep {
  readonly title: string;
  readonly description: string;
  readonly command?: string;
}

/* ------------------------------------------------------------------
 * Constants — no magic strings in components
 * ------------------------------------------------------------------ */

export const COMMUNITY_PAGE_TITLE = 'Community';
export const ECOSYSTEM_HEADING = 'Pack Ecosystem';
export const ECOSYSTEM_DESCRIPTION =
  'LumenFlow packs are domain plugins that teach AI agents new capabilities. ' +
  'Each pack bundles tools, policies, and task types into a self-contained module ' +
  'that plugs into the LumenFlow kernel.';

export const GETTING_STARTED_HEADING = 'Getting Started';
export const PACK_AUTHORING_GUIDE_URL = 'https://lumenflow.dev/guides/create-a-pack/';
export const PACK_AUTHORING_LINK_LABEL = 'Read the Pack Authoring Guide';

export const PACK_SHOWCASE_HEADING = 'Available Packs';
export const PACK_SHOWCASE_EMPTY_MESSAGE = 'No packs available yet. Be the first to publish one!';
export const VIEW_MARKETPLACE_LABEL = 'Browse Marketplace';
export const VIEW_MARKETPLACE_URL = '/marketplace';

export const GETTING_STARTED_STEPS: readonly GettingStartedStep[] = [
  {
    title: 'Install LumenFlow',
    description: 'Add LumenFlow to your project with a single command.',
    command: 'npx lumenflow init',
  },
  {
    title: 'Browse Packs',
    description:
      'Explore domain packs in the marketplace to find the right tools for your workflow.',
  },
  {
    title: 'Install a Pack',
    description: 'Add a pack to your workspace and start using its tools immediately.',
    command: 'npx lumenflow pack:install software-delivery',
  },
  {
    title: 'Create Your Own',
    description: 'Scaffold a new pack and publish it to the registry for others to use.',
    command: 'npx lumenflow pack:scaffold my-pack',
  },
] as const;
