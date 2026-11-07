/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // TRACE light palette (redesign brief, exact values):
        // background #F7F3EB, card #FFFFFF, secondary #F3EBDD, border #E9E2D6.
        ivory: {
          DEFAULT: '#F7F3EB', // page background
          50: '#FFFFFF', // card surface
          100: '#F3EBDD', // secondary surface
          200: '#E9E2D6', // stone (same as the border colour)
          300: '#DDD3C2',
        },
        // Primary dark surfaces
        charcoal: {
          DEFAULT: '#171714',
          900: '#11110F', // deep charcoal
          800: '#171714',
          700: '#252520', // dark graphite
        },
        // Accents
        // Gold #B68A42 is for accents, fills, borders and icons (3:1 on white).
        // Gold that must be read as text, or carry white text, uses 700/800:
        // deeper shades of the same gold that pass WCAG AA (5.3:1 on white).
        gold: {
          DEFAULT: '#B68A42',
          300: '#C6A66B', // muted gold
          200: '#D9C08F',
          700: '#8A6528', // gold text, gold buttons
          800: '#755521', // gold button hover
        },
        sage: {
          DEFAULT: '#78866B',
          300: '#9AA88C',
          600: '#344C3A', // deep forest
        },
        // Text
        ink: {
          DEFAULT: '#171714', // text
          600: '#77736A', // secondary text
        },
        line: '#E9E2D6', // borders
        cream: {
          DEFAULT: '#F3EBDD', // light on dark
          muted: '#B7B0A2', // muted light
        },
        // Semantic
        forest: '#278653', // success green
        amber: '#B07D2E', // antique amber warning
        brick: '#9A4B3A', // restrained brick red error
        graphite: '#252520',
      },
      fontFamily: {
        // Playfair Display: page titles and the wordmark. Inter: body and UI.
        // IBM Plex Mono: hashes and addresses only.
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // Quiet: white cards sit on the warm page with a hairline and the
        // faintest lift. Only overlays (menus, tooltips, dialogs) cast a shadow.
        soft: '0 1px 2px rgba(23,23,20,0.04)',
        card: '0 1px 2px rgba(23,23,20,0.04)',
        glow: 'none',
        lift: '0 1px 2px rgba(23,23,20,0.04)',
        overlay: '0 12px 32px -12px rgba(23,23,20,0.24)',
      },
      borderRadius: {
        md2: '6px',
        lg2: '8px',
        panel: '8px',
        card: '8px',
      },
      letterSpacing: {
        wide2: '0.14em',
      },
      // Extend the opacity scale so the modifiers used throughout the UI
      // (e.g. border-ink/8, bg-gold/12, divide-ink/14) all generate CSS.
      // Values are percentages, so /12 -> 12%. Merged over the defaults.
      opacity: {
        2: '0.02',
        4: '0.04',
        5: '0.05',
        8: '0.08',
        10: '0.1',
        12: '0.12',
        14: '0.14',
        15: '0.15',
        20: '0.2',
        85: '0.85',
        95: '0.95',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        drawLine: {
          '0%': { 'stroke-dashoffset': '1' },
          '100%': { 'stroke-dashoffset': '0' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        fadeUp: 'fadeUp 0.5s ease-out both',
        pulseSoft: 'pulseSoft 2.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
