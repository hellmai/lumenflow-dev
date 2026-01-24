// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeNova from 'starlight-theme-nova';

// https://astro.build/config
export default defineConfig({
  site: 'https://lumenflow.dev',
  integrations: [
    starlight({
      plugins: [starlightThemeNova()],
      title: 'LumenFlow',
      description: 'AI-native workflow for software teams',
      social: [
        {
          icon: 'github',
          label: 'GitHub App',
          href: 'https://github.com/apps/lumenflow-by-hellmai',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'What is LumenFlow?', slug: 'getting-started/introduction' },
            { label: 'Quickstart', slug: 'getting-started/quickstart' },
            { label: 'Install GitHub App', slug: 'getting-started/github-app' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Work Units (WUs)', slug: 'concepts/work-units' },
            { label: 'Lanes', slug: 'concepts/lanes' },
            { label: 'Gates', slug: 'concepts/gates' },
            { label: 'Memory Layer', slug: 'concepts/memory' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Sizing WUs', slug: 'guides/sizing' },
            { label: 'Team Workflow', slug: 'guides/team-workflow' },
            { label: 'AI Agent Integration', slug: 'guides/ai-agents' },
            { label: 'Agent Branch Patterns', slug: 'guides/agent-patterns' },
            { label: 'Initiatives', slug: 'guides/initiatives' },
            { label: 'Flow Metrics', slug: 'guides/metrics' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Commands', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/config' },
            { label: 'WU Schema', slug: 'reference/wu-schema' },
          ],
        },
      ],
    }),
  ],
});
