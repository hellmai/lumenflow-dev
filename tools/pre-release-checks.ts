import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const CLI_PKG_PATH = 'packages/@lumenflow/cli/package.json';
const CLI_README_PATH = 'packages/@lumenflow/cli/README.md';
const TEMPLATES_DIR = 'packages/@lumenflow/cli/templates';
const execFileAsync = promisify(execFile);

type StrictProgressRunner = () => Promise<void>;

interface ValidatePreReleaseOptions {
  runStrictProgress?: StrictProgressRunner;
}

async function runStrictProgressDefault(): Promise<void> {
  const pnpmExecutable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  await execFileAsync(pnpmExecutable, ['strict:progress'], {
    cwd: process.cwd(),
    env: process.env,
  });
}

export async function validatePreRelease(
  options: ValidatePreReleaseOptions = {},
): Promise<void> {
  const runStrictProgress = options.runStrictProgress ?? runStrictProgressDefault;

  try {
    await runStrictProgress();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Strict progress check failed: ${message}`);
  }

  // 1. Read package.json
  const pkgContent = await fs.readFile(path.resolve(process.cwd(), CLI_PKG_PATH), 'utf-8');
  const pkg = JSON.parse(pkgContent);

  // 2. Read README.md
  const readmeContent = await fs.readFile(path.resolve(process.cwd(), CLI_README_PATH), 'utf-8');

  // 3. Check bin entries
  const binEntries = Object.keys(pkg.bin || {});
  const missingBin = [];

  for (const bin of binEntries) {
    // Check if bin name appears in README (simple check)
    // We can be strict or loose. "verify each exists in README.md"
    // Using simple string inclusion for now.
    if (!readmeContent.includes(bin)) {
      missingBin.push(bin);
    }
  }

  if (missingBin.length > 0) {
    throw new Error(`Missing documentation for bin entry: ${missingBin.join(', ')}`);
  }

  // 4. Check templates
  let templatesExist = false;
  try {
    const stat = await fs.stat(path.resolve(process.cwd(), TEMPLATES_DIR));
    templatesExist = stat.isDirectory();
  } catch (e) {
    // templates dir does not exist
    templatesExist = false;
  }

  if (templatesExist) {
    const files = pkg.files || [];
    if (!files.includes('templates')) {
      throw new Error(
        `'templates' directory exists in ${TEMPLATES_DIR} but is not included in 'files' array in package.json`,
      );
    }
  }
}

// Allow running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  validatePreRelease().catch((err) => {
    console.error('Pre-release check failed:', err.message);
    process.exit(1);
  });
}
