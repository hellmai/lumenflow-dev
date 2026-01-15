import { describe, it, expect } from 'vitest';
import {
  DEPLOYMENT_FREQUENCY,
  LEAD_TIME_HOURS,
  CFR_PERCENT,
  MTTR_HOURS,
  STATISTICS,
} from '../dora-constants.mjs';

describe('dora-constants', () => {
  describe('DEPLOYMENT_FREQUENCY', () => {
    it('has elite > high > medium ordering', () => {
      expect(DEPLOYMENT_FREQUENCY.ELITE).toBeGreaterThan(DEPLOYMENT_FREQUENCY.HIGH);
      expect(DEPLOYMENT_FREQUENCY.HIGH).toBeGreaterThan(DEPLOYMENT_FREQUENCY.MEDIUM);
    });

    it('has all positive values', () => {
      expect(DEPLOYMENT_FREQUENCY.ELITE).toBeGreaterThan(0);
      expect(DEPLOYMENT_FREQUENCY.HIGH).toBeGreaterThan(0);
      expect(DEPLOYMENT_FREQUENCY.MEDIUM).toBeGreaterThan(0);
    });
  });

  describe('LEAD_TIME_HOURS', () => {
    it('has elite < high < medium ordering (shorter is better)', () => {
      expect(LEAD_TIME_HOURS.ELITE).toBeLessThan(LEAD_TIME_HOURS.HIGH);
      expect(LEAD_TIME_HOURS.HIGH).toBeLessThan(LEAD_TIME_HOURS.MEDIUM);
    });

    it('has all positive values', () => {
      expect(LEAD_TIME_HOURS.ELITE).toBeGreaterThan(0);
      expect(LEAD_TIME_HOURS.HIGH).toBeGreaterThan(0);
      expect(LEAD_TIME_HOURS.MEDIUM).toBeGreaterThan(0);
    });

    it('has reasonable values (hours)', () => {
      expect(LEAD_TIME_HOURS.ELITE).toBeLessThanOrEqual(24); // Max 1 day for elite
      expect(LEAD_TIME_HOURS.MEDIUM).toBeLessThanOrEqual(720); // Max 30 days for medium
    });
  });

  describe('CFR_PERCENT', () => {
    it('has elite < high < medium ordering (lower is better)', () => {
      expect(CFR_PERCENT.ELITE).toBeLessThan(CFR_PERCENT.HIGH);
      expect(CFR_PERCENT.HIGH).toBeLessThan(CFR_PERCENT.MEDIUM);
    });

    it('has all values between 0 and 100', () => {
      expect(CFR_PERCENT.ELITE).toBeGreaterThan(0);
      expect(CFR_PERCENT.ELITE).toBeLessThan(100);
      expect(CFR_PERCENT.HIGH).toBeGreaterThan(0);
      expect(CFR_PERCENT.HIGH).toBeLessThan(100);
      expect(CFR_PERCENT.MEDIUM).toBeGreaterThan(0);
      expect(CFR_PERCENT.MEDIUM).toBeLessThan(100);
    });
  });

  describe('MTTR_HOURS', () => {
    it('has elite < high < medium ordering (faster is better)', () => {
      expect(MTTR_HOURS.ELITE).toBeLessThan(MTTR_HOURS.HIGH);
      expect(MTTR_HOURS.HIGH).toBeLessThan(MTTR_HOURS.MEDIUM);
    });

    it('has all positive values', () => {
      expect(MTTR_HOURS.ELITE).toBeGreaterThan(0);
      expect(MTTR_HOURS.HIGH).toBeGreaterThan(0);
      expect(MTTR_HOURS.MEDIUM).toBeGreaterThan(0);
    });
  });

  describe('STATISTICS', () => {
    it('has P90 percentile between 0 and 1', () => {
      expect(STATISTICS.P90_PERCENTILE).toBeGreaterThan(0);
      expect(STATISTICS.P90_PERCENTILE).toBeLessThan(1);
    });

    it('has positive rounding factor', () => {
      expect(STATISTICS.ROUNDING_FACTOR).toBeGreaterThan(0);
    });
  });
});
