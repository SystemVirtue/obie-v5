/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        console: {
          bg: '#0a0a0f',
          surface: '#12121a',
          panel: '#1a1a25',
          strip: '#15151f',
          border: '#2a2a3a',
          accent: '#00d4ff',
          green: '#00ff88',
          yellow: '#ffd000',
          red: '#ff3344',
          orange: '#ff8800',
          mute: '#ff2244',
          solo: '#ffdd00',
          text: '#e0e0e8',
          dim: '#666680',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'SF Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
}
