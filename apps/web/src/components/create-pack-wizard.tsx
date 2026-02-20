'use client';

import { useMemo, useState } from 'react';
import { loadPersistedWorkspacePath } from '../lib/workspace-connection';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Textarea } from './ui/textarea';

const AUTHOR_ROUTE_PATH = '/api/packs/author';
const DEFAULT_OUTPUT_DIR = 'packs';
const DEFAULT_VERSION = '1.0.0';
const DEFAULT_TASK_TYPES = 'task';
const DEFAULT_FILE_MAX_BYTES = 131_072;
const DEFAULT_HTTP_TIMEOUT_MS = 5_000;
const DEFAULT_HTTP_MAX_BYTES = 262_144;

const PACK_AUTHORING_TEMPLATE_IDS = {
  FILE_READ_TEXT: 'file.read_text',
  FILE_WRITE_TEXT: 'file.write_text',
  HTTP_GET_JSON: 'http.get_json',
} as const;

type TemplateId = (typeof PACK_AUTHORING_TEMPLATE_IDS)[keyof typeof PACK_AUTHORING_TEMPLATE_IDS];

interface FileReadTextTemplateConfig {
  readonly template_id: typeof PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT;
  readonly tool_name: string;
  readonly scope_pattern: string;
  readonly max_bytes: number;
}

interface FileWriteTextTemplateConfig {
  readonly template_id: typeof PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT;
  readonly tool_name: string;
  readonly scope_pattern: string;
  readonly max_bytes: number;
}

interface HttpGetJsonTemplateConfig {
  readonly template_id: typeof PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON;
  readonly tool_name: string;
  readonly allowed_urls: readonly string[];
  readonly timeout_ms: number;
  readonly max_bytes: number;
}

type PackAuthorTemplateConfig =
  | FileReadTextTemplateConfig
  | FileWriteTextTemplateConfig
  | HttpGetJsonTemplateConfig;

interface PackAuthoringRequest {
  readonly pack_id: string;
  readonly version: string;
  readonly task_types: readonly string[];
  readonly templates: readonly PackAuthorTemplateConfig[];
}

const TEMPLATE_OPTIONS = [
  { id: PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT, label: 'File Read Text' },
  { id: PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT, label: 'File Write Text' },
  { id: PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON, label: 'HTTP GET JSON' },
] as const;

interface TemplateDraft {
  templateId: TemplateId;
  toolName: string;
  scopePattern: string;
  allowedUrls: string;
}

interface CreatePackSuccessResponse {
  readonly success: true;
  readonly packId: string;
  readonly version: string;
  readonly outputRoot: string;
  readonly filesCreated: readonly string[];
  readonly toolCount: number;
  readonly policyCount: number;
}

interface CreatePackErrorResponse {
  readonly error?: string;
}

function parseCsvList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

function getErrorMessage(body: unknown): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as CreatePackErrorResponse).error === 'string'
  ) {
    return (body as CreatePackErrorResponse).error as string;
  }

  return 'Failed to create pack';
}

function getTemplateValidationError(draft: TemplateDraft): string | null {
  if (draft.toolName.trim().length === 0) {
    return 'Tool name is required';
  }

  const requiresScope =
    draft.templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT ||
    draft.templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT;
  if (requiresScope && draft.scopePattern.trim().length === 0) {
    return 'Scope pattern is required';
  }

  if (draft.templateId === PACK_AUTHORING_TEMPLATE_IDS.HTTP_GET_JSON) {
    const urls = parseCsvList(draft.allowedUrls);
    if (urls.length === 0) {
      return 'At least one HTTPS URL is required';
    }
  }

  return null;
}

function buildTemplateFromDraft(draft: TemplateDraft): PackAuthorTemplateConfig {
  if (draft.templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT) {
    return {
      template_id: draft.templateId,
      tool_name: draft.toolName.trim(),
      scope_pattern: draft.scopePattern.trim(),
      max_bytes: DEFAULT_FILE_MAX_BYTES,
    };
  }

  if (draft.templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT) {
    return {
      template_id: draft.templateId,
      tool_name: draft.toolName.trim(),
      scope_pattern: draft.scopePattern.trim(),
      max_bytes: DEFAULT_FILE_MAX_BYTES,
    };
  }

  return {
    template_id: draft.templateId,
    tool_name: draft.toolName.trim(),
    allowed_urls: parseCsvList(draft.allowedUrls),
    timeout_ms: DEFAULT_HTTP_TIMEOUT_MS,
    max_bytes: DEFAULT_HTTP_MAX_BYTES,
  };
}

function resetTemplateDraft(): TemplateDraft {
  return {
    templateId: PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT,
    toolName: '',
    scopePattern: '',
    allowedUrls: '',
  };
}

export function CreatePackWizard() {
  const persistedWorkspaceRoot = useMemo(() => {
    if (typeof window === 'undefined') {
      return '';
    }
    try {
      return loadPersistedWorkspacePath(window.localStorage) ?? '';
    } catch {
      return '';
    }
  }, []);

  const [workspaceRoot, setWorkspaceRoot] = useState(persistedWorkspaceRoot);
  const [outputDir, setOutputDir] = useState(DEFAULT_OUTPUT_DIR);
  const [packId, setPackId] = useState('');
  const [version, setVersion] = useState(DEFAULT_VERSION);
  const [taskTypes, setTaskTypes] = useState(DEFAULT_TASK_TYPES);
  const [templates, setTemplates] = useState<PackAuthorTemplateConfig[]>([]);
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(resetTemplateDraft);
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState<CreatePackSuccessResponse | null>(null);

  const requiresScopeInput =
    templateDraft.templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_READ_TEXT ||
    templateDraft.templateId === PACK_AUTHORING_TEMPLATE_IDS.FILE_WRITE_TEXT;

  function addTemplate(): void {
    const error = getTemplateValidationError(templateDraft);
    if (error) {
      setTemplateError(error);
      return;
    }

    const nextTemplate = buildTemplateFromDraft(templateDraft);
    setTemplates((current) => [...current, nextTemplate]);
    setTemplateDraft(resetTemplateDraft());
    setTemplateError(null);
    setFormError(null);
  }

  async function submitCreatePack(): Promise<void> {
    setFormError(null);
    setSuccess(null);

    if (workspaceRoot.trim().length === 0) {
      setFormError('Workspace root is required');
      return;
    }

    if (packId.trim().length === 0) {
      setFormError('Pack ID is required');
      return;
    }

    const parsedTaskTypes = parseCsvList(taskTypes);
    if (parsedTaskTypes.length === 0) {
      setFormError('At least one task type is required');
      return;
    }

    if (templates.length === 0) {
      setFormError('Add at least one template before creating a pack');
      return;
    }

    const request: PackAuthoringRequest = {
      pack_id: packId.trim(),
      version: version.trim(),
      task_types: parsedTaskTypes,
      templates,
    };

    setIsSubmitting(true);
    try {
      const response = await fetch(AUTHOR_ROUTE_PATH, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workspaceRoot: workspaceRoot.trim(),
          outputDir: outputDir.trim().length > 0 ? outputDir.trim() : DEFAULT_OUTPUT_DIR,
          request,
        }),
      });

      const body = (await response.json()) as CreatePackSuccessResponse | CreatePackErrorResponse;
      if (!response.ok) {
        setFormError(getErrorMessage(body));
        return;
      }

      setSuccess(body as CreatePackSuccessResponse);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to create pack');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" data-testid="open-create-pack-wizard" variant="secondary">
          Create Pack Wizard
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Pack Wizard</DialogTitle>
          <DialogDescription>
            Generate a secure no-code pack from templates and write it under your workspace root.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="workspace-root-input">Workspace Root</Label>
            <Input
              id="workspace-root-input"
              data-testid="workspace-root-input"
              value={workspaceRoot}
              onChange={(event) => setWorkspaceRoot(event.target.value)}
              placeholder="workspace-root"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="output-dir-input">Output Directory (relative to workspace root)</Label>
            <Input
              id="output-dir-input"
              data-testid="output-dir-input"
              value={outputDir}
              onChange={(event) => setOutputDir(event.target.value)}
              placeholder={DEFAULT_OUTPUT_DIR}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pack-id-input">Pack ID</Label>
              <Input
                id="pack-id-input"
                data-testid="pack-id-input"
                value={packId}
                onChange={(event) => setPackId(event.target.value)}
                placeholder="customer-ops"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pack-version-input">Version</Label>
              <Input
                id="pack-version-input"
                data-testid="pack-version-input"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
                placeholder={DEFAULT_VERSION}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="pack-task-types-input">Task Types (comma-separated)</Label>
            <Input
              id="pack-task-types-input"
              data-testid="pack-task-types-input"
              value={taskTypes}
              onChange={(event) => setTaskTypes(event.target.value)}
              placeholder={DEFAULT_TASK_TYPES}
            />
          </div>

          <div className="rounded-md border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-700">Add Template</h4>
            <div className="mt-3 grid gap-3">
              <div className="grid gap-2">
                <Label htmlFor="template-select">Template</Label>
                <select
                  id="template-select"
                  data-testid="template-select"
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                  value={templateDraft.templateId}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({
                      ...current,
                      templateId: event.target.value as TemplateId,
                    }))
                  }
                >
                  {TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="template-tool-name-input">Tool Name</Label>
                <Input
                  id="template-tool-name-input"
                  data-testid="template-tool-name-input"
                  value={templateDraft.toolName}
                  onChange={(event) =>
                    setTemplateDraft((current) => ({ ...current, toolName: event.target.value }))
                  }
                  placeholder="file:read-customer-notes"
                />
              </div>

              {requiresScopeInput ? (
                <div className="grid gap-2">
                  <Label htmlFor="template-scope-input">Scope Pattern</Label>
                  <Input
                    id="template-scope-input"
                    data-testid="template-scope-input"
                    value={templateDraft.scopePattern}
                    onChange={(event) =>
                      setTemplateDraft((current) => ({
                        ...current,
                        scopePattern: event.target.value,
                      }))
                    }
                    placeholder="notes/**/*.md"
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="template-urls-input">Allowed HTTPS URLs (comma-separated)</Label>
                  <Textarea
                    id="template-urls-input"
                    data-testid="template-urls-input"
                    value={templateDraft.allowedUrls}
                    onChange={(event) =>
                      setTemplateDraft((current) => ({
                        ...current,
                        allowedUrls: event.target.value,
                      }))
                    }
                    placeholder="https://api.example.com/v1/customer/profile"
                  />
                </div>
              )}

              <Button type="button" data-testid="add-template-button" onClick={addTemplate}>
                Add Template
              </Button>

              {templateError && (
                <p data-testid="create-pack-template-error" className="text-xs text-red-600">
                  {templateError}
                </p>
              )}
            </div>
          </div>

          {templates.length > 0 && (
            <div className="rounded-md border border-slate-200 p-3">
              <h4 className="text-sm font-semibold text-slate-700">Template Plan</h4>
              <ul className="mt-2 space-y-1 text-sm text-slate-600">
                {templates.map((template) => (
                  <li
                    key={`${template.template_id}-${template.tool_name}`}
                    data-testid={`template-item-${template.tool_name}`}
                    className="font-mono"
                  >
                    {template.template_id} · {template.tool_name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button
            type="button"
            data-testid="submit-create-pack-button"
            onClick={() => void submitCreatePack()}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Pack'}
          </Button>

          {isSubmitting && (
            <div
              data-testid="create-pack-progress"
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700"
            >
              Creating pack artifacts...
            </div>
          )}

          {formError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}

          {success && (
            <div
              data-testid="create-pack-success"
              className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700"
            >
              <p>
                Created <strong>{success.packId}</strong>@{success.version}
              </p>
              <p>Files generated: {success.filesCreated.length}</p>
              <p>Output root: {success.outputRoot}</p>
              <p>
                Tools: {success.toolCount} · Policies: {success.policyCount}
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
