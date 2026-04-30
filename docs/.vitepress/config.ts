import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "gradle-check-updates",
  description: "The missing dependency updater for Gradle. Fast, byte-precise, and security-focused CLI.",
  
  head: [
    ['link', { rel: 'icon', href: '/gradle-check-updates/favicon.ico' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'gradle-check-updates' }],
    ['meta', { property: 'og:description', content: 'The missing dependency updater for Gradle. Fast, byte-precise, and security-focused.' }],
    ['meta', { property: 'og:url', content: 'https://secretx33.github.io/gradle-check-updates/' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "name": "gradle-check-updates",
      "operatingSystem": "Windows, macOS, Linux",
      "applicationCategory": "DeveloperApplication",
      "description": "Fast, byte-precise dependency updater for Gradle projects.",
      "softwareVersion": "0.0.0",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD"
      }
    })]
  ],
  
  // This is required since we will host at https://secretx33.github.io/gradle-check-updates/
  base: '/gradle-check-updates/',
  
  // Make the URL paths cleaner (e.g., /guide/ instead of /guide.html)
  cleanUrls: true,

  themeConfig: {
    // Top navigation bar
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/guide/' },
      { text: 'Architecture', link: '/BOOTSTRAP' }
    ],

    // Sidebar navigation
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'Getting Started', link: '/guide/' },
          { text: 'How it Works', link: '/guide/how-it-works' },
          { text: 'Command Line Options', link: '/guide/options' },
        ]
      },
      {
        text: 'Advanced Usage',
        items: [
          { text: 'Cooldown & Security', link: '/guide/cooldown' },
          { text: 'Configuration', link: '/guide/configuration' },
          { text: 'Repository Auth', link: '/guide/authentication' },
        ]
      },
      {
        text: 'Internal Design',
        items: [
          { text: 'Architecture & Design', link: '/BOOTSTRAP' },
        ]
      }
    ],

    // Social links in the header
    socialLinks: [
      { icon: 'github', link: 'https://github.com/SecretX33/gradle-check-updates' }
    ],
    
    // Search functionality (built-in)
    search: {
      provider: 'local'
    },
    
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present SecretX33'
    }
  },
  
  sitemap: {
    hostname: 'https://secretx33.github.io/gradle-check-updates/'
  }
})
