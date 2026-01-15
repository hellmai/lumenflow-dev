import { describe, it, expect } from 'vitest';
import {
  classifyPath,
  PATH_TYPES,
  getRemediation,
  findHardcodedPathViolations,
} from '../hardcoded-strings.mjs';

describe('hardcoded-strings', () => {
  describe('PATH_TYPES', () => {
    it('should export path type constants', () => {
      expect(PATH_TYPES.ROUTE).toBe('route');
      expect(PATH_TYPES.FILESYSTEM).toBe('filesystem');
      expect(PATH_TYPES.UNKNOWN).toBe('unknown');
    });
  });

  describe('classifyPath', () => {
    describe('route paths', () => {
      it('should classify /api/* paths as route paths', () => {
        expect(classifyPath('/api/assistant/stream')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/api/v1/users')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/api/health')).toBe(PATH_TYPES.ROUTE);
      });

      it('should classify /auth/* paths as route paths', () => {
        expect(classifyPath('/auth/login')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/auth/callback/google')).toBe(PATH_TYPES.ROUTE);
      });

      it('should classify /v1/* and /v2/* versioned paths as route paths', () => {
        expect(classifyPath('/v1/widgets')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/v2/users/profile')).toBe(PATH_TYPES.ROUTE);
      });

      it('should classify /graphql paths as route paths', () => {
        expect(classifyPath('/graphql')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/graphql/playground')).toBe(PATH_TYPES.ROUTE);
      });

      it('should classify /webhook/* paths as route paths', () => {
        expect(classifyPath('/webhook/stripe')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/webhooks/github')).toBe(PATH_TYPES.ROUTE);
      });

      it('should classify /trpc/* paths as route paths', () => {
        expect(classifyPath('/trpc/user.create')).toBe(PATH_TYPES.ROUTE);
      });

      it('should classify paths with query parameters as route paths', () => {
        expect(classifyPath('/api/search?q=test')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/users/123?include=profile')).toBe(PATH_TYPES.ROUTE);
      });
    });

    describe('filesystem paths', () => {
      it('should classify /home/* paths as filesystem paths', () => {
        expect(classifyPath('/home/user/documents')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/home/tom/source/project')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify /usr/* paths as filesystem paths', () => {
        expect(classifyPath('/usr/local/bin')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/usr/share/doc')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify /etc/* paths as filesystem paths', () => {
        expect(classifyPath('/etc/nginx/nginx.conf')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/etc/hosts')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify /var/* paths as filesystem paths', () => {
        expect(classifyPath('/var/log/app.log')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/var/www/html')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify /tmp/* paths as filesystem paths', () => {
        expect(classifyPath('/tmp/upload-123')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/tmp/cache/data')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify /opt/* paths as filesystem paths', () => {
        expect(classifyPath('/opt/app/config')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify paths with file extensions as filesystem paths', () => {
        expect(classifyPath('/data/file.json')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/config/app.yaml')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/logs/error.log')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('/uploads/image.png')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify Windows-style paths as filesystem paths', () => {
        expect(classifyPath('C:/Users/tom/documents')).toBe(PATH_TYPES.FILESYSTEM);
        expect(classifyPath('D:/Projects/app')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should classify paths containing node_modules as filesystem paths', () => {
        expect(classifyPath('/project/node_modules/package')).toBe(PATH_TYPES.FILESYSTEM);
      });
    });

    describe('ambiguous paths', () => {
      it('should classify generic paths without clear indicators as unknown', () => {
        expect(classifyPath('/foo/bar/baz')).toBe(PATH_TYPES.UNKNOWN);
        expect(classifyPath('/something/else')).toBe(PATH_TYPES.UNKNOWN);
      });
    });

    describe('edge cases', () => {
      it('should handle paths with trailing slashes', () => {
        expect(classifyPath('/api/users/')).toBe(PATH_TYPES.ROUTE);
        expect(classifyPath('/home/user/')).toBe(PATH_TYPES.FILESYSTEM);
      });

      it('should handle empty strings', () => {
        expect(classifyPath('')).toBe(PATH_TYPES.UNKNOWN);
      });

      it('should handle root path', () => {
        expect(classifyPath('/')).toBe(PATH_TYPES.UNKNOWN);
      });
    });
  });

  describe('getRemediation', () => {
    it('should return route-specific message for route paths', () => {
      const message = getRemediation(PATH_TYPES.ROUTE);
      expect(message).toContain('endpoint constant');
      expect(message).not.toContain('path.join');
    });

    it('should return filesystem-specific message for filesystem paths', () => {
      const message = getRemediation(PATH_TYPES.FILESYSTEM);
      expect(message).toContain('path.join');
    });

    it('should return generic message for unknown paths', () => {
      const message = getRemediation(PATH_TYPES.UNKNOWN);
      expect(message).toContain('constant');
    });
  });

  describe('findHardcodedPathViolations', () => {
    it('should detect route path violations with route-specific message', () => {
      const line = "+  const url = '/api/assistant/stream';";
      const violations = findHardcodedPathViolations(line);
      expect(violations).toHaveLength(1);
      expect(violations[0].pathType).toBe(PATH_TYPES.ROUTE);
      expect(violations[0].fix).toContain('endpoint constant');
      expect(violations[0].fix).not.toContain('path.join');
    });

    it('should detect filesystem path violations with filesystem-specific message', () => {
      const line = "+  const configPath = '/home/user/config.json';";
      const violations = findHardcodedPathViolations(line);
      expect(violations).toHaveLength(1);
      expect(violations[0].pathType).toBe(PATH_TYPES.FILESYSTEM);
      expect(violations[0].fix).toContain('path.join');
    });

    it('should handle multiple path violations in one line', () => {
      const line = "+  fetch('/api/data', { config: '/etc/app.conf' });";
      const violations = findHardcodedPathViolations(line);
      expect(violations.length).toBeGreaterThanOrEqual(1);
    });

    it('should return empty array for lines without path violations', () => {
      const line = '+  const x = 42;';
      const violations = findHardcodedPathViolations(line);
      expect(violations).toHaveLength(0);
    });

    it('should not flag paths in constant definitions', () => {
      const line = "+  const API_ENDPOINT = '/api/assistant/stream';";
      const violations = findHardcodedPathViolations(line);
      expect(violations).toHaveLength(0);
    });

    it('should not flag paths in test files', () => {
      const line = "+  const testPath = '/api/test';";
      const violations = findHardcodedPathViolations(line, { isTestFile: true });
      expect(violations).toHaveLength(0);
    });

    it('should not flag paths in config files', () => {
      const line = "+  \"path\": \"/api/v1/endpoint\"";
      const violations = findHardcodedPathViolations(line, { isConfigFile: true });
      expect(violations).toHaveLength(0);
    });
  });
});
