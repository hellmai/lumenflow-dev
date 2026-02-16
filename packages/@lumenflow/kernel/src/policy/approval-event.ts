import { z } from 'zod';

export const ApprovalScopeSchema = z.object({
  level: z.enum(['workspace', 'lane', 'pack', 'task']),
  id: z.string().min(1),
});

export const ApprovalEventSchema = z.object({
  schema_version: z.literal(1),
  kind: z.literal('approval_event'),
  run_id: z.string().min(1),
  scope: ApprovalScopeSchema,
  approved_by: z.string().min(1),
  expires_at: z.string().datetime(),
  reason: z.string().min(1).optional(),
});

export type ApprovalEvent = z.infer<typeof ApprovalEventSchema>;
