import type { Config } from 'tailwindcss';

/** Colours are CSS variables (space-separated RGB channels) so opacity modifiers still work. */
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',
      bg: rgb('bg'),
      surface: rgb('surface'),
      ink: rgb('ink'),
      secondary: rgb('secondary'),
      tertiary: rgb('tertiary'),
      hairline: rgb('hairline'),
      green: rgb('green'),
      orange: rgb('orange'),
      red: rgb('red'),
    },
    fontFamily: {
      sans: [
        '-apple-system',
        'BlinkMacSystemFont',
        '"SF Pro Display"',
        '"SF Pro Text"',
        'Inter',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ],
      mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'],
    },
    extend: {
      fontSize: {
        display: ['48px', { lineHeight: '1.08', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-sm': ['40px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        section: ['28px', { lineHeight: '1.14', letterSpacing: '-0.015em', fontWeight: '600' }],
        card: ['21px', { lineHeight: '1.24', letterSpacing: '-0.012em', fontWeight: '600' }],
        body: ['17px', { lineHeight: '1.47', letterSpacing: '-0.01em' }],
        small: ['14px', { lineHeight: '1.43', letterSpacing: '-0.005em' }],
        caption: ['12px', { lineHeight: '1.33', letterSpacing: '0' }],
      },
      borderRadius: {
        card: '18px',
        input: '12px',
        pill: '980px',
      },
      boxShadow: {
        soft: '0 4px 24px rgba(0,0,0,.06)',
      },
      maxWidth: {
        content: '1080px',
        chat: '720px',
      },
      height: { nav: '52px' },
      transitionTimingFunction: { out: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.55' } },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        indeterminate: { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(250%)' } },
      },
      animation: {
        'fade-up': 'fade-up 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'fade-in': 'fade-in 200ms ease-out both',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-up': 'slide-up 300ms cubic-bezier(0.16, 1, 0.3, 1) both',
        pulse: 'pulse 1.6s ease-in-out infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        indeterminate: 'indeterminate 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
