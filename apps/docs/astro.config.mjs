// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeNova from 'starlight-theme-nova';
import astroD2 from 'astro-d2';
import remarkComment from 'remark-comment';

// https://astro.build/config
export default defineConfig({
  site: 'https://lumenflow.dev',
  markdown: {
    remarkPlugins: [remarkComment],
  },
  integrations: [
    astroD2(),
    starlight({
      plugins: [starlightThemeNova()],
      customCss: ['./src/styles/splash.css'],
      title: 'LumenFlow',
      description: 'The governance layer between AI agents and the world',
      social: [],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'What is LumenFlow?', slug: 'getting-started/introduction' },
            { label: 'Why LumenFlow?', slug: 'getting-started/why-lumenflow' },
            { label: 'Get Started (Humans)', slug: 'guides/manual-quickstart' },
            { label: 'Get Started (Agents)', slug: 'getting-started/quickstart' },
            { label: 'FAQ', slug: 'getting-started/faq' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Visual Overview', slug: 'concepts/visual-overview' },
            { label: 'Kernel Runtime', slug: 'concepts/kernel' },
            { label: 'Packs', slug: 'concepts/packs' },
            { label: 'Scope Intersection', slug: 'concepts/scope-intersection' },
            { label: 'Policy Engine', slug: 'concepts/policy-engine' },
            { label: 'Evidence Store', slug: 'concepts/evidence' },
          ],
        },
        {
          label: 'Software Delivery Pack',
          items: [
            { label: 'Overview', slug: 'pack/overview' },
            {
              label: 'Concepts',
              items: [
                { label: 'Work Units (WUs)', slug: 'concepts/work-units' },
                { label: 'Lanes', slug: 'concepts/lanes' },
                { label: 'Gates', slug: 'concepts/gates' },
                { label: 'Memory Layer', slug: 'concepts/memory' },
                { label: 'Constraints', slug: 'concepts/constraints' },
              ],
            },
            {
              label: 'Workflows',
              items: [
                { label: 'A Day with LumenFlow', slug: 'guides/a-day-with-lumenflow' },
                { label: 'Idea to Shipping', slug: 'guides/idea-to-shipping' },
                { label: 'Solo Developer Workflow', slug: 'guides/solo-workflow' },
                { label: 'Team Workflow', slug: 'guides/team-workflow' },
                { label: 'WU Completion Workflow', slug: 'guides/wu-prep-workflow' },
                { label: 'Sizing WUs', slug: 'guides/sizing' },
                { label: 'Cookbook', slug: 'guides/cookbook' },
                { label: 'Choosing Methodology', slug: 'guides/choosing-methodology' },
                { label: 'Migrating Methodology', slug: 'guides/migrating-methodology' },
              ],
            },
            {
              label: 'Advanced',
              items: [
                { label: 'Initiatives', slug: 'guides/initiatives' },
                { label: 'Flow Metrics', slug: 'guides/metrics' },
                { label: 'Custom Skills', slug: 'guides/custom-skills' },
                {
                  label: 'Customizing Spawn Prompts',
                  slug: 'guides/customizing-spawn-prompts',
                },
              ],
            },
          ],
        },
        {
          label: 'AI Agents',
          items: [
            { label: 'Agent Onboarding', slug: 'guides/agent-onboarding' },
            { label: 'AI Agent Integration', slug: 'guides/ai-agents' },
            { label: 'AI Integrations Setup', slug: 'guides/ai-integrations' },
            { label: 'Agent Branch Patterns', slug: 'guides/agent-patterns' },
            { label: 'MCP Setup', slug: 'guides/mcp-setup' },
            { label: 'Agent Safety', slug: 'reference/agent-safety' },
          ],
        },
        {
          label: 'Setup & Migration',
          items: [
            { label: 'Existing Projects', slug: 'guides/existing-projects' },
            { label: 'Create a Pack', slug: 'guides/create-a-pack' },
            { label: 'Migration Guide', slug: 'guides/migration' },
            { label: 'Upgrading', slug: 'getting-started/upgrade' },
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
            { label: 'Java', slug: 'language-guides/java' },
            { label: 'Ruby', slug: 'language-guides/ruby' },
            { label: 'PHP', slug: 'language-guides/php' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Commands', slug: 'reference/cli' },
            { label: 'MCP Server', slug: 'reference/mcp' },
            { label: 'Configuration', slug: 'reference/config' },
            { label: 'Config Commands', slug: 'reference/config-commands' },
            { label: 'Workspace Spec', slug: 'reference/workspace-spec' },
            { label: 'WU Schema', slug: 'reference/wu-schema' },
            { label: 'Work Classifier', slug: 'reference/work-classifier' },
            { label: 'Spawn Manifest', slug: 'reference/spawn-manifest' },
            { label: 'Template Format', slug: 'reference/templates' },
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
