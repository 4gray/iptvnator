import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          950: '#0a0a08',
          900: '#121210',
          850: '#1a1a17',
          800: '#22221e',
          700: '#2e2e28',
          600: '#3a3a33',
          500: '#52524a',
          400: '#6b6b62',
          300: '#8a8a80',
          200: '#b0b0a6',
          100: '#d4d4cc',
          50: '#f0f0eb',
        },
        accent: {
          950: '#021c1c',
          900: '#053838',
          800: '#0a5454',
          700: '#107070',
          600: '#178c8c',
          500: '#20a8a8',
          400: '#38c4c4',
          300: '#5ee0e0',
          200: '#8aecec',
          100: '#b8f4f4',
          50: '#e0fafa',
        },
        warm: {
          500: '#d4a853',
          400: '#e0bc6a',
          300: '#ecd08a',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        '7xl': ['4.5rem', { lineHeight: '1.05', letterSpacing: '-0.03em' }],
        '8xl': ['6rem', { lineHeight: '1', letterSpacing: '-0.04em' }],
        '9xl': ['8rem', { lineHeight: '0.95', letterSpacing: '-0.04em' }],
      },
      animation: {
        'fade-up': 'fadeUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'fade-in': 'fadeIn 0.6s ease forwards',
        'glow-pulse': 'glowPulse 4s ease-in-out infinite',
        'scan': 'scan 8s linear infinite',
        'tv-scan': 'tvScan 3s linear infinite',
        'tv-flicker': 'tvFlicker 0.15s infinite',
        'tv-glow': 'tvGlow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(30px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.8' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        tvScan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        tvFlicker: {
          '0%': { opacity: '0.97' },
          '5%': { opacity: '0.95' },
          '10%': { opacity: '0.98' },
          '15%': { opacity: '0.94' },
          '20%': { opacity: '0.98' },
          '50%': { opacity: '0.96' },
          '80%': { opacity: '0.98' },
          '90%': { opacity: '0.95' },
          '100%': { opacity: '0.98' },
        },
        tvGlow: {
          '0%, 100%': { boxShadow: '0 0 30px rgba(32, 168, 168, 0.3), 0 0 60px rgba(32, 168, 168, 0.1), inset 0 0 30px rgba(32, 168, 168, 0.05)' },
          '50%': { boxShadow: '0 0 40px rgba(32, 168, 168, 0.4), 0 0 80px rgba(32, 168, 168, 0.15), inset 0 0 40px rgba(32, 168, 168, 0.08)' },
        },
      },
    },
  },
  plugins: [typography],
};
