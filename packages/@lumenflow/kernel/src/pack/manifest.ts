import { z } from 'zod';
import { POLICY_TRIGGERS } from '../policy/policy-engine.js';

const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const SEMVER_MESSAGE = 'Expected semantic version';

export const DomainPackToolSchema = z.object({
  name: z.string().min(1),
  entry: z.string().min(1),
  internal_only: z.boolean().optional(),
});

export const DomainPackPolicySchema = z.object({
  id: z.string().min(1),
  trigger: z.enum([
    POLICY_TRIGGERS.ON_TOOL_REQUEST,
    POLICY_TRIGGERS.ON_CLAIM,
    POLICY_TRIGGERS.ON_COMPLETION,
    POLICY_TRIGGERS.ON_EVIDENCE_ADDED,
  ]),
  decision: z.enum(['allow', 'deny']),
  reason: z.string().min(1).optional(),
});

export const DomainPackLaneTemplateSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export const DomainPackManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().regex(SEMVER_REGEX, SEMVER_MESSAGE),
  task_types: z.array(z.string().min(1)).min(1),
  tools: z.array(DomainPackToolSchema),
  policies: z.array(DomainPackPolicySchema),
  evidence_types: z.array(z.string().min(1)).default([]),
  state_aliases: z.record(z.string().min(1), z.string().min(1)).default({}),
  lane_templates: z.array(DomainPackLaneTemplateSchema).default([]),
});

export type DomainPackManifest = z.infer<typeof DomainPackManifestSchema>;
