/**
 * @file wu-create-readiness.ts
 * @description Readiness summary display for wu:create command (WU-1651)
 *
 * Extracted from wu-create.ts to isolate the post-create readiness UI
 * that shows whether a WU is ready for wu:claim.
 */

import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { readWU } from '@lumenflow/core/wu-yaml';
import { validateSpecCompleteness } from '@lumenflow/core/wu-done-validators';
import { READINESS_UI } from '@lumenflow/core/wu-constants';

/** Log prefix for console output */
const LOG_PREFIX = '[wu:create]';

/**
 * WU-1620: Display readiness summary after create/edit
 *
 * Shows whether WU is ready for wu:claim based on spec completeness.
 * Non-blocking - just informational to help agents understand what's missing.
 *
 * @param {string} id - WU ID
 */
export function displayReadinessSummary(id: string) {
  try {
    const wuPath = WU_PATHS.WU(id);
    const wuDoc = readWU(wuPath, id);

    const { valid, errors } = validateSpecCompleteness(wuDoc, id);

    const {
      BOX,
      BOX_WIDTH,
      MESSAGES,
      ERROR_MAX_LENGTH,
      ERROR_TRUNCATE_LENGTH,
      TRUNCATION_SUFFIX,
      PADDING,
    } = READINESS_UI;

    console.log(`\n${BOX.TOP_LEFT}${BOX.HORIZONTAL.repeat(BOX_WIDTH)}${BOX.TOP_RIGHT}`);
    if (valid) {
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.READY_YES}${''.padEnd(PADDING.READY_YES)}${BOX.VERTICAL}`,
      );
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      const claimCmd = `Run: pnpm wu:claim --id ${id}`;
      console.log(
        `${BOX.VERTICAL} ${claimCmd}${''.padEnd(BOX_WIDTH - claimCmd.length - 1)}${BOX.VERTICAL}`,
      );
    } else {
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.READY_NO}${''.padEnd(PADDING.READY_NO)}${BOX.VERTICAL}`,
      );
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      console.log(
        `${BOX.VERTICAL} ${MESSAGES.MISSING_HEADER}${''.padEnd(PADDING.MISSING_HEADER)}${BOX.VERTICAL}`,
      );
      for (const error of errors) {
        // Truncate long error messages to fit box
        const truncated =
          error.length > ERROR_MAX_LENGTH
            ? `${error.substring(0, ERROR_TRUNCATE_LENGTH)}${TRUNCATION_SUFFIX}`
            : error;
        console.log(
          `${BOX.VERTICAL}   ${MESSAGES.BULLET} ${truncated}${''.padEnd(Math.max(0, PADDING.ERROR_BULLET - truncated.length))}${BOX.VERTICAL}`,
        );
      }
      console.log(`${BOX.VERTICAL}${''.padEnd(BOX_WIDTH)}${BOX.VERTICAL}`);
      const editCmd = `Run: pnpm wu:edit --id ${id} --help`;
      console.log(
        `${BOX.VERTICAL} ${editCmd}${''.padEnd(BOX_WIDTH - editCmd.length - 1)}${BOX.VERTICAL}`,
      );
    }
    console.log(`${BOX.BOTTOM_LEFT}${BOX.HORIZONTAL.repeat(BOX_WIDTH)}${BOX.BOTTOM_RIGHT}`);
  } catch (err) {
    // Non-blocking - if validation fails, just warn
    console.warn(`${LOG_PREFIX} Could not validate readiness: ${err.message}`);
  }
}
