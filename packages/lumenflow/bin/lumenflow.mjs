#!/usr/bin/env node
/**
 * Thin wrapper that delegates to @lumenflow/cli command entrypoints.
 * This package exists so `npx lumenflow` resolves to the full CLI surface
 * (npm requires the bare package name to match for npx resolution).
 *
 * WU-1977
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const NODE_MODULES_DIR = 'node_modules';
const CLI_SCOPE_DIR = '@lumenflow';
const CLI_PACKAGE_DIR = 'cli';
const CLI_DIST_DIR = 'dist';
const CLI_PACKAGE_MANIFEST_FILE = 'package.json';
const CLI_PUBLIC_MANIFEST_FILE = 'public-manifest.js';
const CLI_ENTRY_INIT = 'init.js';
const CLI_ENTRY_COMMANDS = 'commands.js';
const CLI_ENTRY_DIST_PREFIX = `./${CLI_DIST_DIR}/`;
const COMMAND_HELP = 'help';
const COMMAND_INIT = 'init';
const COMMANDS_BIN_NAME = 'lumenflow-commands';
const HELP_FLAG_SHORT = '-h';
const HELP_FLAG_LONG = '--help';
const COMMAND_DELIMITER = ':';
const ENTRY_FILE_SUFFIX = '.js';
const EXIT_CODE_ERROR = 1;
const ERROR_PREFIX = '[lumenflow]';
const CLI_INSTALL_HINT = 'Run: npm install @lumenflow/cli';

export const DEFAULT_DISPATCH = Object.freeze({
  initEntry: CLI_ENTRY_INIT,
  commandsEntry: CLI_ENTRY_COMMANDS,
});

/**
 * @typedef {{name?: string, binName?: string, binPath?: string}} ManifestCommandLike
 * @typedef {{entryRelativePath: string, forwardedArgs: string[]}} DispatchTarget
 */

/**
 * Normalize manifest binPath values to dist-relative entry paths.
 * Examples:
 *   ./dist/wu-claim.js -> wu-claim.js
 *   ./dist/commands/integrate.js -> commands/integrate.js
 */
function normalizeManifestBinPath(binPath) {
  if (typeof binPath !== 'string' || binPath.length === 0) {
    return null;
  }
  if (binPath.startsWith(CLI_ENTRY_DIST_PREFIX)) {
    return binPath.slice(CLI_ENTRY_DIST_PREFIX.length);
  }
  if (binPath.startsWith('./')) {
    return binPath.slice(2);
  }
  return binPath;
}

function isHelpToken(token) {
  return token === COMMAND_HELP || token === HELP_FLAG_SHORT || token === HELP_FLAG_LONG;
}

function commandTokenToEntryRelativePath(token) {
  if (typeof token !== 'string' || token.length === 0) {
    return null;
  }
  if (token.includes(COMMAND_DELIMITER)) {
    return `${token.replaceAll(COMMAND_DELIMITER, '-')}${ENTRY_FILE_SUFFIX}`;
  }
  if (token.includes('-')) {
    return `${token}${ENTRY_FILE_SUFFIX}`;
  }
  return null;
}

/**
 * Build lookup tables from the public manifest.
 *
 * @param {ManifestCommandLike[]} manifest
 */
function buildManifestDispatchIndex(manifest) {
  /** @type {Map<string, string>} */
  const byName = new Map();
  /** @type {Map<string, string>} */
  const byBinName = new Map();

  for (const command of manifest) {
    const entryRelativePath = normalizeManifestBinPath(command?.binPath);
    if (!entryRelativePath) {
      continue;
    }
    if (typeof command?.name === 'string' && command.name.length > 0) {
      byName.set(command.name, entryRelativePath);
    }
    if (typeof command?.binName === 'string' && command.binName.length > 0) {
      byBinName.set(command.binName, entryRelativePath);
    }
  }

  return { byName, byBinName };
}

/**
 * Resolve wrapper argv into a specific @lumenflow/cli dist entrypoint.
 *
 * @param {string[]} argv
 * @param {ManifestCommandLike[]} manifest
 * @returns {DispatchTarget}
 */
export function resolveDispatchTarget(argv, manifest) {
  const [commandToken, ...remainingArgs] = argv;

  if (commandToken === undefined || isHelpToken(commandToken)) {
    return {
      entryRelativePath: DEFAULT_DISPATCH.commandsEntry,
      forwardedArgs: [],
    };
  }

  if (commandToken === COMMAND_INIT) {
    return {
      entryRelativePath: DEFAULT_DISPATCH.initEntry,
      forwardedArgs: remainingArgs,
    };
  }

  const dispatchIndex = buildManifestDispatchIndex(manifest);
  const manifestEntry =
    dispatchIndex.byName.get(commandToken) ?? dispatchIndex.byBinName.get(commandToken);
  if (manifestEntry) {
    return {
      entryRelativePath: manifestEntry,
      forwardedArgs: remainingArgs,
    };
  }

  const fallbackEntry = commandTokenToEntryRelativePath(commandToken);
  if (fallbackEntry) {
    return {
      entryRelativePath: fallbackEntry,
      forwardedArgs: remainingArgs,
    };
  }

  // Backward-compatible fallback: unknown tokens continue through init parser.
  return {
    entryRelativePath: DEFAULT_DISPATCH.initEntry,
    forwardedArgs: argv,
  };
}

function loadPublicManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    return [];
  }
  return import(pathToFileURL(manifestPath).href)
    .then((module) =>
      typeof module.getPublicManifest === 'function' ? module.getPublicManifest() : [],
    )
    .then((manifest) => (Array.isArray(manifest) ? manifest : []))
    .catch(() => []);
}

function findCliPackageRoot(startDir) {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const candidateRoot = join(dir, NODE_MODULES_DIR, CLI_SCOPE_DIR, CLI_PACKAGE_DIR);
    const candidateManifest = join(candidateRoot, CLI_PACKAGE_MANIFEST_FILE);
    const candidateInitEntry = join(candidateRoot, CLI_DIST_DIR, CLI_ENTRY_INIT);
    if (existsSync(candidateManifest) && existsSync(candidateInitEntry)) {
      return candidateRoot;
    }
    dir = dirname(dir);
  }
  return null;
}

function printResolutionError() {
  console.error(`${ERROR_PREFIX} Could not find @lumenflow/cli. ${CLI_INSTALL_HINT}`);
}

export async function main() {
  const wrapperDir = dirname(fileURLToPath(import.meta.url));
  const cliPackageRoot = findCliPackageRoot(wrapperDir);

  if (!cliPackageRoot) {
    printResolutionError();
    process.exit(EXIT_CODE_ERROR);
  }

  const manifestPath = join(cliPackageRoot, CLI_DIST_DIR, CLI_PUBLIC_MANIFEST_FILE);
  const manifest = await loadPublicManifest(manifestPath);

  const dispatchTarget = resolveDispatchTarget(process.argv.slice(2), manifest);
  const entryPath = join(cliPackageRoot, CLI_DIST_DIR, dispatchTarget.entryRelativePath);

  if (!existsSync(entryPath)) {
    const initFallbackPath = join(cliPackageRoot, CLI_DIST_DIR, DEFAULT_DISPATCH.initEntry);
    // WU-2230: Use dispatchTarget.forwardedArgs (which has 'init' token stripped)
    // instead of initialArgs (which includes 'init' and causes Commander to reject it
    // as an unexpected positional argument).
    const fallbackArgs =
      dispatchTarget.entryRelativePath === DEFAULT_DISPATCH.commandsEntry
        ? [HELP_FLAG_LONG]
        : dispatchTarget.forwardedArgs;
    execFileSync(process.execPath, [initFallbackPath, ...fallbackArgs], {
      stdio: 'inherit',
    });
    return;
  }

  try {
    execFileSync(process.execPath, [entryPath, ...dispatchTarget.forwardedArgs], {
      stdio: 'inherit',
    });
  } catch (error) {
    process.exit(error?.status ?? EXIT_CODE_ERROR);
  }
}

if (import.meta.main) {
  void main();
}
