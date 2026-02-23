#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYAML } from '../packages/@lumenflow/core/src/wu-yaml.ts';

type VersionPolicy = {
  published_stable?: {
    version?: string;
  };
};

type LanguageGuideSpec = {
  support_status: string;
  guide_slug: string;
  gate_preset: string;
  companion_repo_url: string;
  verification_ref: string;
  smoke_command: string;
  last_verified: string;
};

type LanguageSupport = {
  languages?: Record<string, LanguageGuideSpec>;
};

type ExampleRepos = {
  repos?: Array<{
    language: string;
  }>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const DATA_DIR = join(ROOT, 'apps/docs/src/data');
const DOCS_DIR = join(ROOT, 'apps/docs/src/content/docs');

const VERSION_POLICY_PATH = join(DATA_DIR, 'version-policy.yaml');
const LANGUAGE_SUPPORT_PATH = join(DATA_DIR, 'language-support.yaml');
const EXAMPLE_REPOS_PATH = join(DATA_DIR, 'example-repos.yaml');
const SIDEBAR_PATH = join(ROOT, 'apps/docs/astro.config.mjs');
const RELEASES_INDEX_PATH = join(DOCS_DIR, 'releases/index.mdx');
const CHANGELOG_PATH = join(DOCS_DIR, 'reference/changelog.mdx');
const CLI_REFERENCE_PATH = join(DOCS_DIR, 'reference/cli.mdx');

const errors: string[] = [];
const warnings: string[] = [];

function readText(path: string): string {
  if (!existsSync(path)) {
    errors.push(`Missing required file: ${path}`);
    return '';
  }
  return readFileSync(path, 'utf-8');
}

function readYaml<T>(path: string): T | null {
  const text = readText(path);
  if (!text) return null;
  try {
    return parseYAML(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Invalid YAML at ${path}: ${message}`);
    return null;
  }
}

function expectContains(content: string, snippet: string, context: string): void {
  if (!content.includes(snippet)) {
    errors.push(`${context} is missing expected snippet: ${snippet}`);
  }
}

function expectNotContains(content: string, snippet: string, context: string): void {
  if (content.includes(snippet)) {
    errors.push(`${context} contains disallowed snippet: ${snippet}`);
  }
}

function slugToPath(slug: string): string {
  const normalized = slug.replace(/^\//, '');
  return join(DOCS_DIR, `${normalized}.mdx`);
}

function run(): void {
  const versionPolicy = readYaml<VersionPolicy>(VERSION_POLICY_PATH);
  const languageSupport = readYaml<LanguageSupport>(LANGUAGE_SUPPORT_PATH);
  const exampleRepos = readYaml<ExampleRepos>(EXAMPLE_REPOS_PATH);

  const stableVersion = versionPolicy?.published_stable?.version;
  if (!stableVersion) {
    errors.push('version-policy.yaml must define published_stable.version');
  }

  const sidebar = readText(SIDEBAR_PATH);
  expectContains(sidebar, "slug: 'kernel'", 'Sidebar');
  expectContains(sidebar, "slug: 'packs/software-delivery'", 'Sidebar');
  expectContains(sidebar, "slug: 'packs/software-delivery/languages'", 'Sidebar');
  expectNotContains(sidebar, "slug: 'language-guides'", 'Sidebar');

  const releasesIndex = readText(RELEASES_INDEX_PATH);
  const changelog = readText(CHANGELOG_PATH);

  if (stableVersion) {
    expectContains(releasesIndex, `v${stableVersion}`, 'Releases index');
    expectContains(changelog, `## v${stableVersion}`, 'Changelog');
  }

  const languageEntries = Object.entries(languageSupport?.languages ?? {});
  if (languageEntries.length === 0) {
    errors.push('language-support.yaml must define at least one language entry.');
  }

  const exampleLanguages = new Set((exampleRepos?.repos ?? []).map((repo) => repo.language));

  for (const [language, spec] of languageEntries) {
    const guidePath = slugToPath(spec.guide_slug);
    if (!existsSync(guidePath)) {
      errors.push(`Guide file missing for ${language}: ${guidePath}`);
      continue;
    }

    const guide = readText(guidePath);
    const context = `Guide ${language} (${guidePath})`;

    expectContains(guide, '## Support Status', context);
    expectContains(guide, '## Verified Quickstart', context);
    expectContains(guide, '## Install and Command Path', context);
    expectContains(guide, '## Gate Preset', context);
    expectContains(guide, '## Companion Repository', context);
    expectContains(guide, '## Smoke Check', context);

    expectContains(guide, `Status: ${spec.support_status}`, context);
    expectContains(guide, `Last verified: ${spec.last_verified}`, context);
    expectContains(guide, `preset: ${spec.gate_preset}`, context);
    expectContains(guide, spec.companion_repo_url, context);
    expectContains(guide, spec.verification_ref, context);
    expectContains(guide, spec.smoke_command, context);

    if (stableVersion && (spec.support_status === 'Stable' || spec.support_status === 'Preview')) {
      expectContains(guide, `@lumenflow/cli@${stableVersion}`, context);
    }

    if (!exampleLanguages.has(language)) {
      errors.push(`example-repos.yaml is missing language entry: ${language}`);
    }
  }

  for (const language of exampleLanguages) {
    if (!languageSupport?.languages?.[language]) {
      errors.push(`language-support.yaml is missing language from example-repos.yaml: ${language}`);
    }
  }

  const cliReference = readText(CLI_REFERENCE_PATH);
  expectNotContains(cliReference, '### gates:docs', 'CLI reference');
  expectNotContains(cliReference, '### lumenflow-gates', 'CLI reference');
  expectNotContains(cliReference, '### onboard', 'CLI reference');
  expectNotContains(cliReference, '### workspace:init', 'CLI reference');

  if (warnings.length > 0) {
    console.log('[docs:audit] Warnings:');
    for (const warning of warnings) {
      console.log(`  - ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.error('[docs:audit] FAILED');
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }

  console.log('[docs:audit] PASS');
  console.log(`  - Languages audited: ${languageEntries.length}`);
  if (stableVersion) {
    console.log(`  - Stable version verified: ${stableVersion}`);
  }
}

run();
