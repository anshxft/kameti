/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Cybercore palette — all reference the CSS custom properties set in index.css
        // so light/dark theme switching (via [data-theme="dark"]) works automatically.
        paper:       'var(--paper)',
        'paper-2':   'var(--paper-2)',
        ink:         'var(--ink)',
        'ink-2':     'var(--ink-2)',
        muted:       'var(--muted)',
        line:        'var(--line)',
        'line-strong': 'var(--line-strong)',
        signal:      'var(--signal)',
        'on-signal': 'var(--on-signal)',
      },
      fontFamily: {
        display: ['"Tektur Variable"', '"Space Grotesk Variable"', 'sans-serif'],
        sans:    ['"Space Grotesk Variable"', 'system-ui', 'sans-serif'],
        mono:    ['"Space Mono"', 'ui-monospace', 'monospace'],
      },
      transitionTimingFunction: {
        'ease-out-strong':  'cubic-bezier(0.23, 1, 0.32, 1)',
        'ease-in-out-strong': 'cubic-bezier(0.77, 0, 0.175, 1)',
      },
    },
  },
  plugins: [],
}
