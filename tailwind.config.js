/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary backgrounds
        // Minimal light theme: canvas, white cards, warm secondary surface
        ivory: {
          DEFAULT: '#F7F3EB', // main background
          50: '#FFFFFF', // card surface
          100: '#F3EBDD', // secondary surface
          200: '#E9E0D0', // warm stone
          300: '#DDD2BC',
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
          DEFAULT: '#B68A42', // antique gold
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
          DEFAULT: '#171714',
          600: '#77736A', // secondary text
        },
        line: '#E9E2D6', // hairline borders
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
        serif: ['var(--font-serif)', 'Playfair Display', 'Cormorant Garamond', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'Inter', 'Geist', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(23,23,20,0.04), 0 8px 24px -12px rgba(23,23,20,0.12)',
        card: '0 1px 0 rgba(23,23,20,0.03), 0 10px 30px -18px rgba(23,23,20,0.25)',
        glow: '0 1px 2px rgba(120,86,30,0.18), 0 6px 16px -8px rgba(182,138,66,0.55)',
        lift: '0 1px 2px rgba(23,23,20,0.03), 0 12px 32px -20px rgba(80,62,30,0.22)',
      },
      borderRadius: {
        md2: '10px',
        lg2: '14px',
        panel: '16px',
        card: '14px',
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
