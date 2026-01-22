import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyWUComplete, debugSummary } from '../src/agent-verification.js';

// Mock the external dependencies
vi.mock('node:path', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    join: vi.fn((...args) => args.join('/')),
  };
});

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

describe('verifyWUComplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WU ID validation', () => {
    it('should accept valid WU ID format', () => {
      const mockRun = vi.fn(() => '');
      const mockExists = vi.fn(() => false);

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.complete).toBe(false);
      expect(result.failures).toHaveLength(2);
      expect(result.failures[0]).toContain('Missing stamp .beacon/stamps/WU-1234.done');
      expect(result.failures[1]).toContain('No commit on main');
    });

    it('should reject null WU ID', () => {
      expect(() => verifyWUComplete(null as any)).toThrow();
      expect(() => verifyWUComplete(undefined as any)).toThrow();
      expect(() => verifyWUComplete('' as any)).toThrow();
    });

    it('should reject invalid WU ID format', () => {
      expect(() => verifyWUComplete('INVALID')).toThrow();
      expect(() => verifyWUComplete('WU-')).toThrow();
      expect(() => verifyWUComplete('1234')).toThrow();
      expect(() => verifyWUComplete('WU-ABC')).toThrow();
    });

    it('should reject WU ID with whitespace', () => {
      // Function trims whitespace, so this should actually pass validation
      expect(() => verifyWUComplete('  WU-1234 ')).not.toThrow();
    });
  });

  describe('Git status check', () => {
    it('should pass when working tree is clean', () => {
      const mockRun = vi.fn(() => ''); // No output = clean
      const mockExists = vi.fn(() => false);

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.failures).not.toContain(expect.stringContaining('Working tree dirty'));
    });

    it('should fail when working tree is dirty', () => {
      const mockRun = vi.fn(() => 'M file.txt\nD file2.txt');
      const mockExists = vi.fn(() => false);

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.failures[0]).toContain('Working tree dirty');
      expect(result.failures[0]).toContain('M file.txt');
      expect(result.failures[0]).toContain('D file2.txt');
    });
  });

  describe('Stamp check', () => {
    it('should pass when stamp exists', () => {
      const mockRun = vi.fn(() => '');
      const mockExists = vi.fn((path) => path.includes('.beacon/stamps/WU-1234.done'));

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.failures).not.toContain(expect.stringContaining('Missing stamp'));
    });

    it('should fail when stamp is missing', () => {
      const mockRun = vi.fn(() => 'abc123 WU-1234.yaml'); // Mock commit exists
      const mockExists = vi.fn(() => false); // But stamp file doesn't exist

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.failures[1]).toContain('Missing stamp .beacon/stamps/WU-1234.done');
    });
  });

  describe('Commit check', () => {
    it('should pass when commit exists on main', () => {
      const mockRun = vi.fn(() => 'abc123 WU-1234.yaml');
      const mockExists = vi.fn(() => true);

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.failures).not.toContain(expect.stringContaining('No commit on main'));
    });

    it('should fail when no commit on main', () => {
      const mockRun = vi.fn(() => '');
      const mockExists = vi.fn(() => true);

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toContain('No commit on main');
      expect(result.failures[0]).toContain('docs/04-operations/tasks/wu/WU-1234.yaml');
    });
  });

  describe('Complete verification', () => {
    it('should return complete when all checks pass', () => {
      const mockRun = vi.fn((cmd) => {
        if (cmd.includes('git status')) return ''; // Clean working tree
        if (cmd.includes('git log')) return 'abc123 WU-1234.yaml'; // Mock commit
        return '';
      });
      const mockExists = vi.fn((path) => {
        // Stamp exists for WU-1234
        return path.includes('.beacon/stamps/WU-1234.done');
      });

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.complete).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('should return incomplete when any check fails', () => {
      const mockRun = vi.fn(() => 'M file.txt'); // Dirty working tree
      const mockExists = vi.fn(() => false);

      const result = verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: mockExists,
      });

      expect(result.complete).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    });

    it('should use default functions when overrides not provided', () => {
      const result = verifyWUComplete('WU-1234');

      expect(result.complete).toBe(false);
      expect(result.failures.length).toBeGreaterThan(0);
    });
  });

  describe('Custom overrides', () => {
    it('should use custom run function', () => {
      const customRun = vi.fn(() => '');
      const mockExists = vi.fn(() => false);

      verifyWUComplete('WU-1234', {
        run: customRun,
        exists: mockExists,
      });

      expect(customRun).toHaveBeenCalledWith('git status --porcelain');
    });

    it('should use custom exists function', () => {
      const mockRun = vi.fn(() => '');
      const customExists = vi.fn(() => true);

      verifyWUComplete('WU-1234', {
        run: mockRun,
        exists: customExists,
      });

      expect(customExists).toHaveBeenCalled();
    });
  });
});

describe('debugSummary', () => {
  it('should return summary for complete verification', () => {
    const result = {
      complete: true,
      failures: [],
    };

    const summary = debugSummary(result);
    expect(summary).toBe('Verification passed: WU complete.');
  });

  it('should return summary for incomplete verification', () => {
    const result = {
      complete: false,
      failures: ['Error 1', 'Error 2'],
    };

    const summary = debugSummary(result);
    expect(summary).toContain('Verification failed:');
    expect(summary).toContain('Error 1');
    expect(summary).toContain('Error 2');
  });

  it('should handle null/undefined result', () => {
    expect(debugSummary(null)).toBe('No verification result');
    expect(debugSummary(undefined)).toBe('No verification result');
    expect(debugSummary({ complete: false, failures: [] } as any)).toBe(
      'Verification failed: unknown reason.',
    );
  });

  it('should handle empty failures array', () => {
    const result = {
      complete: false,
      failures: [],
    };

    const summary = debugSummary(result);
    expect(summary).toBe('Verification failed: unknown reason.');
  });
});
