/**
 * @file wu-edit.test.ts
 * Test suite for wu:edit exposure editing on done WUs (WU-1039)
 *
 * Tests the --exposure flag behavior on done WUs:
 * - Exposure edits are allowed on done WUs
 * - Other edits (description, acceptance, code_paths) are blocked on done WUs
 * - Exposure values are validated against WU_EXPOSURE_VALUES schema
 */

import { describe, it, expect } from 'vitest';

// Import the functions we're testing from dist (built files)
import {
    validateDoneWUEdits,
    validateExposureValue,
    applyExposureEdit,
} from '../dist/wu-edit.js';
import { WU_EXPOSURE_VALUES } from '@lumenflow/core/dist/wu-constants.js';

describe('wu:edit --exposure on done WUs (WU-1039)', () => {
    describe('validateDoneWUEdits', () => {
        it('should allow --exposure on done WUs', () => {
            const opts = { exposure: 'api' };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(true);
            expect(result.disallowedEdits).toHaveLength(0);
        });

        it('should allow --initiative on done WUs', () => {
            const opts = { initiative: 'INIT-001' };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(true);
            expect(result.disallowedEdits).toHaveLength(0);
        });

        it('should allow --phase on done WUs', () => {
            const opts = { phase: '2' };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(true);
            expect(result.disallowedEdits).toHaveLength(0);
        });

        it('should reject --description on done WUs', () => {
            const opts = { description: 'new description' };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(false);
            expect(result.disallowedEdits).toContain('--description');
        });

        it('should reject --acceptance on done WUs', () => {
            const opts = { acceptance: ['new criterion'] };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(false);
            expect(result.disallowedEdits).toContain('--acceptance');
        });

        it('should reject --code-paths on done WUs', () => {
            const opts = { codePaths: ['new/path.ts'] };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(false);
            expect(result.disallowedEdits).toContain('--code-paths');
        });

        it('should reject --lane on done WUs', () => {
            const opts = { lane: 'New: Lane' };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(false);
            expect(result.disallowedEdits).toContain('--lane');
        });

        it('should reject --type on done WUs', () => {
            const opts = { type: 'bug' };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(false);
            expect(result.disallowedEdits).toContain('--type');
        });

        it('should reject --spec-file on done WUs', () => {
            const opts = { specFile: '/path/to/spec.yaml' };
            const result = validateDoneWUEdits(opts);

            expect(result.valid).toBe(false);
            expect(result.disallowedEdits).toContain('--spec-file');
        });
    });

    describe('validateExposureValue', () => {
        it('should accept valid exposure value: ui', () => {
            const result = validateExposureValue('ui');
            expect(result.valid).toBe(true);
        });

        it('should accept valid exposure value: api', () => {
            const result = validateExposureValue('api');
            expect(result.valid).toBe(true);
        });

        it('should accept valid exposure value: backend-only', () => {
            const result = validateExposureValue('backend-only');
            expect(result.valid).toBe(true);
        });

        it('should accept valid exposure value: documentation', () => {
            const result = validateExposureValue('documentation');
            expect(result.valid).toBe(true);
        });

        it('should reject invalid exposure value', () => {
            const result = validateExposureValue('invalid-value');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('Invalid exposure value');
            // Should list valid values in error
            expect(result.error).toContain('ui');
            expect(result.error).toContain('api');
        });

        it('should use WU_EXPOSURE_VALUES for validation', () => {
            // Verify all WU_EXPOSURE_VALUES are accepted
            for (const exposure of WU_EXPOSURE_VALUES) {
                const result = validateExposureValue(exposure);
                expect(result.valid).toBe(true);
            }
        });
    });

    describe('applyExposureEdit', () => {
        it('should update exposure field on WU object', () => {
            const wu = { id: 'WU-1038', exposure: 'backend-only', status: 'done' };
            const result = applyExposureEdit(wu, 'api');

            expect(result.exposure).toBe('api');
            expect(result.id).toBe('WU-1038');
            expect(result.status).toBe('done');
        });

        it('should not mutate original WU object', () => {
            const wu = { id: 'WU-1038', exposure: 'backend-only', status: 'done' };
            const result = applyExposureEdit(wu, 'api');

            expect(wu.exposure).toBe('backend-only');
            expect(result.exposure).toBe('api');
        });
    });
});
