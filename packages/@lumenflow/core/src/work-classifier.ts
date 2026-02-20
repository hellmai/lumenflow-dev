// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signal-Based Work Classifier
 *
 * WU-1899: Determines work domain (ui/backend/docs/infra/mixed) from
 * multiple weighted signals: code_paths patterns (weight 1.0), lane hints
 * (0.6), type (0.3), description keywords (0.2).
 *
 * Returns abstract capability tags (not client skill names) for
 * vendor-agnostic design. Configurable via methodology.work_classification
 * in .lumenflow.config.yaml with sensible built-in defaults.
 *
 * @module work-classifier
 */

import { minimatch } from 'minimatch';

// ─── Constants ───────────────────────────────────────────────────────

/**
 * Work domain enum-style constants
 */
export const WORK_DOMAINS = {
  UI: 'ui',
  BACKEND: 'backend',
  DOCS: 'docs',
  INFRA: 'infra',
  MIXED: 'mixed',
} as const;

export type WorkDomain = (typeof WORK_DOMAINS)[keyof typeof WORK_DOMAINS];

/**
 * Signal weights for each source type.
 * Confidence = max(matched_signal_weights), not sum.
 */
export const SIGNAL_WEIGHTS = {
  CODE_PATHS: 1.0,
  LANE: 0.6,
  TYPE: 0.3,
  DESCRIPTION: 0.2,
} as const;

/**
 * Confidence threshold: domain only assigned when max signal weight >= this.
 */
const CONFIDENCE_THRESHOLD = 0.3;

/**
 * Smoke-test hint threshold: testMethodologyHint only assigned when
 * UI confidence >= this value.
 */
const SMOKE_TEST_THRESHOLD = 0.5;

// ─── Default Patterns ────────────────────────────────────────────────

/**
 * Built-in default UI code path patterns (minimatch glob patterns).
 * CSS/SCSS/LESS, components/pages directories, app page/layout files,
 * module CSS, styled components.
 */
export const DEFAULT_UI_CODE_PATH_PATTERNS: readonly string[] = Object.freeze([
  // Stylesheets
  '**/*.css',
  '**/*.scss',
  '**/*.less',
  '**/*.module.css',
  '**/*.module.scss',
  // Styled components
  '**/*.styled.ts',
  '**/*.styled.tsx',
  '**/*.styled.js',
  '**/*.styled.jsx',
  // Component / page directories
  '**/components/**',
  '**/pages/**',
  // Next.js / app router conventions
  '**/app/**/page.tsx',
  '**/app/**/page.ts',
  '**/app/**/page.jsx',
  '**/app/**/page.js',
  '**/app/**/layout.tsx',
  '**/app/**/layout.ts',
  '**/app/**/layout.jsx',
  '**/app/**/layout.js',
  '**/app/page.tsx',
  '**/app/page.ts',
  '**/app/layout.tsx',
  '**/app/layout.ts',
]);

/**
 * Built-in default UI lane hints.
 * Matched against the lane parent (part before the colon).
 */
export const DEFAULT_UI_LANE_HINTS: readonly string[] = Object.freeze([
  'Experience',
  'Frontend',
  'UI',
  'Design',
]);

/**
 * Built-in docs code path patterns.
 */
const DEFAULT_DOCS_CODE_PATH_PATTERNS: readonly string[] = Object.freeze([
  'docs/**',
  '**/*.md',
  '**/*.mdx',
  'README*',
  'CHANGELOG*',
]);

/**
 * Built-in docs lane hints.
 */
const DEFAULT_DOCS_LANE_HINTS: readonly string[] = Object.freeze([
  'Content',
  'Documentation',
  'Docs',
]);

/**
 * Built-in infra code path patterns.
 */
const DEFAULT_INFRA_CODE_PATH_PATTERNS: readonly string[] = Object.freeze([
  '.github/**',
  'Dockerfile*',
  'docker-compose*',
  '**/terraform/**',
  '**/k8s/**',
  '**/kubernetes/**',
  'infrastructure/**',
]);

/**
 * Built-in infra lane hints.
 */
const DEFAULT_INFRA_LANE_HINTS: readonly string[] = Object.freeze([
  'Operations',
  'Infrastructure',
  'DevOps',
  'Platform',
]);

/**
 * UI-related description keywords (case-insensitive).
 */
const UI_DESCRIPTION_KEYWORDS: readonly string[] = Object.freeze([
  'css',
  'scss',
  'less',
  'stylesheet',
  'component',
  'layout',
  'responsive',
  'ui',
  'frontend',
  'styled',
  'animation',
  'theme',
]);

/**
 * Docs-related description keywords (case-insensitive).
 */
const DOCS_DESCRIPTION_KEYWORDS: readonly string[] = Object.freeze([
  'documentation',
  'readme',
  'changelog',
  'docs',
  'guide',
  'tutorial',
]);

/**
 * Infra-related description keywords (case-insensitive).
 */
const INFRA_DESCRIPTION_KEYWORDS: readonly string[] = Object.freeze([
  'docker',
  'kubernetes',
  'terraform',
  'ci/cd',
  'pipeline',
  'deploy',
  'infrastructure',
]);

// ─── Types ───────────────────────────────────────────────────────────

/**
 * A signal that contributed to the classification.
 */
export interface WorkSignal {
  /** Signal source: 'code_paths' | 'lane' | 'type' | 'description' */
  source: string;
  /** The domain this signal points to */
  domain: WorkDomain;
  /** The weight of this signal */
  weight: number;
  /** What matched (e.g., the pattern or keyword) */
  match: string;
}

/**
 * Result of classifyWork.
 */
export interface WorkClassification {
  /** Detected work domain */
  domain: WorkDomain;
  /** Confidence score (max signal weight, 0 if no match) */
  confidence: number;
  /** Individual signals that contributed */
  signals: WorkSignal[];
  /** Abstract capability tags (NOT client skill names) */
  capabilities: string[];
  /** Test methodology hint, e.g. 'smoke-test' for UI work */
  testMethodologyHint?: string;
}

/**
 * Optional configuration to extend defaults.
 * Maps to methodology.work_classification in .lumenflow.config.yaml.
 */
export interface WorkClassificationConfig {
  ui?: {
    /** Additional code_path_patterns (extend defaults) */
    code_path_patterns?: string[];
    /** Additional lane_hints (extend defaults) */
    lane_hints?: string[];
  };
}

// ─── Internals ───────────────────────────────────────────────────────

/**
 * Tracks per-domain signals collected during classification.
 */
interface DomainSignals {
  domain: WorkDomain;
  maxWeight: number;
  signals: WorkSignal[];
}

function createDomainSignals(domain: WorkDomain): DomainSignals {
  return { domain, maxWeight: 0, signals: [] };
}

function addSignal(ds: DomainSignals, signal: WorkSignal): void {
  ds.signals.push(signal);
  if (signal.weight > ds.maxWeight) {
    ds.maxWeight = signal.weight;
  }
}

/**
 * Check if any code_paths match a set of glob patterns.
 */
function matchCodePaths(codePaths: string[], patterns: readonly string[]): string | undefined {
  for (const path of codePaths) {
    for (const pattern of patterns) {
      if (minimatch(path, pattern)) {
        return pattern;
      }
    }
  }
  return undefined;
}

/**
 * Check if the lane parent matches any hints (case-insensitive).
 */
function matchLaneHint(lane: string, hints: readonly string[]): string | undefined {
  const parts = lane.split(':');
  const laneParent = (parts[0] ?? '').trim().toLowerCase();
  const laneSublane = parts.length > 1 ? (parts[1] ?? '').trim().toLowerCase() : '';

  for (const hint of hints) {
    const hintLower = hint.toLowerCase();
    if (laneParent === hintLower || laneSublane === hintLower) {
      return hint;
    }
  }
  return undefined;
}

/**
 * Check if description contains any keywords (case-insensitive, word boundary).
 */
function matchDescriptionKeywords(
  description: string,
  keywords: readonly string[],
): string | undefined {
  const descLower = description.toLowerCase();
  for (const keyword of keywords) {
    if (descLower.includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return undefined;
}

/**
 * Map work domain to capabilities (abstract, vendor-agnostic).
 */
function getCapabilities(domain: WorkDomain): string[] {
  switch (domain) {
    case WORK_DOMAINS.UI:
      return ['ui-design-awareness', 'component-reuse-check'];
    case WORK_DOMAINS.DOCS:
      return ['documentation-structure', 'link-validation'];
    case WORK_DOMAINS.INFRA:
      return ['infrastructure-review', 'security-check'];
    case WORK_DOMAINS.MIXED:
      return ['cross-domain-awareness'];
    case WORK_DOMAINS.BACKEND:
    default:
      return [];
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Classify work domain from multiple weighted signals.
 *
 * Signal weights:
 * - code_paths patterns: 1.0
 * - lane hints: 0.6
 * - WU type: 0.3
 * - description keywords: 0.2
 *
 * Confidence = max(matched signal weights for winning domain).
 * Domain only assigned when confidence >= 0.3.
 *
 * @param doc - WU document (code_paths, lane, type, description)
 * @param config - Optional config to extend default patterns
 * @returns WorkClassification with domain, confidence, signals, capabilities, testMethodologyHint
 */
export function classifyWork(
  doc: {
    code_paths?: string[];
    lane?: string;
    type?: string;
    description?: string;
  },
  config?: WorkClassificationConfig,
): WorkClassification {
  const codePaths = doc.code_paths ?? [];
  const lane = doc.lane ?? '';
  const type = doc.type ?? '';
  const description = doc.description ?? '';

  // Merge config patterns with defaults (config extends, not replaces)
  const uiCodePathPatterns = [
    ...DEFAULT_UI_CODE_PATH_PATTERNS,
    ...(config?.ui?.code_path_patterns ?? []),
  ];
  const uiLaneHints = [...DEFAULT_UI_LANE_HINTS, ...(config?.ui?.lane_hints ?? [])];

  // Collect signals per domain
  const ui = createDomainSignals(WORK_DOMAINS.UI);
  const docs = createDomainSignals(WORK_DOMAINS.DOCS);
  const infra = createDomainSignals(WORK_DOMAINS.INFRA);

  // ── Signal 1: code_paths (weight 1.0) ──

  if (codePaths.length > 0) {
    const uiMatch = matchCodePaths(codePaths, uiCodePathPatterns);
    if (uiMatch) {
      addSignal(ui, {
        source: 'code_paths',
        domain: WORK_DOMAINS.UI,
        weight: SIGNAL_WEIGHTS.CODE_PATHS,
        match: uiMatch,
      });
    }

    const docsMatch = matchCodePaths(codePaths, DEFAULT_DOCS_CODE_PATH_PATTERNS);
    if (docsMatch) {
      addSignal(docs, {
        source: 'code_paths',
        domain: WORK_DOMAINS.DOCS,
        weight: SIGNAL_WEIGHTS.CODE_PATHS,
        match: docsMatch,
      });
    }

    const infraMatch = matchCodePaths(codePaths, DEFAULT_INFRA_CODE_PATH_PATTERNS);
    if (infraMatch) {
      addSignal(infra, {
        source: 'code_paths',
        domain: WORK_DOMAINS.INFRA,
        weight: SIGNAL_WEIGHTS.CODE_PATHS,
        match: infraMatch,
      });
    }
  }

  // ── Signal 2: lane hints (weight 0.6) ──

  if (lane) {
    const uiLaneMatch = matchLaneHint(lane, uiLaneHints);
    if (uiLaneMatch) {
      addSignal(ui, {
        source: 'lane',
        domain: WORK_DOMAINS.UI,
        weight: SIGNAL_WEIGHTS.LANE,
        match: uiLaneMatch,
      });
    }

    const docsLaneMatch = matchLaneHint(lane, DEFAULT_DOCS_LANE_HINTS);
    if (docsLaneMatch) {
      addSignal(docs, {
        source: 'lane',
        domain: WORK_DOMAINS.DOCS,
        weight: SIGNAL_WEIGHTS.LANE,
        match: docsLaneMatch,
      });
    }

    const infraLaneMatch = matchLaneHint(lane, DEFAULT_INFRA_LANE_HINTS);
    if (infraLaneMatch) {
      addSignal(infra, {
        source: 'lane',
        domain: WORK_DOMAINS.INFRA,
        weight: SIGNAL_WEIGHTS.LANE,
        match: infraLaneMatch,
      });
    }
  }

  // ── Signal 3: WU type (weight 0.3) ──

  if (type === 'documentation') {
    addSignal(docs, {
      source: 'type',
      domain: WORK_DOMAINS.DOCS,
      weight: SIGNAL_WEIGHTS.TYPE,
      match: 'documentation',
    });
  }

  // ── Signal 4: description keywords (weight 0.2) ──

  if (description) {
    const uiKeywordMatch = matchDescriptionKeywords(description, UI_DESCRIPTION_KEYWORDS);
    if (uiKeywordMatch) {
      addSignal(ui, {
        source: 'description',
        domain: WORK_DOMAINS.UI,
        weight: SIGNAL_WEIGHTS.DESCRIPTION,
        match: uiKeywordMatch,
      });
    }

    const docsKeywordMatch = matchDescriptionKeywords(description, DOCS_DESCRIPTION_KEYWORDS);
    if (docsKeywordMatch) {
      addSignal(docs, {
        source: 'description',
        domain: WORK_DOMAINS.DOCS,
        weight: SIGNAL_WEIGHTS.DESCRIPTION,
        match: docsKeywordMatch,
      });
    }

    const infraKeywordMatch = matchDescriptionKeywords(description, INFRA_DESCRIPTION_KEYWORDS);
    if (infraKeywordMatch) {
      addSignal(infra, {
        source: 'description',
        domain: WORK_DOMAINS.INFRA,
        weight: SIGNAL_WEIGHTS.DESCRIPTION,
        match: infraKeywordMatch,
      });
    }
  }

  // ── Determine winning domain ──

  const candidates = [ui, docs, infra].filter((d) => d.maxWeight >= CONFIDENCE_THRESHOLD);

  // Check for mixed: multiple domains with strong code_paths signals
  const strongCodePathDomains = [ui, docs, infra].filter((d) =>
    d.signals.some((s) => s.source === 'code_paths'),
  );

  if (strongCodePathDomains.length > 1) {
    // Multiple code_paths domains detected - classify as mixed
    const allSignals = strongCodePathDomains.flatMap((d) => d.signals);
    return {
      domain: WORK_DOMAINS.MIXED,
      confidence: Math.max(...strongCodePathDomains.map((d) => d.maxWeight)),
      signals: allSignals,
      capabilities: getCapabilities(WORK_DOMAINS.MIXED),
      testMethodologyHint: undefined,
    };
  }

  if (candidates.length === 0) {
    // No signals above threshold - default to backend
    return {
      domain: WORK_DOMAINS.BACKEND,
      confidence: 0,
      signals: [],
      capabilities: [],
      testMethodologyHint: undefined,
    };
  }

  // Pick the domain with highest max weight
  candidates.sort((a, b) => b.maxWeight - a.maxWeight);
  const winner = candidates[0] as DomainSignals;

  const testMethodologyHint =
    winner.domain === WORK_DOMAINS.UI && winner.maxWeight >= SMOKE_TEST_THRESHOLD
      ? 'smoke-test'
      : undefined;

  return {
    domain: winner.domain,
    confidence: winner.maxWeight,
    signals: winner.signals,
    capabilities: getCapabilities(winner.domain),
    testMethodologyHint,
  };
}
