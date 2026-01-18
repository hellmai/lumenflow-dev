import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkSubscription,
  incrementUsage,
  getUsageStats,
  setSubscriptionTier,
  resetUsageForTesting,
  TIERS,
} from '../billing.js';

describe('billing', () => {
  beforeEach(() => {
    resetUsageForTesting();
  });

  describe('TIERS', () => {
    it('should have correct free tier limits', () => {
      expect(TIERS.free.wusPerMonth).toBe(10);
      expect(TIERS.free.price).toBe(0);
    });

    it('should have correct team tier limits', () => {
      expect(TIERS.team.wusPerMonth).toBe(100);
      expect(TIERS.team.price).toBe(29);
    });

    it('should have correct business tier limits', () => {
      expect(TIERS.business.wusPerMonth).toBe(500);
      expect(TIERS.business.price).toBe(99);
    });

    it('should have unlimited enterprise tier', () => {
      expect(TIERS.enterprise.wusPerMonth).toBe(Infinity);
    });
  });

  describe('checkSubscription', () => {
    it('should return free tier by default', async () => {
      const sub = await checkSubscription(12345);
      expect(sub.tier).toBe('free');
      expect(sub.active).toBe(true);
      expect(sub.wusRemaining).toBe(10);
    });

    it('should return team tier when set', async () => {
      await setSubscriptionTier(12345, 'team');
      const sub = await checkSubscription(12345);
      expect(sub.tier).toBe('team');
      expect(sub.wusRemaining).toBe(100);
    });

    it('should decrease remaining after usage', async () => {
      const installationId = 12345;
      await incrementUsage(installationId);
      await incrementUsage(installationId);

      const sub = await checkSubscription(installationId);
      expect(sub.wusRemaining).toBe(8); // 10 - 2
    });
  });

  describe('incrementUsage', () => {
    it('should increment usage counter', async () => {
      const installationId = 99999;

      let stats = await getUsageStats(installationId);
      expect(stats.wusThisMonth).toBe(0);

      await incrementUsage(installationId);
      stats = await getUsageStats(installationId);
      expect(stats.wusThisMonth).toBe(1);

      await incrementUsage(installationId);
      stats = await getUsageStats(installationId);
      expect(stats.wusThisMonth).toBe(2);
    });
  });

  describe('getUsageStats', () => {
    it('should return zero usage for new installation', async () => {
      const stats = await getUsageStats(11111);
      expect(stats.wusThisMonth).toBe(0);
      expect(stats.wusLimit).toBe(10); // free tier default
      expect(stats.percentUsed).toBe(0);
    });

    it('should calculate percent used correctly', async () => {
      const installationId = 22222;

      // Use 5 out of 10 (free tier)
      for (let i = 0; i < 5; i++) {
        await incrementUsage(installationId);
      }

      const stats = await getUsageStats(installationId);
      expect(stats.wusThisMonth).toBe(5);
      expect(stats.percentUsed).toBe(50);
    });

    it('should respect tier limits', async () => {
      const installationId = 33333;
      await setSubscriptionTier(installationId, 'team');

      const stats = await getUsageStats(installationId);
      expect(stats.wusLimit).toBe(100);
    });
  });

  describe('rate limiting', () => {
    it('should show 0 remaining when limit exceeded', async () => {
      const installationId = 44444;

      // Exceed free tier limit
      for (let i = 0; i < 12; i++) {
        await incrementUsage(installationId);
      }

      const sub = await checkSubscription(installationId);
      expect(sub.wusRemaining).toBe(0); // clamped to 0, not negative
    });

    it('should allow more usage on higher tiers', async () => {
      const installationId = 55555;
      await setSubscriptionTier(installationId, 'business');

      // Use 50 gates (would exceed free tier)
      for (let i = 0; i < 50; i++) {
        await incrementUsage(installationId);
      }

      const sub = await checkSubscription(installationId);
      expect(sub.wusRemaining).toBe(450); // 500 - 50
    });
  });
});
