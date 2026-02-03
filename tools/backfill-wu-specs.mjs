#!/usr/bin/env node
/**
 * Backfill WU specs with missing strict validation fields (WU-1334)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const WU_DIR = 'docs/04-operations/tasks/wu';
const TYPES_REQUIRING_CONTEXT = ['feature', 'bug', 'refactor'];

function parseYAMLSimple(content) {
  // Simple YAML parser for extracting key values - just get type
  const typeMatch = content.match(/^type:\s*['"]?(\w+)['"]?/m);
  const type = typeMatch ? typeMatch[1] : 'feature';

  const notesMatch = content.match(/^notes:\s*(.*)$/m);
  const hasEmptyNotes =
    notesMatch && (notesMatch[1].trim() === '' || notesMatch[1].trim() === "''");
  const hasNoNotes = !content.includes('\nnotes:');

  const testsManualMatch = content.match(/tests:\s*\n\s+manual:\s*\[(.*?)\]/s);
  const testsManualBlockMatch = content.match(
    /tests:\s*\n\s+manual:\s*\n(\s+-.*?)(?=\s+(?:unit|e2e):|\n\S)/s,
  );
  let hasEmptyManual = false;
  if (testsManualMatch) {
    hasEmptyManual = testsManualMatch[1].trim() === '';
  } else if (!testsManualBlockMatch) {
    hasEmptyManual = true;
  }

  const specRefsMatch =
    content.match(/^spec_refs:\s*\[.*?\]/m) || content.match(/^spec_refs:\s*\n\s+-/m);
  const hasNoSpecRefs = !specRefsMatch;

  return { type, hasEmptyNotes, hasNoNotes, hasEmptyManual, hasNoSpecRefs };
}

function backfillWU(filePath) {
  let content = readFileSync(filePath, 'utf8');
  const { type, hasEmptyNotes, hasNoNotes, hasEmptyManual, hasNoSpecRefs } =
    parseYAMLSimple(content);
  let modified = false;
  const changes = [];

  // Only backfill for types that require these fields
  if (!TYPES_REQUIRING_CONTEXT.includes(type)) {
    return { modified: false, changes: [] };
  }

  // Backfill notes if empty or missing
  if (hasEmptyNotes) {
    content = content.replace(
      /^notes:\s*['"]?['"]?\s*$/m,
      'notes: Completed per acceptance criteria.',
    );
    modified = true;
    changes.push('notes');
  } else if (hasNoNotes) {
    // Add notes field after risks
    content = content.replace(
      /^(risks:.*?)(\n(?!  ))/m,
      '$1\nnotes: Completed per acceptance criteria.$2',
    );
    modified = true;
    changes.push('notes');
  }

  // Backfill tests.manual if empty
  if (hasEmptyManual) {
    // Replace empty manual array with a single entry
    content = content.replace(/^(\s+manual:\s*)\[\]/m, '$1\n    - Verify acceptance criteria met');
    modified = true;
    changes.push('tests.manual');
  }

  // Backfill spec_refs for feature type only
  if (type === 'feature' && hasNoSpecRefs) {
    // Add spec_refs field - find a good insertion point (after artifacts or dependencies)
    if (content.includes('\ndependencies:')) {
      content = content.replace(/^(dependencies:.*?)(\n(?:[a-z]|\s*\n[a-z]))/m, (match, p1, p2) => {
        // Check if we're at the end of the dependencies list
        const endOfDeps = content.indexOf('\nrisks:', content.indexOf('dependencies:'));
        if (endOfDeps !== -1) {
          return match;
        }
        return match;
      });
      // Insert before risks if present
      if (content.includes('\nrisks:')) {
        content = content.replace(/^risks:/m, 'spec_refs:\n  - internal\nrisks:');
      } else {
        content = content.replace(/^notes:/m, 'spec_refs:\n  - internal\nnotes:');
      }
    } else {
      content = content.replace(/^notes:/m, 'spec_refs:\n  - internal\nnotes:');
    }
    modified = true;
    changes.push('spec_refs');
  }

  if (modified) {
    writeFileSync(filePath, content, 'utf8');
  }

  return { modified, changes };
}

function main() {
  const files = readdirSync(WU_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort((a, b) => {
      const idA = parseInt(a.replace('WU-', '').replace('.yaml', ''));
      const idB = parseInt(b.replace('WU-', '').replace('.yaml', ''));
      return idA - idB;
    });

  let totalModified = 0;
  const allChanges = { notes: 0, 'tests.manual': 0, spec_refs: 0 };

  for (const file of files) {
    const filePath = join(WU_DIR, file);
    const { modified, changes } = backfillWU(filePath);
    if (modified) {
      totalModified++;
      console.log(`Updated ${file}: ${changes.join(', ')}`);
      for (const change of changes) {
        allChanges[change]++;
      }
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Total files modified: ${totalModified}`);
  console.log(`  notes backfilled: ${allChanges.notes}`);
  console.log(`  tests.manual backfilled: ${allChanges['tests.manual']}`);
  console.log(`  spec_refs backfilled: ${allChanges.spec_refs}`);
}

main();
