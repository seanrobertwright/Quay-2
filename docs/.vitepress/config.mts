import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import type { ConfigEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { stepCards } from './step-cards.ts';
import { LANDING_LINK, publishedTutorials, tutorialsSidebar } from './tutorials.ts';
import { testRuns } from '../../scripts/test-runs/publish.ts';

// https://vitepress.dev/reference/site-config
export default ({ command }: ConfigEnv) => {
  // Only docs:build holds a tutorial back until it has two passing test runs; docs:dev serves drafts.
  const publish = testRuns(command);
  return withMermaid(
  defineConfig({
    title: "Quay 2",
    description: "Native Windows Autonomous Multi-Agent Workspace & Orchestrator",
    base: "/Quay-2/",
    cleanUrls: true,
    lastUpdated: true,
    // The step-card example page renders under `docs:dev` only, never in the published site.
    srcExclude: command === 'build' ? ['_examples/**'] : [],
    markdown: {
      config: (md) => {
        stepCards(md);
        publish(md);
      },
    },
    mermaid: {
      theme: 'dark',
    },
    // vitepress-plugin-mermaid pre-bundles mermaid's CommonJS deps by bare name, which pnpm
    // doesn't hoist, so `docs:dev` served them raw and every page rendered blank. Resolve them
    // through mermaid instead. The cytoscape plugins and dayjs duration load only for mindmap,
    // architecture and gantt diagrams.
    vite: {
      optimizeDeps: {
        include: [
          'mermaid > dayjs',
          'mermaid > dayjs/plugin/duration.js',
          'mermaid > @braintree/sanitize-url',
          'mermaid > elkjs/lib/elk.bundled.js',
          'mermaid > cytoscape-cose-bilkent',
          'mermaid > cytoscape-fcose',
        ],
      },
    },

  head: [
    ['link', { rel: 'icon', href: '/Quay-2/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#161b22' }],
    ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Quay 2',

    nav: [
      { text: 'Guide', link: '/guide/what-is-quay' },
      { text: 'Tutorials', link: LANDING_LINK },
      { text: 'Features', link: '/features/agent-support' },
      { text: 'A2A Bus', link: '/features/a2a-orchestration' },
      { text: 'Archon & SDD', link: '/features/archon-sdd' },
      { text: 'Machina', link: '/features/machina-praxis' },
      { text: 'Reference', link: '/reference/shortcuts' },
      {
        text: 'v0.2.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/seanrobertwright/Quay-2/commits/master' },
          { text: 'Contributing', link: '/community/contributing' },
          { text: 'License (AGPL-3.0)', link: '/community/license' },
        ],
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'What is Quay 2?', link: '/guide/what-is-quay' },
            { text: 'Architecture & VSA', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Getting Started',
          items: [
            { text: 'Installation & Setup', link: '/guide/installation' },
            { text: 'Quickstart Tutorial', link: '/guide/quickstart' },
            { text: 'Configuration & Settings', link: '/guide/configuration' },
          ],
        },
      ],
      // Only tutorials whose pages exist, so the sidebar never links to an unwritten one.
      '/tutorials/': tutorialsSidebar(publishedTutorials(fileURLToPath(new URL('..', import.meta.url)))),
      '/features/': [
        {
          text: 'Agent Fleet & Orchestration',
          items: [
            { text: 'Supported Agent CLIs', link: '/features/agent-support' },
            { text: 'PiG (Pi in Go)', link: '/features/pig' },
            { text: 'Agent-to-Agent (A2A) Bus', link: '/features/a2a-orchestration' },
            { text: 'Swarm Presets & Splits', link: '/features/swarm-presets' },
          ],
        },
        {
          text: 'Engineering Modules',
          items: [
            { text: 'Archon & SDD Inspector', link: '/features/archon-sdd' },
            { text: 'Machina Praxis Factory', link: '/features/machina-praxis' },
            { text: 'Git Worktrees Management', link: '/features/git-worktrees' },
            { text: 'GitHub Companion & Triage', link: '/features/github-integration' },
            { text: 'Token Spend & Telemetry', link: '/features/token-telemetry' },
            { text: 'Pre-PR Audit Gate', link: '/features/security-audit' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Keyboard Shortcuts', link: '/reference/shortcuts' },
            { text: 'Agent Flags & Env Vars', link: '/reference/cli-flags' },
            { text: 'Tauri IPC API Specification', link: '/reference/ipc-api' },
            { text: 'Troubleshooting & FAQ', link: '/reference/troubleshooting' },
          ],
        },
      ],
      '/community/': [
        {
          text: 'Community & Project',
          items: [
            { text: 'Contributing Guide', link: '/community/contributing' },
            { text: 'Restrictive License (AGPL-3.0)', link: '/community/license' },
          ],
        },
      ],
    },

    search: {
      provider: 'local',
      options: {
        detailedView: true,
      },
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/seanrobertwright/Quay-2' },
    ],

    footer: {
      message: 'Released under the GNU Affero General Public License v3.0 (AGPL-3.0).',
      copyright: 'Copyright © 2026 Sean Robert Wright',
    },

    editLink: {
      pattern: 'https://github.com/seanrobertwright/Quay-2/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
);
};
