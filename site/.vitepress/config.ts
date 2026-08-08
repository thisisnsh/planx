import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'PlanX',
  titleTemplate: ':title · PlanX',
  description: "Review an agent's plan with feedback on exact lines and a diff for every revision.",
  // Served from the root of planx.sh, so no base path.
  base: '/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://planx.sh/' },

  head: [
    ['meta', { name: 'theme-color', content: '#ffd400' }],
    ['meta', { property: 'og:site_name', content: 'PlanX' }],
    ['meta', { property: 'og:title', content: 'PlanX — review an agent plan like code' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Attach feedback to exact lines, compare revisions, and execute the plan you approve.',
      },
    ],
    // The wordmark's block cursor, on its own.
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
  ],

  // Black and yellow, and only that. A light variant of this palette is a
  // different design, not the same one inverted, so there is no toggle.
  appearance: 'force-dark',

  themeConfig: {
    // Every page is reachable from the sidebar, so the nav carries only the
    // place the literal package lives elsewhere.
    nav: [{ text: 'npm', link: 'https://www.npmjs.com/package/@thisisnsh/planx' }],

    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Install', link: '/install' },
          { text: 'Review a plan', link: '/review-loop' },
          { text: 'Compare versions', link: '/diffing' },
          { text: 'Revise with Claude Code', link: '/claude-code' },
          { text: 'Revise with Codex', link: '/codex' },
          { text: 'Execute a plan', link: '/executing' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'CLI', link: '/reference/cli' },
          { text: 'Configuration', link: '/reference/config' },
          { text: 'Storage', link: '/reference/storage' },
          { text: 'Delete plans', link: '/retention' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
        ],
      },
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
