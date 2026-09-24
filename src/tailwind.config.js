/** Tailwind build config (only needed if you change styles – the compiled app.css is already included). */
module.exports = {
  content: ['./index.html', './app.js'],
  future: { hoverOnlyWhenSupported: true },  // no sticky hover effects on phones
  theme: {
    extend: {
      fontFamily: {
        display: ['Unbounded', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', 'monospace'],
        pixel: ['"Pixelify Sans"', 'monospace'],
      },
      // Colors are CSS variables (see src/input.css) so Settings → Theme can switch light/dark and the accent color.
      colors: Object.fromEntries(['base', 'surface', 'raised', 'overlay', 'line', 'line2', 'ink', 'sub', 'mute', 'lilac', 'volt', 'pink', 'onaccent', 'onvolt', 'inv']
        .map((c) => [c, `rgb(var(--c-${c}) / <alpha-value>)`])),
      transitionTimingFunction: { expo: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    },
  },
  plugins: [],
};
