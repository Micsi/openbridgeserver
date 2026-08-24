import { defineConfig } from 'vitepress'

// Served by FastAPI under /help (see obs/main.py) — analogous to gui_dist (/)
// and frontend_dist (/visu). Build output lives at ../help_dist, sibling to
// gui_dist/ and frontend_dist/, same as gui/ and frontend/ build to their
// own *_dist/ directories.
//
// German (`de`) is the Weblate source language for this repo (see
// docs/AGENT_REFERENCE.md, Internationalisation section) — it is the root
// locale here too. English lives under /en/.
export default defineConfig({
  base: '/help/',
  outDir: '../help_dist',
  title: 'open bridge server Hilfe',

  locales: {
    root: {
      label: 'Deutsch',
      lang: 'de',
      title: 'open bridge server Hilfe',
      description: 'Integriertes Hilfesystem für open bridge server',
      themeConfig: {
        nav: [{ text: 'Start', link: '/' }],
        sidebar: [
          {
            text: 'Erste Schritte',
            items: [{ text: 'Übersicht', link: '/' }],
          },
        ],
        outline: { label: 'Auf dieser Seite' },
        docFooter: { prev: 'Vorherige Seite', next: 'Nächste Seite' },
        darkModeSwitchLabel: 'Darstellung',
        returnToTopLabel: 'Nach oben',
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      link: '/en/',
      title: 'open bridge server Help',
      description: 'Integrated help system for open bridge server',
      themeConfig: {
        nav: [{ text: 'Home', link: '/en/' }],
        sidebar: [
          {
            text: 'Getting Started',
            items: [{ text: 'Overview', link: '/en/' }],
          },
        ],
      },
    },
  },

  themeConfig: {
    socialLinks: [
      { icon: 'github', link: 'https://github.com/abeggled/openbridgeserver' },
    ],
  },
})
