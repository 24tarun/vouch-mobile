// Dark theme — exact match to vouch-web's slate dark-mode palette
// Web body background: #020617 (slate-950)
// Web uses Tailwind slate-* throughout: slate-900=#0F172A, slate-800=#1E293B, etc.

export const colors = {
  // Backgrounds — slate-950 / slate-900 / slate-800
  bg: '#020617',          // slate-950: web body background
  surface: '#0F172A',     // slate-900: card / sheet surface
  surface2: '#1E293B',    // slate-800: elevated surface (modals, popovers)

  // Borders — slate-800 / slate-700
  border: '#1E293B',      // slate-800: default border
  borderStrong: '#334155', // slate-700: stronger separator

  // Text — slate-50 / slate-400 / slate-600
  text: '#F8FAFC',        // slate-50: primary text
  textMuted: '#94A3B8',   // slate-400: secondary / placeholder text
  textSubtle: '#475569',  // slate-600: disabled / very muted

  // Interactive
  primary: '#FFFFFF',     // white primary button
  primaryFg: '#020617',   // slate-950 for contrast on white
  accentCyan: '#00D9FF',  // signature Vouch cyan (unchanged)

  // Inputs — slate-900 bg, slate-700 border
  inputBg: '#0F172A',
  inputBorder: '#334155',
  inputBorderFocus: '#475569',
  inputPlaceholder: '#475569',

  // Semantic
  destructive: '#EF4444',
  destructiveMuted: '#3F1515',
  success: '#22C55E',
  successMuted: '#14261D',
  warning: '#F59E0B',

  // Tab bar
  tabBar: '#020617',      // slate-950: same as bg
  tabActive: '#FFFFFF',
  tabInactive: '#475569', // slate-600
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;

export const typography = {
  // Sizes
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 30,
  xxxl: 38,

  // Weights
  normal: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
} as const;
