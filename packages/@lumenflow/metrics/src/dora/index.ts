/**
 * DORA Metrics Module
 *
 * Calculate DORA metrics (Deployment Frequency, Lead Time, Change Failure Rate, MTTR)
 * based on "Accelerate" research.
 *
 * @module @lumenflow/metrics/dora
 */

export {
  calculateDeploymentFrequency,
  calculateLeadTime,
  calculateCFR,
  calculateMTTR,
  calculateDORAMetrics,
  identifyEmergencyFixes,
} from './calculate-dora-metrics.js';

export {
  DEPLOYMENT_FREQUENCY,
  LEAD_TIME_HOURS,
  CFR_PERCENT,
  MTTR_HOURS,
  STATISTICS,
} from './constants.js';
