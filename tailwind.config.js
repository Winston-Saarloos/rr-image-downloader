/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Terminal lime green theme
        terminal: {
          bg: '#0a0a0a', // Deep black background
          surface: '#111111', // Slightly lighter black for panels
          border: '#1a1a1a', // Dark border
          text: '#00ff00', // Bright lime green text
          textDim: '#00cc00', // Dimmed lime green
          textMuted: '#008800', // Muted lime green
          accent: '#00ff41', // Matrix green accent
          warning: '#ffff00', // Yellow warning
          error: '#ff0000', // Red error
          success: '#00ff00', // Green success
          info: '#00ffff', // Cyan info
        },
      },
      fontFamily: {
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Consolas',
          'Monaco',
          'monospace',
        ],
        terminal: ['Courier New', 'monospace'],
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
