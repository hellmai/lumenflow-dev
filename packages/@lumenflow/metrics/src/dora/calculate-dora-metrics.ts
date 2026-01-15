/**
 * Calculate DORA metrics from git commits, skip-gates audit, and WU data
 *
 * Application layer: Business logic for DORA metrics calculation
 * Based on "Accelerate" research by Nicole Forsgren, Jez Humble, Gene Kim
 *
 * @module @lumenflow/metrics/dora
 */

import { quantile } from 'simple-statistics';
import type {
  DORAStatusTier,
  DORAMetrics,
  DeploymentFrequencyMetrics,
  LeadTimeMetrics,
  ChangeFailureRateMetrics,
  MTTRMetrics,
  WUMetrics,
  GitCommit,
  SkipGatesEntry,
} from '../types.js';
import {
  DEPLOYMENT_FREQUENCY,
  LEAD_TIME_HOURS,
  CFR_PERCENT,
  MTTR_HOURS,
  STATISTICS,
} from './constants.js';

/**
 * Round to one decimal place using STATISTICS.ROUNDING_FACTOR
 */
function roundToOneDecimal(value: number): number {
  return Math.round(value * STATISTICS.ROUNDING_FACTOR) / STATISTICS.ROUNDING_FACTOR;
}

/**
 * Classify deployment frequency status
 */
function classifyDeploymentFrequency(deploysPerWeek: number): DORAStatusTier {
  if (deploysPerWeek > DEPLOYMENT_FREQUENCY.ELITE) return 'elite';
  if (deploysPerWeek >= DEPLOYMENT_FREQUENCY.HIGH) return 'high';
  if (deploysPerWeek >= DEPLOYMENT_FREQUENCY.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Classify lead time status
 */
function classifyLeadTime(averageHours: number): DORAStatusTier {
  if (averageHours < LEAD_TIME_HOURS.ELITE) return 'elite';
  if (averageHours < LEAD_TIME_HOURS.HIGH) return 'high';
  if (averageHours < LEAD_TIME_HOURS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Classify change failure rate status
 */
function classifyCFR(failurePercentage: number): DORAStatusTier {
  if (failurePercentage < CFR_PERCENT.ELITE) return 'elite';
  if (failurePercentage < CFR_PERCENT.HIGH) return 'high';
  if (failurePercentage < CFR_PERCENT.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Classify MTTR status
 */
function classifyMTTR(averageHours: number): DORAStatusTier {
  if (averageHours === 0 || averageHours < MTTR_HOURS.ELITE) return 'elite';
  if (averageHours < MTTR_HOURS.HIGH) return 'high';
  if (averageHours < MTTR_HOURS.MEDIUM) return 'medium';
  return 'low';
}

/**
 * Calculate deployment frequency from git commits
 */
export function calculateDeploymentFrequency(
  commits: GitCommit[],
  weekStart: Date,
  weekEnd: Date
): DeploymentFrequencyMetrics {
  const weekCommits = commits.filter(
    (c) => c.timestamp >= weekStart && c.timestamp <= weekEnd
  );

  const deploysPerWeek = weekCommits.length;
  const status = classifyDeploymentFrequency(deploysPerWeek);

  return { deploysPerWeek, status };
}

/**
 * Calculate lead time for changes from WU metrics
 */
export function calculateLeadTime(wuMetrics: WUMetrics[]): LeadTimeMetrics {
  const cycleTimes = wuMetrics
    .map((wu) => wu.cycleTimeHours)
    .filter((t): t is number => typeof t === 'number');

  if (cycleTimes.length === 0) {
    return {
      averageHours: 0,
      medianHours: 0,
      p90Hours: 0,
      status: 'low',
    };
  }

  const averageHours = cycleTimes.reduce((sum, t) => sum + t, 0) / cycleTimes.length;
  const medianHours = quantile(cycleTimes, STATISTICS.MEDIAN_PERCENTILE);
  const p90Hours = quantile(cycleTimes, STATISTICS.P90_PERCENTILE);

  const status = classifyLeadTime(averageHours);

  return {
    averageHours: roundToOneDecimal(averageHours),
    medianHours: roundToOneDecimal(medianHours),
    p90Hours: roundToOneDecimal(p90Hours),
    status,
  };
}

/**
 * Calculate change failure rate from skip-gates audit and commits
 */
export function calculateCFR(
  commits: GitCommit[],
  skipGatesEntries: SkipGatesEntry[]
): ChangeFailureRateMetrics {
  const totalDeployments = commits.length;
  const failures = skipGatesEntries.length;

  const failurePercentage =
    totalDeployments > 0
      ? (failures / totalDeployments) * STATISTICS.PERCENTAGE_MULTIPLIER
      : 0;

  const status = classifyCFR(failurePercentage);

  return {
    failurePercentage: roundToOneDecimal(failurePercentage),
    totalDeployments,
    failures,
    status,
  };
}

/**
 * Identify emergency fix commits from conventional commit messages
 */
export function identifyEmergencyFixes(commits: GitCommit[]): GitCommit[] {
  return commits.filter(
    (c) => c.message.includes('EMERGENCY') || /fix\(EMERGENCY\)/.test(c.message)
  );
}

/**
 * Calculate average recovery time from emergency fix pairs
 */
function calculateRecoveryTime(emergencyFixes: GitCommit[]): number {
  let totalRecoveryTimeMs = 0;
  let pairCount = 0;

  for (let i = 0; i < emergencyFixes.length - 1; i += 2) {
    const startFix = emergencyFixes.at(i);
    const endFix = emergencyFixes.at(i + 1);
    if (startFix && endFix) {
      totalRecoveryTimeMs += endFix.timestamp.getTime() - startFix.timestamp.getTime();
      pairCount++;
    }
  }

  if (pairCount === 0) return 0;
  return totalRecoveryTimeMs / (STATISTICS.MS_PER_HOUR * pairCount);
}

/**
 * Calculate mean time to recovery from emergency fix commits
 */
export function calculateMTTR(commits: GitCommit[]): MTTRMetrics {
  const emergencyFixes = identifyEmergencyFixes(commits);

  if (emergencyFixes.length === 0) {
    return {
      averageHours: 0,
      incidents: 0,
      status: 'elite',
    };
  }

  const incidents = Math.floor(emergencyFixes.length / 2);

  if (incidents === 0) {
    return {
      averageHours: 0,
      incidents: emergencyFixes.length,
      status: 'elite',
    };
  }

  const averageHours = calculateRecoveryTime(emergencyFixes);
  const status = classifyMTTR(averageHours);

  return {
    averageHours: roundToOneDecimal(averageHours),
    incidents,
    status,
  };
}

/**
 * Calculate all DORA metrics
 */
export function calculateDORAMetrics(
  commits: GitCommit[],
  skipGatesEntries: SkipGatesEntry[],
  wuMetrics: WUMetrics[],
  weekStart: Date,
  weekEnd: Date
): DORAMetrics {
  return {
    deploymentFrequency: calculateDeploymentFrequency(commits, weekStart, weekEnd),
    leadTimeForChanges: calculateLeadTime(wuMetrics),
    changeFailureRate: calculateCFR(commits, skipGatesEntries),
    meanTimeToRecovery: calculateMTTR(commits),
  };
}
