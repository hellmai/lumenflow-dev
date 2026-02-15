/**
 * Compliance Parser
 *
 * Parses markdown compliance documentation into structured data.
 * Used by compliance-snapshot.ts tool to create snapshots.
 *
 * @module tools/lib/compliance-parser
 */

export type ComplianceFramework = 'ISO27001' | 'NHS_DTAC' | 'NHS_DSPT' | 'GDPR' | 'FDA';
export type GapStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';
export type GapPriority = 'critical' | 'high' | 'medium' | 'low';
export type EvidenceStatus = 'exists' | 'partial' | 'missing';
export type CompliancePhase =
  | 'phase_1_critical_blockers'
  | 'phase_2_nhs_procurement_ready'
  | 'phase_3_enterprise_ready';

export interface ActionItem {
  id: string;
  description: string;
  owner: string | null;
  dueDate: string | null;
  status: GapStatus;
}

export interface GapItem {
  gapId: string;
  title: string;
  domain: string;
  priority: GapPriority;
  status: GapStatus;
  phase: CompliancePhase;
  owner: string;
  targetDate: string | null;
  actionItems: ActionItem[];
  blockers: string[];
  dependsOn: string[];
}

export interface EvidenceItem {
  evidenceId: string;
  section: string;
  title: string;
  requirement: string;
  status: EvidenceStatus;
  location: string | null;
  auditNotes: string[];
  relatedGaps: string[];
}

export interface FrameworkMetrics {
  framework: ComplianceFramework;
  totalRequirements: number;
  evidenceExists: number;
  evidencePartial: number;
  evidenceMissing: number;
  completionPercentage: number;
}

export interface PhaseMetrics {
  phase: CompliancePhase;
  totalGaps: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  blocked: number;
  completionPercentage: number;
  targetDate: string | null;
}

type PartialGapItem = Partial<GapItem> & {
  gapId: string;
  title: string;
  phase: CompliancePhase;
  actionItems: ActionItem[];
  blockers: string[];
  dependsOn: string[];
};

type PartialEvidenceItem = Partial<EvidenceItem> & {
  evidenceId: string;
  title: string;
  section: string;
  auditNotes: string[];
  relatedGaps: string[];
};

interface FrameworkCount {
  total: number;
  exists: number;
  partial: number;
  missing: number;
}

interface PhaseCount {
  total: number;
  notStarted: number;
  inProgress: number;
  completed: number;
  blocked: number;
}

export const COMPLIANCE_FRAMEWORKS: ComplianceFramework[] = [
  'ISO27001',
  'NHS_DTAC',
  'NHS_DSPT',
  'GDPR',
  'FDA',
];
export const GAP_STATUSES: GapStatus[] = ['not_started', 'in_progress', 'completed', 'blocked'];
export const GAP_PRIORITIES: GapPriority[] = ['critical', 'high', 'medium', 'low'];
export const EVIDENCE_STATUSES: EvidenceStatus[] = ['exists', 'partial', 'missing'];
export const COMPLIANCE_PHASES: CompliancePhase[] = [
  'phase_1_critical_blockers',
  'phase_2_nhs_procurement_ready',
  'phase_3_enterprise_ready',
];

// Status emoji mappings
const STATUS_EMOJI_MAP: Record<string, GapStatus> = {
  'Not Started': 'not_started',
  'In Progress': 'in_progress',
  Completed: 'completed',
  Blocked: 'blocked',
};

const PRIORITY_EMOJI_MAP: Record<string, GapPriority> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
};

const EVIDENCE_STATUS_MAP: Record<string, EvidenceStatus> = {
  'Evidence exists': 'exists',
  'Partial evidence': 'partial',
  'No evidence': 'missing',
};

const PHASE_HEADER_MAP: Record<string, CompliancePhase> = {
  'Phase 1': 'phase_1_critical_blockers',
  'Phase 2': 'phase_2_nhs_procurement_ready',
  'Phase 3': 'phase_3_enterprise_ready',
};

// Framework keyword mappings for evidence parsing
const FRAMEWORK_KEYWORDS: Record<ComplianceFramework, string[]> = {
  ISO27001: ['ISO 27001', 'ISO27001', 'SOC 2', 'SOC2'],
  NHS_DTAC: ['compliance framework', 'DTAC'],
  NHS_DSPT: ['NHS DSPT', 'DSPT'],
  GDPR: ['GDPR', 'UK GDPR', 'Data Protection'],
  FDA: ['FDA', '21 CFR', 'Medical Device'],
};

export class ComplianceParser {
  /**
   * Parse gap-analysis.md content into structured GapItems
   * @param {string} markdown
   * @returns {GapItem[]}
   */
  parseGapAnalysis(markdown: string): GapItem[] {
    const gaps: GapItem[] = [];
    const lines = markdown.split('\n');

    let currentPhase: CompliancePhase = 'phase_1_critical_blockers';
    let currentGap: PartialGapItem | null = null;
    let inActionItems = false;
    let inBlockers = false;
    let currentActionItem: ActionItem | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Detect phase headers
      if (trimmedLine.startsWith('## Phase')) {
        for (const [phaseKey, phaseValue] of Object.entries(PHASE_HEADER_MAP)) {
          if (trimmedLine.includes(phaseKey)) {
            currentPhase = phaseValue;
            break;
          }
        }
        continue;
      }

      // Detect GAP header
      const gapMatch = trimmedLine.match(/^### (GAP-\d+):\s*(.+)$/);
      if (gapMatch) {
        // Save previous gap if exists
        if (currentGap?.gapId) {
          if (currentActionItem?.id) {
            currentGap.actionItems.push(currentActionItem);
          }
          gaps.push(this._finalizeGap(currentGap, currentPhase));
        }

        currentGap = {
          gapId: gapMatch[1],
          title: gapMatch[2],
          phase: currentPhase,
          actionItems: [],
          blockers: [],
          dependsOn: [],
        };
        currentActionItem = null;
        inActionItems = false;
        inBlockers = false;
        continue;
      }

      if (!currentGap) continue;

      // Parse fields
      if (trimmedLine.startsWith('**Priority:**')) {
        currentGap.priority = this._parsePriority(trimmedLine);
      } else if (trimmedLine.startsWith('**Domain:**')) {
        currentGap.domain = trimmedLine.replace('**Domain:**', '').trim();
      } else if (trimmedLine.startsWith('**Status:**')) {
        currentGap.status = this._parseStatus(trimmedLine);
      } else if (trimmedLine.startsWith('**Owner:**')) {
        currentGap.owner = trimmedLine.replace('**Owner:**', '').trim();
      } else if (trimmedLine.startsWith('**Target Date:**')) {
        currentGap.targetDate = trimmedLine.replace('**Target Date:**', '').trim() || null;
      } else if (trimmedLine.startsWith('**Depends On:**')) {
        const deps = this._extractGapReferences(trimmedLine);
        currentGap.dependsOn = deps;
      }

      // Detect sections
      if (trimmedLine === '**Action Items:**') {
        inActionItems = true;
        inBlockers = false;
        continue;
      }
      if (trimmedLine === '**Blockers:**') {
        inActionItems = false;
        inBlockers = true;
        continue;
      }
      if (trimmedLine.startsWith('**') && trimmedLine.endsWith('**')) {
        if (!trimmedLine.includes('Action Items') && !trimmedLine.includes('Blockers')) {
          inActionItems = false;
          inBlockers = false;
        }
      }

      // Parse action items
      if (inActionItems) {
        const actionMatch = trimmedLine.match(/^- \[[ x]\] \*\*(\d+\.\d+)\*\*\s+(.+)$/);
        if (actionMatch) {
          if (currentActionItem?.id) {
            currentGap.actionItems.push(currentActionItem);
          }
          const isCompleted = trimmedLine.includes('[x]');
          currentActionItem = {
            id: actionMatch[1],
            description: actionMatch[2],
            status: isCompleted ? 'completed' : 'not_started',
            owner: null,
            dueDate: null,
          };
        } else if (currentActionItem && trimmedLine.startsWith('- Owner:')) {
          currentActionItem.owner = trimmedLine.replace('- Owner:', '').trim();
        } else if (currentActionItem && trimmedLine.startsWith('- Due:')) {
          currentActionItem.dueDate = trimmedLine.replace('- Due:', '').trim();
        } else if (currentActionItem && trimmedLine.startsWith('- Status:')) {
          currentActionItem.status = this._parseStatus(trimmedLine);
        }
      }

      // Parse blockers
      if (inBlockers && trimmedLine.startsWith('-') && !trimmedLine.includes('None')) {
        const blockerText = trimmedLine.replace(/^-\s*/, '').replace(/^[🔴🟡]\s*/u, '');
        if (blockerText.trim()) {
          currentGap.blockers.push(blockerText.trim());
          // Also extract any GAP references
          const gapRefs = this._extractGapReferences(trimmedLine);
          for (const ref of gapRefs) {
            if (!currentGap.dependsOn.includes(ref)) {
              currentGap.dependsOn.push(ref);
            }
          }
        }
      }
    }

    // Save final gap
    if (currentGap?.gapId) {
      if (currentActionItem?.id) {
        currentGap.actionItems.push(currentActionItem);
      }
      gaps.push(this._finalizeGap(currentGap, currentPhase));
    }

    return gaps;
  }

  /**
   * Parse evidence-registry.md content into structured EvidenceItems
   * @param {string} markdown
   * @returns {EvidenceItem[]}
   */
  parseEvidenceRegistry(markdown: string): EvidenceItem[] {
    const evidence: EvidenceItem[] = [];
    const lines = markdown.split('\n');

    let currentSection = '';
    let currentEvidence: PartialEvidenceItem | null = null;
    let inAuditNotes = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Detect section headers (## N. Section Name)
      const sectionMatch = trimmedLine.match(/^## \d+\.\s*(.+)$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        continue;
      }

      // Detect evidence item header (### N.N Title)
      const evidenceMatch = trimmedLine.match(/^### (\d+\.\d+)\s+(.+)$/);
      if (evidenceMatch) {
        // Save previous evidence if exists
        if (currentEvidence?.evidenceId) {
          evidence.push(this._finalizeEvidence(currentEvidence, currentSection));
        }

        currentEvidence = {
          evidenceId: evidenceMatch[1],
          title: evidenceMatch[2],
          section: currentSection,
          auditNotes: [],
          relatedGaps: [],
        };
        inAuditNotes = false;
        continue;
      }

      if (!currentEvidence) continue;

      // Parse fields
      if (trimmedLine.startsWith('**Requirement**:')) {
        currentEvidence.requirement = trimmedLine.replace('**Requirement**:', '').trim();
      } else if (trimmedLine.startsWith('**Status**:')) {
        currentEvidence.status = this._parseEvidenceStatus(trimmedLine);
      }

      // Detect Evidence section with Location
      if (trimmedLine.includes('**Location**:')) {
        const locationMatch = trimmedLine.match(/\*\*Location\*\*:\s*\[?([^\]]+)\]?/);
        if (locationMatch) {
          currentEvidence.location = locationMatch[1].replace(/\(.*\)/, '').trim();
        }
      }

      // Detect Audit Notes section
      if (trimmedLine === '**Audit Notes**:') {
        inAuditNotes = true;
        continue;
      }

      // Parse audit notes
      if (inAuditNotes && trimmedLine.startsWith('-')) {
        const noteText = trimmedLine.replace(/^-\s*/, '').trim();
        if (noteText) {
          currentEvidence.auditNotes.push(noteText);
          // Extract GAP references from notes
          const gapRefs = this._extractGapReferences(trimmedLine);
          for (const ref of gapRefs) {
            if (!currentEvidence.relatedGaps.includes(ref)) {
              currentEvidence.relatedGaps.push(ref);
            }
          }
        }
      }

      // End audit notes on next section
      if (inAuditNotes && trimmedLine.startsWith('---')) {
        inAuditNotes = false;
      }
    }

    // Save final evidence
    if (currentEvidence?.evidenceId) {
      evidence.push(this._finalizeEvidence(currentEvidence, currentSection));
    }

    return evidence;
  }

  /**
   * Calculate framework metrics from evidence items
   * @param {EvidenceItem[]} evidence
   * @returns {FrameworkMetrics[]}
   */
  calculateFrameworkMetrics(evidence: EvidenceItem[]): FrameworkMetrics[] {
    const frameworkCounts = {} as Record<ComplianceFramework, FrameworkCount>;

    // Initialize all frameworks
    for (const framework of COMPLIANCE_FRAMEWORKS) {
      frameworkCounts[framework] = { total: 0, exists: 0, partial: 0, missing: 0 };
    }

    // Count evidence per framework
    for (const item of evidence) {
      const frameworks = this._detectFrameworks(item.requirement);
      for (const framework of frameworks) {
        frameworkCounts[framework].total++;
        if (item.status === 'exists') {
          frameworkCounts[framework].exists++;
        } else if (item.status === 'partial') {
          frameworkCounts[framework].partial++;
        } else {
          frameworkCounts[framework].missing++;
        }
      }
    }

    // Calculate metrics
    return COMPLIANCE_FRAMEWORKS.map((framework) => {
      const counts = frameworkCounts[framework];
      // Completion: exists = 100%, partial = 50%, missing = 0%
      const completionPercentage =
        counts.total > 0
          ? Math.round((counts.exists * 100 + counts.partial * 50) / counts.total)
          : 0;

      return {
        framework,
        totalRequirements: counts.total,
        evidenceExists: counts.exists,
        evidencePartial: counts.partial,
        evidenceMissing: counts.missing,
        completionPercentage,
      };
    });
  }

  /**
   * Calculate phase metrics from gap items
   * @param {GapItem[]} gaps
   * @returns {PhaseMetrics[]}
   */
  calculatePhaseMetrics(gaps: GapItem[]): PhaseMetrics[] {
    const phaseCounts = {} as Record<CompliancePhase, PhaseCount>;

    // Initialize all phases
    for (const phase of COMPLIANCE_PHASES) {
      phaseCounts[phase] = { total: 0, notStarted: 0, inProgress: 0, completed: 0, blocked: 0 };
    }

    // Count gaps per phase
    for (const gap of gaps) {
      const phase = gap.phase;
      phaseCounts[phase].total++;
      switch (gap.status) {
        case 'not_started':
          phaseCounts[phase].notStarted++;
          break;
        case 'in_progress':
          phaseCounts[phase].inProgress++;
          break;
        case 'completed':
          phaseCounts[phase].completed++;
          break;
        case 'blocked':
          phaseCounts[phase].blocked++;
          break;
      }
    }

    // Calculate metrics
    return COMPLIANCE_PHASES.map((phase) => {
      const counts = phaseCounts[phase];
      const completionPercentage =
        counts.total > 0 ? Math.round((counts.completed / counts.total) * 100 * 100) / 100 : 0;

      return {
        phase,
        totalGaps: counts.total,
        notStarted: counts.notStarted,
        inProgress: counts.inProgress,
        completed: counts.completed,
        blocked: counts.blocked,
        completionPercentage,
        targetDate: this._getPhaseTargetDate(phase),
      };
    });
  }

  // Helper methods
  /** @private */
  _parseStatus(text: string): GapStatus {
    for (const [key, value] of Object.entries(STATUS_EMOJI_MAP)) {
      if (text.includes(key)) {
        return value;
      }
    }
    return 'not_started';
  }

  /** @private */
  _parsePriority(text: string): GapPriority {
    for (const [key, value] of Object.entries(PRIORITY_EMOJI_MAP)) {
      if (text.toUpperCase().includes(key)) {
        return value;
      }
    }
    return 'medium';
  }

  /** @private */
  _parseEvidenceStatus(text: string): EvidenceStatus {
    for (const [key, value] of Object.entries(EVIDENCE_STATUS_MAP)) {
      if (text.includes(key)) {
        return value;
      }
    }
    return 'missing';
  }

  /** @private */
  _extractGapReferences(text: string): string[] {
    const matches = text.match(/GAP-\d+/g);
    return matches ? [...new Set(matches)] : [];
  }

  /** @private */
  _detectFrameworks(requirement: string): ComplianceFramework[] {
    const frameworks: ComplianceFramework[] = [];
    for (const framework of COMPLIANCE_FRAMEWORKS) {
      const keywords = FRAMEWORK_KEYWORDS[framework];
      for (const keyword of keywords) {
        if (requirement.includes(keyword)) {
          frameworks.push(framework);
          break;
        }
      }
    }
    return frameworks;
  }

  /** @private */
  _finalizeGap(partial: PartialGapItem, phase: CompliancePhase): GapItem {
    return {
      gapId: partial.gapId || 'UNKNOWN',
      title: partial.title || 'Untitled',
      domain: partial.domain || 'Unknown',
      priority: partial.priority || 'medium',
      status: partial.status || 'not_started',
      phase: partial.phase || phase,
      owner: partial.owner || 'Unassigned',
      targetDate: partial.targetDate || null,
      actionItems: partial.actionItems || [],
      blockers: partial.blockers || [],
      dependsOn: partial.dependsOn || [],
    };
  }

  /** @private */
  _finalizeEvidence(partial: PartialEvidenceItem, section: string): EvidenceItem {
    return {
      evidenceId: partial.evidenceId || 'UNKNOWN',
      section: partial.section || section,
      title: partial.title || 'Untitled',
      requirement: partial.requirement || '',
      status: partial.status || 'missing',
      location: partial.location || null,
      auditNotes: partial.auditNotes || [],
      relatedGaps: partial.relatedGaps || [],
    };
  }

  /** @private */
  _getPhaseTargetDate(phase: CompliancePhase): string | null {
    switch (phase) {
      case 'phase_1_critical_blockers':
        return 'Month 3';
      case 'phase_2_nhs_procurement_ready':
        return 'Month 6';
      case 'phase_3_enterprise_ready':
        return 'Month 12';
      default:
        return null;
    }
  }
}
