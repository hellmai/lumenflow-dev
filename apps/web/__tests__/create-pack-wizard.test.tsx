// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WORKSPACE_LOCAL_STORAGE_KEY } from '../src/lib/workspace-connection';

const SUCCESS_RESPONSE = {
  success: true,
  packId: 'customer-ops',
  version: '1.0.0',
  outputRoot: '/tmp/workspace/packs/customer-ops',
  filesCreated: [
    '/tmp/workspace/packs/customer-ops/manifest.yaml',
    '/tmp/workspace/packs/customer-ops/tool-impl/file-read-customer-notes.ts',
  ],
  toolCount: 1,
  policyCount: 0,
} as const;

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('CreatePackWizard component', () => {
  it('supports template selection, create flow, progress, and success summary', async () => {
    const { CreatePackWizard } = await import('../src/components/create-pack-wizard');
    localStorage.setItem(WORKSPACE_LOCAL_STORAGE_KEY, '/tmp/workspace');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => SUCCESS_RESPONSE,
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CreatePackWizard />);

    fireEvent.click(screen.getByTestId('open-create-pack-wizard'));

    fireEvent.change(screen.getByTestId('pack-id-input'), { target: { value: 'customer-ops' } });
    fireEvent.change(screen.getByTestId('pack-version-input'), { target: { value: '1.0.0' } });
    fireEvent.change(screen.getByTestId('pack-task-types-input'), { target: { value: 'task' } });

    fireEvent.change(screen.getByTestId('template-select'), {
      target: { value: 'file.read_text' },
    });
    fireEvent.change(screen.getByTestId('template-tool-name-input'), {
      target: { value: 'file:read-customer-notes' },
    });
    fireEvent.change(screen.getByTestId('template-scope-input'), {
      target: { value: 'notes/**/*.md' },
    });

    fireEvent.click(screen.getByTestId('add-template-button'));
    expect(screen.getByTestId('template-item-file:read-customer-notes')).toBeDefined();

    fireEvent.click(screen.getByTestId('submit-create-pack-button'));

    await waitFor(() => {
      expect(screen.getByTestId('create-pack-progress')).toBeDefined();
    });

    await waitFor(() => {
      expect(screen.getByTestId('create-pack-success')).toBeDefined();
    });

    expect(screen.getByText('customer-ops')).toBeDefined();
    expect(screen.getByText('Files generated: 2')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows validation feedback when template configuration is incomplete', async () => {
    const { CreatePackWizard } = await import('../src/components/create-pack-wizard');
    localStorage.setItem(WORKSPACE_LOCAL_STORAGE_KEY, '/tmp/workspace');

    render(<CreatePackWizard />);

    fireEvent.click(screen.getByTestId('open-create-pack-wizard'));
    fireEvent.change(screen.getByTestId('template-select'), {
      target: { value: 'file.read_text' },
    });
    fireEvent.click(screen.getByTestId('add-template-button'));

    expect(screen.getByTestId('create-pack-template-error').textContent).toContain(
      'Tool name is required',
    );
  });
});
