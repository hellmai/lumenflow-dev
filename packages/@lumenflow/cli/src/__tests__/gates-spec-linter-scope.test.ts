import { describe, it, expect } from 'vitest';
import { parseWUFromBranchName, resolveSpecLinterPlan } from '../gates.js';

describe('gates spec:linter scoping (WU-1614)', () => {
  describe('parseWUFromBranchName', () => {
    it('extracts WU ID from lane branch name', () => {
      expect(parseWUFromBranchName('lane/framework-cli-wu-commands/wu-1614')).toBe('WU-1614');
    });

    it('returns null for non-WU branches', () => {
      expect(parseWUFromBranchName('main')).toBeNull();
      expect(parseWUFromBranchName('master')).toBeNull();
      expect(parseWUFromBranchName('feature/something')).toBeNull();
    });
  });

  describe('resolveSpecLinterPlan', () => {
    it('runs scoped validation only when current WU is detected', () => {
      expect(resolveSpecLinterPlan('WU-1614')).toEqual({
        scopedWuId: 'WU-1614',
        runGlobal: false,
      });
    });

    it('falls back to global validation only when no current WU is detected', () => {
      expect(resolveSpecLinterPlan(null)).toEqual({
        scopedWuId: null,
        runGlobal: true,
      });
    });
  });
});
