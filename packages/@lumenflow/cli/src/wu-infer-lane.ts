#!/usr/bin/env node
/**
 * WU Lane Inference CLI (WU-908)
 *
 * Suggests sub-lane for a WU based on code paths and description.
 * Wrapper around lib/lane-inference.ts for standalone CLI usage.
 *
 * Usage:
 *   # Infer from existing WU
 *   node tools/wu-infer-lane.ts --id WU-123
 *
 *   # Infer from manual inputs
 *   node tools/wu-infer-lane.ts --paths "tools/**" "docs/**" --desc "Tooling improvements"
 *
 * Returns suggested lane and confidence score (0-100).
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { inferSubLane } from '@lumenflow/core/lane-inference';
import { die } from '@lumenflow/core/error-handler';
import { FILE_SYSTEM, EXIT_CODES } from '@lumenflow/core/wu-constants';
import { WU_PATHS } from '@lumenflow/core/wu-paths';

function parseArgs(argv) {
  const args = { paths: [], desc: '', id: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') {
      args.id = argv[++i];
    } else if (a === '--paths') {
      // Collect all following non-flag args as paths
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.paths.push(argv[++i]);
      }
    } else if (a === '--desc' || a === '--description') {
      args.desc = argv[++i];
    } else if (a === '--help' || a === '-h') {
      console.log(`
wu-infer-lane — Suggest sub-lane for a WU

Usage:
  # Infer from existing WU
  wu-infer-lane --id WU-123

  # Infer from manual inputs
  wu-infer-lane --paths "tools/**" "docs/**" --desc "Tooling improvements"

Options:
  --id <WU-ID>              WU ID to analyze (reads YAML)
  --paths <path1> <path2>   Code paths (can specify multiple)
  --desc <description>      WU description/title text
  --help, -h                Show this help
`);
      process.exit(EXIT_CODES.SUCCESS);
    } else {
      die(`Unknown argument: ${a}\n\nRun with --help for usage.`);
    }
  }
  return args;
}

interface WUYamlDoc {
  code_paths?: string[];
  description?: string;
  title?: string;
  [key: string]: unknown;
}

function loadWuYaml(id: string): WUYamlDoc {
  // WU-1301: Use config-based paths instead of hardcoded path
  const wuPath = path.join(process.cwd(), WU_PATHS.WU(id));
  if (!existsSync(wuPath)) {
    die(
      `WU file not found: ${wuPath}\n\n` +
        `Options:\n` +
        `  1. Create the WU first: pnpm wu:create --id ${id} --lane "<lane>" --title "..."\n` +
        `  2. Use --paths and --desc for manual inference without a WU file`,
    );
  }

  let content;
  try {
    content = readFileSync(wuPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  } catch (err) {
    die(
      `Failed to read WU file: ${wuPath}\n\n` +
        `Error: ${err.message}\n\n` +
        `Options:\n` +
        `  1. Check file permissions: ls -la ${wuPath}\n` +
        `  2. Ensure you have read access to the repository`,
    );
  }

  try {
    const doc = parseYAML(content) as WUYamlDoc;
    return doc;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    die(
      `Failed to parse WU YAML: ${wuPath}\n\n` +
        `Error: ${errorMessage}\n\n` +
        `Options:\n` +
        `  1. Validate YAML syntax: pnpm wu:validate --id ${id}\n` +
        `  2. Fix YAML errors manually and retry`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);

  let codePaths = [];
  let description = '';

  if (args.id) {
    // Load from WU YAML
    const wu = loadWuYaml(args.id);
    codePaths = wu.code_paths || [];
    description = wu.description || wu.title || '';

    console.log(`[wu-infer-lane] Analyzing ${args.id}...`);
  } else if (args.paths.length > 0 || args.desc) {
    // Use manual inputs
    codePaths = args.paths;
    description = args.desc;

    if (codePaths.length === 0 && !description) {
      die('Must provide either --id or --paths/--desc\n\nRun with --help for usage.');
    }
  } else {
    die('Must provide either --id or --paths/--desc\n\nRun with --help for usage.');
  }

  // Run inference
  try {
    const { lane, confidence } = inferSubLane(codePaths, description);

    console.log(`\nSuggested lane: ${lane}`);
    console.log(`Confidence: ${confidence}%`);

    if (confidence < 30) {
      console.log(
        '\n⚠️  Low confidence. Consider adding more code_paths or keywords to WU description.',
      );
    }
  } catch (err) {
    die(`Lane inference failed: ${err.message}`);
  }
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  runCLI(main);
}
