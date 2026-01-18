// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';
import boundaries from 'eslint-plugin-boundaries';
import sonarjs from 'eslint-plugin-sonarjs';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.turbo/**'],
  },

  // Base ESLint recommended
  eslint.configs.recommended,

  // TypeScript ESLint recommended
  ...tseslint.configs.recommended,
  ...tseslint.configs.strict,

  // Security plugin
  {
    plugins: {
      security,
    },
    rules: {
      ...security.configs.recommended.rules,
    },
  },

  // SonarJS plugin
  {
    plugins: {
      sonarjs,
    },
    rules: {
      ...sonarjs.configs.recommended.rules,
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
    },
  },

  // Boundaries plugin for hexagonal architecture
  {
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': [
        { type: 'ports', pattern: 'packages/@lumenflow/*/src/ports/**' },
        { type: 'application', pattern: 'packages/@lumenflow/*/src/application/**' },
        { type: 'infrastructure', pattern: 'packages/@lumenflow/*/src/infrastructure/**' },
        { type: 'shared', pattern: 'packages/@lumenflow/*/src/shared/**' },
      ],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // Ports can only import from shared
            { from: 'ports', allow: ['shared'] },
            // Application can import from ports and shared
            { from: 'application', allow: ['ports', 'shared'] },
            // Infrastructure can import from ports and shared
            { from: 'infrastructure', allow: ['ports', 'shared'] },
            // Shared can only import from shared
            { from: 'shared', allow: ['shared'] },
          ],
        },
      ],
    },
  },

  // Project-specific rules
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Strict type checking
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',

      // Code quality
      'no-console': 'error',
      'no-debugger': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Test file overrides
  {
    files: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'security/detect-non-literal-fs-filename': 'off',
    },
  },

  // Workflow framework needs dynamic file operations (spawn registry, state, worktree management)
  {
    files: [
      'packages/@lumenflow/*/src/spawn/**/*.ts',
      'packages/@lumenflow/*/src/state/**/*.ts',
      'packages/@lumenflow/*/src/git/**/*.ts',
    ],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
    },
  },

  // Shims package needs dynamic OS commands for git/pnpm interception
  {
    files: ['packages/@lumenflow/shims/src/**/*.ts'],
    rules: {
      'security/detect-object-injection': 'off',
      'sonarjs/os-command': 'off',
      'sonarjs/no-os-command-from-path': 'off',
      'no-console': 'off', // Shims need to output errors
    },
  },
);
