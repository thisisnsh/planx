import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'planx',
  description: "Your agent's plan, as a versioned artifact you can annotate and lock.",
  // Project page under thisisnsh.github.io/planx/. Swap to '/' if a custom
  // domain is wired up later.
  base: '/planx/',
  cleanUrls: true,
  lastUpdated: true,

  head: [['meta', { name: 'theme-color', content: '#3c7d5c' }]],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/install' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'npm', link: 'https://www.npmjs.com/package/@thisisnsh/planx' },
    ],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Install', link: '/guide/install' },
          { text: 'Claude Code', link: '/guide/claude-code' },
          { text: 'Codex', link: '/guide/codex' },
          { text: 'The review loop', link: '/guide/review-loop' },
          { text: 'Locking', link: '/guide/locking' },
          { text: 'Diffing', link: '/guide/diffing' },
          { text: 'Executing', link: '/guide/executing' },
          { text: 'Retention', link: '/guide/retention' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Configuration', link: '/reference/config' },
          { text: 'Storage', link: '/reference/storage' },
        ],
      },
      { text: 'Troubleshooting', link: '/troubleshooting' },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/thisisnsh/planx' }],

    editLink: {
      pattern: 'https://github.com/thisisnsh/planx/edit/main/site/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'MIT licensed.',
      copyright: 'Copyright © 2026 thisisnsh',
    },

    search: { provider: 'local' },
  },
});
