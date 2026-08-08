import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'PlanX',
  titleTemplate: ':title · PlanX',
  description:
    'A skill and terminal review interface for versioning, annotating, revising, and executing coding-agent plans.',
  base: '/',
  cleanUrls: true,
  sitemap: { hostname: 'https://planx.sh/' },
  appearance: 'force-dark',

  head: [
    ['meta', { name: 'theme-color', content: '#080808' }],
    ['meta', { name: 'color-scheme', content: 'dark' }],
    ['meta', { property: 'og:site_name', content: 'PlanX' }],
    ['meta', { property: 'og:title', content: 'PlanX — review the plan, not the agent' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Version plans, compare every revision, attach feedback to exact lines, and execute only what you approve.',
      },
    ],
    [
      'meta',
      {
        property: 'og:image',
        content: 'https://raw.githubusercontent.com/thisisnsh/planx/main/assets/planx-review.png',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://planx.sh/' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['link', { rel: 'canonical', href: 'https://planx.sh/' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
  ],

  themeConfig: {
    socialLinks: [{ icon: 'github', link: 'https://github.com/thisisnsh/planx' }],
  },
});
