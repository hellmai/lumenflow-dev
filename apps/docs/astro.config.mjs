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
          label: 'Kernel',
          items: [
            { label: 'Overview', slug: 'kernel' },
            { label: 'Visual Overview', slug: 'kernel/visual-overview' },
            { label: 'Kernel Runtime', slug: 'kernel/runtime' },
            { label: 'Packs', slug: 'kernel/packs' },
            { label: 'Tool Execution', slug: 'kernel/tool-execution' },
            { label: 'Package Architecture', slug: 'kernel/package-architecture' },
            { label: 'Scope Intersection', slug: 'kernel/scope-intersection' },
            { label: 'Policy Engine', slug: 'kernel/policy-engine' },
            { label: 'Evidence Store', slug: 'kernel/evidence-store' },
          ],
        },
        {
          label: 'Packs',
          items: [
            {
              label: 'Software Delivery Pack',
              items: [
                {
                  label: 'Overview',
                  slug: 'packs/software-delivery',
                },
                {
                  label: 'Concepts',
                  items: [
                    {
                      label: 'Work Units (WUs)',
                      slug: 'packs/software-delivery/concepts/work-units',
                    },
                    { label: 'Lanes', slug: 'packs/software-delivery/concepts/lanes' },
                    { label: 'Gates', slug: 'packs/software-delivery/concepts/gates' },
                    { label: 'Memory Layer', slug: 'packs/software-delivery/concepts/memory' },
                    { label: 'Constraints', slug: 'packs/software-delivery/concepts/constraints' },
                  ],
                },
                {
                  label: 'Workflows',
                  items: [
                    {
                      label: 'A Day with LumenFlow',
                      slug: 'packs/software-delivery/workflows/a-day-with-lumenflow',
                    },
                    {
                      label: 'Idea to Shipping',
                      slug: 'packs/software-delivery/workflows/idea-to-shipping',
                    },
                    {
                      label: 'Solo Developer Workflow',
                      slug: 'packs/software-delivery/workflows/solo-workflow',
                    },
                    {
                      label: 'Team Workflow',
                      slug: 'packs/software-delivery/workflows/team-workflow',
                    },
                    {
                      label: 'WU Completion Workflow',
                      slug: 'packs/software-delivery/workflows/wu-prep-workflow',
                    },
                    { label: 'Sizing WUs', slug: 'packs/software-delivery/workflows/sizing' },
                    { label: 'Cookbook', slug: 'packs/software-delivery/workflows/cookbook' },
                    {
                      label: 'Choosing Methodology',
                      slug: 'packs/software-delivery/workflows/choosing-methodology',
                    },
                    {
                      label: 'Migrating Methodology',
                      slug: 'packs/software-delivery/workflows/migrating-methodology',
                    },
                  ],
                },
                {
                  label: 'AI Agents',
                  items: [
                    {
                      label: 'Agent Onboarding',
                      slug: 'packs/software-delivery/agents/agent-onboarding',
                    },
                    {
                      label: 'AI Agent Integration',
                      slug: 'packs/software-delivery/agents/ai-agent-integration',
                    },
                    {
                      label: 'AI Integrations Setup',
                      slug: 'packs/software-delivery/agents/ai-integrations-setup',
                    },
                    {
                      label: 'Agent Branch Patterns',
                      slug: 'packs/software-delivery/agents/agent-branch-patterns',
                    },
                    {
                      label: 'MCP Setup',
                      slug: 'packs/software-delivery/agents/mcp-setup',
                    },
                    { label: 'Agent Safety', slug: 'reference/agent-safety' },
                  ],
                },
                {
                  label: 'Setup & Migration',
                  items: [
                    {
                      label: 'Existing Projects',
                      slug: 'packs/software-delivery/setup/existing-projects',
                    },
                    {
                      label: 'Create a Pack',
                      slug: 'packs/software-delivery/setup/create-a-pack',
                    },
                    {
                      label: 'Migration Guide',
                      slug: 'packs/software-delivery/setup/migration-guide',
                    },
                    { label: 'Upgrading', slug: 'packs/software-delivery/setup/upgrading' },
                    {
                      label: 'Troubleshooting',
                      slug: 'packs/software-delivery/setup/troubleshooting',
                    },
                  ],
                },
                {
                  label: 'Language Guides',
                  items: [
                    { label: 'Overview', slug: 'packs/software-delivery/languages' },
                    { label: 'Node.js', slug: 'packs/software-delivery/languages/node' },
                    { label: 'Python', slug: 'packs/software-delivery/languages/python' },
                    { label: '.NET', slug: 'packs/software-delivery/languages/dotnet' },
                    { label: 'Go', slug: 'packs/software-delivery/languages/go' },
                    { label: 'Rust', slug: 'packs/software-delivery/languages/rust' },
                    { label: 'Java', slug: 'packs/software-delivery/languages/java' },
                    { label: 'Ruby', slug: 'packs/software-delivery/languages/ruby' },
                    { label: 'PHP', slug: 'packs/software-delivery/languages/php' },
                  ],
                },
                {
                  label: 'Advanced',
                  items: [
                    { label: 'Initiatives', slug: 'packs/software-delivery/advanced/initiatives' },
                    { label: 'Flow Metrics', slug: 'packs/software-delivery/advanced/metrics' },
                    {
                      label: 'Custom Skills',
                      slug: 'packs/software-delivery/advanced/custom-skills',
                    },
                    {
                      label: 'Customizing Spawn Prompts',
                      slug: 'packs/software-delivery/advanced/customizing-spawn-prompts',
                    },
                  ],
                },
              ],
            },
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
          label: 'Releases',
          items: [{ label: 'Release Notes', slug: 'releases' }],
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
