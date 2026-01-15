/**
 * DORA Metrics Constants
 *
 * Thresholds based on "Accelerate" research by Nicole Forsgren, Jez Humble, Gene Kim.
 *
 * @module @lumenflow/metrics/dora/constants
 */

/** Deployment frequency classification thresholds (deploys per week) */
export const DEPLOYMENT_FREQUENCY = {
  /** Elite: >5 deploys per week */
  ELITE: 5,
  /** High: 1-5 deploys per week */
  HIGH: 1,
  /** Medium: ~1 deploy per month (0.25/week) */
  MEDIUM: 0.25,
  // Low: <0.25 deploys per week (implicit)
} as const;

/** Lead time classification thresholds (hours) */
export const LEAD_TIME_HOURS = {
  /** Elite: <24 hours (<1 day) */
  ELITE: 24,
  /** High: <168 hours (<7 days) */
  HIGH: 168,
  /** Medium: <720 hours (<30 days) */
  MEDIUM: 720,
  // Low: >720 hours (implicit)
} as const;

/** Change failure rate classification thresholds (percentage) */
export const CFR_PERCENT = {
  /** Elite: <15% failures */
  ELITE: 15,
  /** High: 15-30% failures */
  HIGH: 30,
  /** Medium: 30-45% failures */
  MEDIUM: 45,
  // Low: >45% failures (implicit)
} as const;

/** Mean time to recovery classification thresholds (hours) */
export const MTTR_HOURS = {
  /** Elite: <1 hour */
  ELITE: 1,
  /** High: <24 hours (<1 day) */
  HIGH: 24,
  /** Medium: <168 hours (<7 days) */
  MEDIUM: 168,
  // Low: >168 hours (implicit)
} as const;

/** Statistical constants */
export const STATISTICS = {
  /** 90th percentile for p90Hours calculation */
  P90_PERCENTILE: 0.9,
  /** Decimal places for rounding (10 = 1 decimal place) */
  ROUNDING_FACTOR: 10,
  /** 95th percentile for p95 calculations */
  P95_PERCENTILE: 0.95,
  /** 99th percentile for p99 calculations */
  P99_PERCENTILE: 0.99,
  /** Median percentile */
  MEDIAN_PERCENTILE: 0.5,
  /** Milliseconds per hour */
  MS_PER_HOUR: 3600000,
  /** Percentage multiplier */
  PERCENTAGE_MULTIPLIER: 100,
} as const;
