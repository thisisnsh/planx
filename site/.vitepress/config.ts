import { defineConfig } from 'vitepress';

const description =
  'PlanX is an open-source skill and terminal review interface for versioning, annotating, revising, comparing, approving, and executing AI coding-agent plans.';

const softwareSchema = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'PlanX',
  alternateName: 'PlanX CLI',
  url: 'https://planx.sh/',
  description,
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'AI coding agent planning tool',
  operatingSystem: ['macOS', 'Linux', 'Windows'],
  softwareRequirements: 'Node.js 20.19 or newer',
  downloadUrl: 'https://www.npmjs.com/package/@thisisnsh/planx',
  installUrl: 'https://www.npmjs.com/package/@thisisnsh/planx',
  codeRepository: 'https://github.com/thisisnsh/planx',
  license: 'https://opensource.org/license/mit',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  author: {
    '@type': 'Person',
    name: 'Nishant Hada',
    url: 'https://github.com/thisisnsh',
  },
});

const faqSchema = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What is PlanX?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: "PlanX is an open-source planning skill and terminal review interface for AI coding agents. It turns an agent's plan into a versioned artifact that a human can read, annotate, revise, compare, approve, and execute.",
      },
    },
    {
      '@type': 'Question',
      name: 'Does PlanX work with Codex?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. PlanX installs a skill for Codex. Use $planx <task> in a new Codex session to create a reviewable plan.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does PlanX work with Claude Code?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. PlanX installs a skill for Claude Code. Use /planx <task> in a new Claude Code session to create a reviewable plan.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can PlanX work with other AI agents?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Configure any AI agent command that accepts a trailing prompt and install the PlanX skill for the receiving agent.',
      },
    },
    {
      '@type': 'Question',
      name: 'How is PlanX different from agent plan mode?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'PlanX adds a durable review artifact around planning: versions, word-level diffs, exact-line comments, direct edits, collapsible sections, approval, and cross-agent hand-offs.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is PlanX open source?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. PlanX is MIT licensed, published on npm, and its source is available on GitHub.',
      },
    },
  ],
});

export default defineConfig({
  title: 'PlanX',
  titleTemplate: ':title · PlanX',
  description,
  lang: 'en-US',
  base: '/',
  cleanUrls: true,
  sitemap: { hostname: 'https://planx.sh/' },
  appearance: 'force-dark',

  head: [
    ['meta', { name: 'theme-color', content: '#171d28' }],
    ['meta', { name: 'color-scheme', content: 'dark' }],
    [
      'meta',
      {
        name: 'robots',
        content: 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1',
      },
    ],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'AI coding agent planning, Codex skill, Claude Code skill, agent plan review, plan diff, PlanX CLI',
      },
    ],
    ['meta', { name: 'author', content: 'Nishant Hada' }],
    ['meta', { property: 'og:site_name', content: 'PlanX' }],
    ['meta', { property: 'og:title', content: 'PlanX — build plans worth executing' }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:image', content: 'https://planx.sh/images/planx-view.png' }],
    ['meta', { property: 'og:image:width', content: '1340' }],
    ['meta', { property: 'og:image:height', content: '556' }],
    ['meta', { property: 'og:image:alt', content: 'The PlanX terminal plan review interface' }],
    ['meta', { property: 'og:url', content: 'https://planx.sh/' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'PlanX — build plans worth executing' }],
    ['meta', { name: 'twitter:description', content: description }],
    ['meta', { name: 'twitter:image', content: 'https://planx.sh/images/planx-view.png' }],
    ['link', { rel: 'canonical', href: 'https://planx.sh/' }],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
    ['script', { type: 'application/ld+json' }, softwareSchema],
    ['script', { type: 'application/ld+json' }, faqSchema],
  ],

  themeConfig: {
    socialLinks: [{ icon: 'github', link: 'https://github.com/thisisnsh/planx' }],
  },
});
