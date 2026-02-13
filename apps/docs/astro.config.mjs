// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeNova from 'starlight-theme-nova';
import astroD2 from 'astro-d2';

// https://astro.build/config
export default defineConfig({
  site: 'https://lumenflow.dev',
  integrations: [
    astroD2(),
    starlight({
      plugins: [starlightThemeNova()],
      title: 'LumenFlow',
      description: 'AI-native workflow for software teams',
      social: [],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quickstart (Agents)', slug: 'getting-started/quickstart' },
            { label: 'What is LumenFlow?', slug: 'getting-started/introduction' },
            { label: 'Why LumenFlow?', slug: 'getting-started/why-lumenflow' },
            { label: 'Upgrading', slug: 'getting-started/upgrade' },
            { label: 'FAQ', slug: 'getting-started/faq' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Visual Overview', slug: 'concepts/visual-overview' },
            { label: 'Work Units (WUs)', slug: 'concepts/work-units' },
            { label: 'Lanes', slug: 'concepts/lanes' },
            { label: 'Gates', slug: 'concepts/gates' },
            { label: 'Memory Layer', slug: 'concepts/memory' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'A Day with LumenFlow', slug: 'guides/a-day-with-lumenflow' },
            { label: 'Manual Quickstart (Humans)', slug: 'guides/manual-quickstart' },
            { label: 'Idea to Shipping', slug: 'guides/idea-to-shipping' },
            { label: 'Solo Developer Workflow', slug: 'guides/solo-workflow' },
            { label: 'Team Workflow', slug: 'guides/team-workflow' },
            { label: 'Existing Projects', slug: 'guides/existing-projects' },
            { label: 'Migration Guide', slug: 'guides/migration' },
            { label: 'Sizing WUs', slug: 'guides/sizing' },
            { label: 'AI Agent Integration', slug: 'guides/ai-agents' },
            { label: 'Agent Branch Patterns', slug: 'guides/agent-patterns' },
            { label: 'Custom Skills', slug: 'guides/custom-skills' },
            { label: 'Cookbook', slug: 'guides/cookbook' },
            { label: 'Initiatives', slug: 'guides/initiatives' },
            { label: 'Flow Metrics', slug: 'guides/metrics' },
          ],
        },
        {
          label: 'Tooling & Lifecycle',
          items: [
            { label: 'WU Completion Workflow', slug: 'guides/wu-prep-workflow' },
            { label: 'Troubleshooting', slug: 'guides/troubleshooting' },
          ],
        },
        {
          label: 'Language Guides',
          items: [
            { label: 'Overview', slug: 'language-guides' },
            { label: 'Python', slug: 'language-guides/python' },
            { label: '.NET', slug: 'language-guides/dotnet' },
            { label: 'Go', slug: 'language-guides/go' },
            { label: 'Rust', slug: 'language-guides/rust' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Commands', slug: 'reference/cli' },
            { label: 'Configuration', slug: 'reference/config' },
            { label: 'WU Schema', slug: 'reference/wu-schema' },
            { label: 'API Documentation', slug: 'reference/api' },
            { label: 'GitHub Action', slug: 'reference/github-action' },
            { label: 'Compatibility Matrix', slug: 'reference/compatibility' },
            { label: 'Changelog', slug: 'reference/changelog' },
          ],
        },
        {
          label: 'Legal',
          items: [
            { label: 'Licensing & Access', slug: 'legal/licensing' },
            { label: 'Terms of Use', slug: 'legal/terms' },
            { label: 'Privacy', slug: 'legal/privacy' },
          ],
        },
      ],
    }),
  ],
});
