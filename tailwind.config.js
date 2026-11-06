/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary backgrounds
        // Minimal light theme: canvas, white cards, warm secondary surface
        // Paper: a neutral warm grey (not cream), white panels, quiet secondary surfaces
        ivory: {
          DEFAULT: '#F4F3EF', // main background
          50: '#FFFFFF', // panel surface
          100: '#ECEAE4', // secondary surface
          200: '#E2DFD8', // stone
          300: '#D3CFC6',
        },
        // Primary dark surfaces
        charcoal: {
          DEFAULT: '#171714',
          900: '#11110F', // deep charcoal
          800: '#171714',
          700: '#252520', // dark graphite
        },
        // Accents
        gold: {
          DEFAULT: '#946A2B', // brand ochre (AA with white text)
          300: '#C6A66B', // muted gold
          200: '#D9C08F',
        },
        sage: {
          DEFAULT: '#78866B',
          300: '#9AA88C',
          600: '#344C3A', // deep forest
        },
        // Text
        ink: {
          DEFAULT: '#17181B',
          600: '#5F6166', // secondary text (AA on paper and white)
        },
        line: '#DEDBD3', // hairline borders
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
        // `serif` is the wordmark face only; everything else is Plex.
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        // Flat, instrument-like: panels are separated by rules, not floating shadows.
        // Only overlays (menus, tooltips, dialogs) keep a real shadow.
        soft: '0 1px 0 rgba(23,24,27,0.04)',
        card: '0 1px 0 rgba(23,24,27,0.04)',
        glow: 'none',
        lift: '0 1px 0 rgba(23,24,27,0.05)',
        overlay: '0 12px 32px -12px rgba(23,24,27,0.28)',
      },
      borderRadius: {
        md2: '5px',
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
