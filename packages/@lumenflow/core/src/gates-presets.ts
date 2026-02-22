// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Gates Presets
 *
 * WU-2037: Extracted from gates-config.ts
 *
 * Language ecosystem preset definitions and expansion logic.
 *
 * @module gates-presets
 */

import type { GatesExecutionConfig } from './gates-schemas.js';

/**
 * Gate preset definitions
 *
 * These provide sensible defaults for common language ecosystems.
 * Users can override fields via workspace.yaml software_delivery
 */
export const GATE_PRESETS: Record<string, Partial<GatesExecutionConfig>> = {
  node: {
    setup: 'npm ci || npm install',
    format: 'npx prettier --check .',
    lint: 'npx eslint .',
    typecheck: 'npx tsc --noEmit',
    test: 'npm test',
  },
  python: {
    setup: 'pip install -e ".[dev]" || pip install -r requirements.txt',
    format: 'ruff format --check .',
    lint: 'ruff check .',
    typecheck: 'mypy .',
    test: 'pytest',
  },
  go: {
    format: 'gofmt -l . | grep -v "^$" && exit 1 || exit 0',
    lint: 'golangci-lint run',
    typecheck: 'go vet ./...',
    test: 'go test ./...',
  },
  rust: {
    format: 'cargo fmt --check',
    lint: 'cargo clippy -- -D warnings',
    typecheck: 'cargo check',
    test: 'cargo test',
  },
  dotnet: {
    setup: 'dotnet restore',
    format: 'dotnet format --verify-no-changes',
    lint: 'dotnet build --no-restore -warnaserror',
    test: 'dotnet test --no-restore',
  },
  // WU-1118: Java/JVM, Ruby, and PHP presets
  java: {
    format: 'mvn spotless:check || ./gradlew spotlessCheck',
    lint: 'mvn checkstyle:check || ./gradlew checkstyleMain',
    typecheck: 'mvn compile -DskipTests || ./gradlew compileJava',
    test: 'mvn test || ./gradlew test',
  },
  ruby: {
    setup: 'bundle install',
    format: 'bundle exec rubocop --format simple --fail-level W',
    lint: 'bundle exec rubocop',
    test: 'bundle exec rspec',
  },
  php: {
    setup: 'composer install',
    format: 'vendor/bin/php-cs-fixer fix --dry-run --diff',
    lint: 'vendor/bin/phpstan analyse',
    test: 'vendor/bin/phpunit',
  },
};

/**
 * Expand a preset name into its default gate commands
 *
 * @param preset - Preset name (node, python, go, rust, dotnet) or undefined
 * @returns Partial gates config with preset defaults, or empty object if unknown
 */
export function expandPreset(preset: string | undefined): Partial<GatesExecutionConfig> {
  if (!preset) {
    return {};
  }

  return GATE_PRESETS[preset] ?? {};
}
