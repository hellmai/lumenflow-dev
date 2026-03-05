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
  redirects: {
    // concepts/ → kernel or pack-scoped equivalents
    '/concepts/constraints': '/packs/software-delivery/concepts/constraints',
    '/concepts/lanes': '/packs/software-delivery/concepts/lanes',
    '/concepts/work-units': '/packs/software-delivery/concepts/work-units',
    '/concepts/gates': '/packs/software-delivery/concepts/gates',
    '/concepts/memory': '/packs/software-delivery/concepts/memory',
    '/concepts/policy-engine': '/kernel/policy-engine',
    '/concepts/scope-intersection': '/kernel/scope-intersection',
    '/concepts/tool-execution': '/kernel/tool-execution',
    '/concepts/evidence': '/kernel/evidence-store',
    '/concepts/package-architecture': '/kernel/package-architecture',
    '/concepts/kernel': '/kernel',
    '/concepts/visual-overview': '/kernel/visual-overview',
    '/concepts/packs': '/kernel/packs',
    // guides/ → pack-scoped or getting-started equivalents
    '/guides/manual-quickstart': '/getting-started/manual-quickstart',
    '/guides/agent-onboarding': '/packs/software-delivery/agents/agent-onboarding',
    '/guides/agent-patterns': '/packs/software-delivery/agents/ai-agent-integration',
    '/guides/ai-agents': '/packs/software-delivery/agents/ai-agent-integration',
    '/guides/ai-integrations': '/packs/software-delivery/agents/ai-integrations-setup',
    '/guides/mcp-setup': '/packs/software-delivery/agents/mcp-setup',
    '/guides/a-day-with-lumenflow': '/packs/software-delivery/workflows/a-day-with-lumenflow',
    '/guides/idea-to-shipping': '/packs/software-delivery/workflows/idea-to-shipping',
    '/guides/solo-workflow': '/packs/software-delivery/workflows/solo-workflow',
    '/guides/team-workflow': '/packs/software-delivery/workflows/team-workflow',
    '/guides/wu-prep-workflow': '/packs/software-delivery/workflows/wu-prep-workflow',
    '/guides/sizing': '/packs/software-delivery/workflows/sizing',
    '/guides/cookbook': '/packs/software-delivery/workflows/cookbook',
    '/guides/choosing-methodology': '/packs/software-delivery/workflows/choosing-methodology',
    '/guides/migrating-methodology': '/packs/software-delivery/workflows/migrating-methodology',
    '/guides/initiatives': '/packs/software-delivery/advanced/initiatives',
    '/guides/metrics': '/packs/software-delivery/advanced/metrics',
    '/guides/custom-skills': '/packs/software-delivery/advanced/custom-skills',
    '/guides/customizing-spawn-prompts':
      '/packs/software-delivery/advanced/customizing-spawn-prompts',
    '/guides/troubleshooting': '/packs/software-delivery/setup/troubleshooting',
    '/guides/create-a-pack': '/packs/software-delivery/setup/create-a-pack',
    '/guides/existing-projects': '/packs/software-delivery/setup/existing-projects',
    '/guides/migration': '/packs/software-delivery/setup/migration-guide',
    '/guides/upgrade': '/packs/software-delivery/setup/upgrading',
    // language-guides/ → pack-scoped language guides
    '/language-guides': '/packs/software-delivery/languages',
    '/language-guides/java': '/packs/software-delivery/languages/java',
    '/language-guides/php': '/packs/software-delivery/languages/php',
    '/language-guides/go': '/packs/software-delivery/languages/go',
    '/language-guides/dotnet': '/packs/software-delivery/languages/dotnet',
    '/language-guides/python': '/packs/software-delivery/languages/python',
    '/language-guides/rust': '/packs/software-delivery/languages/rust',
    '/language-guides/ruby': '/packs/software-delivery/languages/ruby',
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
            { label: 'Get Started (Humans)', slug: 'getting-started/manual-quickstart' },
            { label: 'Get Started (Agents)', slug: 'getting-started/quickstart' },
            { label: 'FAQ', slug: 'getting-started/faq' },
            { label: 'Learning Path', slug: 'getting-started/learning-path' },
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
