/**
 * WU Validator - Parse and validate WU spec from PR body
 */

interface WUSpec {
  id: string | null;
  title: string;
  lane: string;
  type: string;
  acceptanceCriteria: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  wu: WUSpec;
}

/**
 * Parse WU spec from PR body using template format:
 *
 * ## WU-123: Title here
 *
 * **Lane:** Core Systems
 * **Type:** feature
 *
 * ### Acceptance Criteria
 * - [ ] Criterion 1
 * - [ ] Criterion 2
 */
export function validateWUFromPR(body: string): ValidationResult {
  const errors: string[] = [];

  // Extract WU ID and title from header
  const headerMatch = body.match(/##\s*WU-(\d+):\s*(.+)/);
  const id = headerMatch?.[1] || null;
  const title = headerMatch?.[2]?.trim() || '';

  if (!id) {
    errors.push('Missing WU ID. Use format: ## WU-123: Title');
  }
  if (!title) {
    errors.push('Missing WU title');
  }

  // Extract lane
  const laneMatch = body.match(/\*\*Lane:\*\*\s*(.+)/);
  const lane = laneMatch?.[1]?.trim() || '';

  if (!lane) {
    errors.push('Missing Lane. Add: **Lane:** <lane name>');
  }

  // Extract type
  const typeMatch = body.match(/\*\*Type:\*\*\s*(.+)/);
  const type = typeMatch?.[1]?.trim() || 'feature';

  const validTypes = ['feature', 'bugfix', 'refactor', 'chore', 'spike'];
  if (!validTypes.includes(type.toLowerCase())) {
    errors.push(`Invalid type "${type}". Use: ${validTypes.join(', ')}`);
  }

  // Extract acceptance criteria
  const criteriaMatch = body.match(/###\s*Acceptance Criteria\s*([\s\S]*?)(?=###|$)/);
  const criteriaText = criteriaMatch?.[1] || '';
  const acceptanceCriteria = criteriaText
    .split('\n')
    .filter((line) => line.match(/^-\s*\[[ x]\]/))
    .map((line) => line.replace(/^-\s*\[[ x]\]\s*/, '').trim());

  if (acceptanceCriteria.length === 0) {
    errors.push('Missing acceptance criteria. Add checklist under ### Acceptance Criteria');
  }

  return {
    valid: errors.length === 0,
    errors,
    wu: {
      id,
      title,
      lane,
      type: type.toLowerCase(),
      acceptanceCriteria,
    },
  };
}
