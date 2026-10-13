import type { Config } from 'tailwindcss';

/**
 * Sistema de color Fem.
 *
 * El manual de marca define dos tintas y su proporción: Rosa Melocotón al 70 %
 * y Rojo Pimiento al 30 %. Esa proporción se traduce así en producto:
 *
 *   brand  (Rosa Melocotón #FF9DA3) → superficies, tintes, bordes, avatares.
 *                                     Es el 70 %: cubre mucha área, poca fuerza.
 *   pepper (Rojo Pimiento  #ED5340) → acciones, estado activo, datos.
 *                                     Es el 30 %: poca área, toda la fuerza.
 *
 * Los pasos 600/700 de cada escala existen porque los colores de marca puros
 * no alcanzan contraste AA con texto blanco (#FF9DA3 = 1.98:1, #ED5340 = 3.55:1).
 * Todo lo que lleve texto encima usa pepper-600 (4.77:1) o pepper-700 (6.50:1).
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Montserrat', 'system-ui', 'sans-serif'],
        display: ['MontserratAlt', 'Montserrat', 'sans-serif'],
      },
      colors: {
        // Rosa Melocotón — la tinta del 70 %
        brand: {
          DEFAULT: '#FF9DA3',
          50:  '#FFF5F5',
          100: '#FFE7E8',
          200: '#FFD2D4',
          300: '#FFB8BC',
          400: '#FF9DA3',
          500: '#FA8189',
          600: '#EE656F',
          700: '#C94D57',
          800: '#9E3B44',
          900: '#6B272E',
        },
        // Rojo Pimiento — la tinta del 30 %
        pepper: {
          DEFAULT: '#ED5340',
          50:  '#FFF3F1',
          100: '#FFE2DD',
          200: '#FFC7BE',
          300: '#F89C8B',
          400: '#F2705A',
          500: '#ED5340',
          600: '#D33A22',
          700: '#B32812',
          800: '#8F2010',
          900: '#66170D',
        },
        // Tinta de texto: casi negro con la temperatura cálida de la marca
        ink: {
          DEFAULT: '#2E1614',
          soft:    '#5C2A24',
          muted:   '#8C6B66',
        },
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
