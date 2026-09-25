import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

/**
 * Paleta SCOLA: branco, preto e amarelo.
 * As telas herdadas usam classes `emerald-*` como "cor de destaque". Em vez de reescrever
 * centenas de classes, a escala emerald foi redefinida: tons claros = amarelo suave
 * (fundos/realces) e tons fortes = preto (botões, textos de destaque, bordas de foco).
 */
const accent = {
  50: '#FEFCE8',
  100: '#FEF9C3',
  200: '#FDE68A',
  300: '#FACC15',
  400: '#EAB308',
  500: '#262626',
  600: '#171717',
  700: '#0A0A0A',
  800: '#0A0A0A',
  900: '#000000',
  950: '#000000',
};

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        emerald: accent,
        border: hsl('border'),
        input: hsl('input'),
        ring: hsl('ring'),
        background: hsl('background'),
        foreground: hsl('foreground'),
        card: { DEFAULT: hsl('card'), foreground: hsl('card-foreground') },
        muted: { DEFAULT: hsl('muted'), foreground: hsl('muted-foreground') },
        primary: { DEFAULT: hsl('primary'), foreground: hsl('primary-foreground') },
        brand: { DEFAULT: hsl('brand'), foreground: hsl('brand-foreground') },
        destructive: { DEFAULT: hsl('destructive'), foreground: hsl('destructive-foreground') },
      },
      boxShadow: {
        soft: '0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.05)',
        card: '0 1px 2px rgba(0,0,0,.04), 0 2px 8px rgba(0,0,0,.04)',
        lift: '0 12px 28px -10px rgba(0,0,0,.18), 0 4px 10px -4px rgba(0,0,0,.08)',
        glow: '0 1px 2px rgba(0,0,0,.20)',
        'glow-lg': '0 6px 16px -6px rgba(0,0,0,.35)',
      },
      borderRadius: { '2xl': '1rem' },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(180deg, #262626, #0A0A0A)',
        'brand-sheen': 'linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,0) 60%)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .3s ease-out both',
        'fade-up': 'fade-up .35s cubic-bezier(.21,1.02,.73,1) both',
        'scale-in': 'scale-in .25s ease-out both',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
