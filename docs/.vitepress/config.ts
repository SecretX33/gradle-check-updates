import { defineConfig } from 'vitepress'

export default defineConfig({
  title: "gradle-check-updates",
  description: "The missing dependency updater for Gradle. Fast, byte-precise, and security-focused CLI.",
  
  // This is required since we will host at https://SecretX33.github.io/gradle-check-updates/
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
  }
})
