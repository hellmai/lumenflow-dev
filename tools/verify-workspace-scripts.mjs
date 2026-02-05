#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_SCRIPTS = Object.freeze(['lint', 'typecheck']);
const WORKSPACE_GLOBS = Object.freeze(['packages/@lumenflow', 'apps']);

function getWorkspacePackageJsonPaths(repoRoot) {
  const packageJsonPaths = [];

  for (const baseRelativePath of WORKSPACE_GLOBS) {
    const basePath = path.join(repoRoot, baseRelativePath);
    if (!existsSync(basePath)) {
      continue;
    }

    for (const entry of readdirSync(basePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const packageJsonPath = path.join(basePath, entry.name, 'package.json');
      if (existsSync(packageJsonPath)) {
        packageJsonPaths.push(packageJsonPath);
      }
    }
  }

  return packageJsonPaths.sort();
}

function validatePackageScripts(packageJsonPath, repoRoot) {
  const relativePath = path.relative(repoRoot, packageJsonPath);
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const scripts = packageJson.scripts ?? {};
  const missingScripts = REQUIRED_SCRIPTS.filter((scriptName) => !scripts[scriptName]);

  return {
    relativePath,
    missingScripts,
  };
}

function main() {
  const repoRoot = process.cwd();
  const packageJsonPaths = getWorkspacePackageJsonPaths(repoRoot);
  const failures = [];

  for (const packageJsonPath of packageJsonPaths) {
    const result = validatePackageScripts(packageJsonPath, repoRoot);
    if (result.missingScripts.length > 0) {
      failures.push(result);
    }
  }

  if (failures.length > 0) {
    console.error('[verify:workspace-scripts] Missing required scripts detected:');
    for (const failure of failures) {
      for (const scriptName of failure.missingScripts) {
        console.error(`  - ${failure.relativePath}: missing scripts.${scriptName}`);
      }
    }
    process.exit(1);
  }

  console.log(
    `[verify:workspace-scripts] OK: ${packageJsonPaths.length} workspace packages define ${REQUIRED_SCRIPTS.join(', ')}`,
  );
}

main();
