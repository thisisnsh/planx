import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'planx',
  description: "Your agent's plan, as a versioned artifact you can annotate and lock.",
  // Served from the root of planx.sh, so no base path.
  base: '/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://planx.sh/' },

  head: [
    ['meta', { name: 'theme-color', content: '#ffd400' }],
    // The wordmark's block cursor, on its own.
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
  ],

  // Black and yellow, and only that. A light variant of this palette is a
  // different design, not the same one inverted, so there is no toggle.
  appearance: 'force-dark',

  themeConfig: {
    // Every page is a doc page reachable from the sidebar, so the nav bar
    // carries only what the sidebar cannot: the places planx lives elsewhere.
    nav: [{ text: 'npm', link: 'https://www.npmjs.com/package/@thisisnsh/planx' }],

    // The nav title already links to '/', so the overview does not need a
    // sidebar entry of its own — the wordmark is the way back to it.
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Install', link: '/install' },
          { text: 'Claude Code', link: '/claude-code' },
          { text: 'Codex', link: '/codex' },
          { text: 'Review Loop', link: '/review-loop' },
          { text: 'Diffing', link: '/diffing' },
          { text: 'Executing', link: '/executing' },
          { text: 'Deleting', link: '/retention' },
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
