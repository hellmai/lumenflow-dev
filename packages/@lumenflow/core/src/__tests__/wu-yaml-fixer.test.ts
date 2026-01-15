/**
 * WU YAML Auto-Fixer Tests
 *
 * Part of WU-1359: Early YAML validation at wu:claim
 *
 * @see {@link tools/lib/wu-yaml-fixer.mjs} - Implementation
 */

import assert from 'node:assert';
import { detectFixableIssues, applyFixes, FIXABLE_ISSUES } from '../wu-yaml-fixer.mjs';

// Test 1: Detect ISO timestamp in created field
function testDetectISOTimestamp() {
  const doc = {
    id: 'WU-1359',
    created: '2025-12-02T00:00:00.000Z',
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, FIXABLE_ISSUES.DATE_ISO_TIMESTAMP);
  assert.equal(issues[0].field, 'created');
  assert.equal(issues[0].suggested, '2025-12-02');
  console.log('✓ testDetectISOTimestamp passed');
}

// Test 2: Detect Date object in created field
function testDetectDateObject() {
  const doc = {
    id: 'WU-1359',
    created: new Date('2025-12-02T00:00:00.000Z'),
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, FIXABLE_ISSUES.DATE_ISO_TIMESTAMP);
  assert.equal(issues[0].field, 'created');
  assert.equal(issues[0].suggested, '2025-12-02');
  console.log('✓ testDetectDateObject passed');
}

// Test 3: No issue for valid YYYY-MM-DD date
function testValidDateFormat() {
  const doc = {
    id: 'WU-1359',
    created: '2025-12-02',
  };

  const issues = detectFixableIssues(doc);

  // Should not detect any date issues
  const dateIssues = issues.filter((i) => i.type === FIXABLE_ISSUES.DATE_ISO_TIMESTAMP);
  assert.equal(dateIssues.length, 0);
  console.log('✓ testValidDateFormat passed');
}

// Test 4: Detect username without email domain
function testDetectUsernameNotEmail() {
  const doc = {
    id: 'WU-1359',
    assigned_to: 'tom',
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, FIXABLE_ISSUES.USERNAME_NOT_EMAIL);
  assert.equal(issues[0].field, 'assigned_to');
  assert.equal(issues[0].suggested, 'tom@exampleapp.co.uk');
  console.log('✓ testDetectUsernameNotEmail passed');
}

// Test 5: No issue for valid email
function testValidEmail() {
  const doc = {
    id: 'WU-1359',
    assigned_to: 'tom@exampleapp.co.uk',
  };

  const issues = detectFixableIssues(doc);

  // Should not detect any email issues
  const emailIssues = issues.filter((i) => i.type === FIXABLE_ISSUES.USERNAME_NOT_EMAIL);
  assert.equal(emailIssues.length, 0);
  console.log('✓ testValidEmail passed');
}

// Test 6: Detect docs → documentation type alias
function testDetectTypeAlias() {
  const doc = {
    id: 'WU-1359',
    type: 'docs',
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, FIXABLE_ISSUES.TYPE_ALIAS);
  assert.equal(issues[0].field, 'type');
  assert.equal(issues[0].suggested, 'documentation');
  console.log('✓ testDetectTypeAlias passed');
}

// Test 7: Detect feat → feature type alias
function testDetectFeatTypeAlias() {
  const doc = {
    id: 'WU-1359',
    type: 'feat',
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, FIXABLE_ISSUES.TYPE_ALIAS);
  assert.equal(issues[0].field, 'type');
  assert.equal(issues[0].suggested, 'feature');
  console.log('✓ testDetectFeatTypeAlias passed');
}

// Test 8: Detect phase string → number
function testDetectPhaseString() {
  const doc = {
    id: 'WU-1359',
    phase: '3',
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, FIXABLE_ISSUES.PHASE_STRING);
  assert.equal(issues[0].field, 'phase');
  assert.equal(issues[0].suggested, 3);
  console.log('✓ testDetectPhaseString passed');
}

// Test 9: No issue for valid phase number
function testValidPhaseNumber() {
  const doc = {
    id: 'WU-1359',
    phase: 3,
  };

  const issues = detectFixableIssues(doc);

  // Should not detect any phase issues
  const phaseIssues = issues.filter((i) => i.type === FIXABLE_ISSUES.PHASE_STRING);
  assert.equal(phaseIssues.length, 0);
  console.log('✓ testValidPhaseNumber passed');
}

// Test 10: Detect lowercase priority
function testDetectLowercasePriority() {
  const doc = {
    id: 'WU-1359',
    priority: 'p1',
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].type, FIXABLE_ISSUES.PRIORITY_LOWERCASE);
  assert.equal(issues[0].field, 'priority');
  assert.equal(issues[0].suggested, 'P1');
  console.log('✓ testDetectLowercasePriority passed');
}

// Test 11: applyFixes modifies doc in place
function testApplyFixes() {
  const doc = {
    id: 'WU-1359',
    created: '2025-12-02T00:00:00.000Z',
    assigned_to: 'tom',
    type: 'docs',
    phase: '3',
    priority: 'p1',
  };

  const issues = detectFixableIssues(doc);
  const fixed = applyFixes(doc, issues);

  assert.equal(fixed, 5);
  assert.equal(doc.created, '2025-12-02');
  assert.equal(doc.assigned_to, 'tom@exampleapp.co.uk');
  assert.equal(doc.type, 'documentation');
  assert.equal(doc.phase, 3);
  assert.equal(doc.priority, 'P1');
  console.log('✓ testApplyFixes passed');
}

// Test 12: No issues detected for clean doc
function testCleanDoc() {
  const doc = {
    id: 'WU-1359',
    title: 'Test WU',
    lane: 'Operations: Tooling',
    type: 'feature',
    status: 'ready',
    priority: 'P1',
    created: '2025-12-02',
    description: 'This is a test description that is long enough to pass validation requirements.',
    acceptance: ['pnpm gates passes'],
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 0);
  console.log('✓ testCleanDoc passed');
}

// Test 13: Multiple issues detected at once
function testMultipleIssues() {
  const doc = {
    id: 'WU-1359',
    created: '2025-12-02T00:00:00.000Z',
    assigned_to: 'tom',
    type: 'docs',
  };

  const issues = detectFixableIssues(doc);

  assert.equal(issues.length, 3);
  const types = issues.map((i) => i.type);
  assert.ok(types.includes(FIXABLE_ISSUES.DATE_ISO_TIMESTAMP));
  assert.ok(types.includes(FIXABLE_ISSUES.USERNAME_NOT_EMAIL));
  assert.ok(types.includes(FIXABLE_ISSUES.TYPE_ALIAS));
  console.log('✓ testMultipleIssues passed');
}

// Run all tests
function runTests() {
  console.log('Running wu-yaml-fixer tests...\n');

  try {
    // Date handling tests
    testDetectISOTimestamp();
    testDetectDateObject();
    testValidDateFormat();

    // Email handling tests
    testDetectUsernameNotEmail();
    testValidEmail();

    // Type alias tests
    testDetectTypeAlias();
    testDetectFeatTypeAlias();

    // Phase handling tests
    testDetectPhaseString();
    testValidPhaseNumber();

    // Priority handling tests
    testDetectLowercasePriority();

    // Fix application tests
    testApplyFixes();

    // Clean doc test
    testCleanDoc();

    // Multiple issues test
    testMultipleIssues();

    console.log('\n✅ All 13 tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
