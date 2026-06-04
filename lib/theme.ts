export const darkColors = {
  // Backgrounds
  bg: '#020617',
  surface: '#0F172A',
  surface2: '#1E293B',

  // Borders
  border: '#1E293B',
  borderStrong: '#334155',

  // Text
  text: '#F8FAFC',
  textMuted: '#94A3B8',
  textSubtle: '#475569',

  // Interactive
  primary: '#FFFFFF',
  primaryFg: '#020617',
  accentCyan: '#00D9FF',

  // Inputs
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
  tabBar: '#020617',
  tabActive: '#FFFFFF',
  tabInactive: '#475569',
} as const;

export const lightColors = {
  // Backgrounds
  bg: '#F7F8FC',
  surface: '#FFFFFF',
  surface2: '#EEF2F7',

  // Borders
  border: '#D8DEE8',
  borderStrong: '#C3CBD8',

  // Text
  text: '#1C1C1E',
  textMuted: '#5B6472',
  textSubtle: '#8C95A3',

  // Interactive
  primary: '#1C1C1E',
  primaryFg: '#FFFFFF',
  accentCyan: '#0EA5C6',

  // Inputs
  inputBg: '#FFFFFF',
  inputBorder: '#D8DEE8',
  inputBorderFocus: '#5B6472',
  inputPlaceholder: '#8C95A3',

  // Semantic
  destructive: '#DC2626',
  destructiveMuted: '#FEE2E2',
  success: '#16A34A',
  successMuted: '#DCFCE7',
  warning: '#D97706',

  // Tab bar
  tabBar: '#FFFFFF',
  tabActive: '#1C1C1E',
  tabInactive: '#98A2B3',
} as const;

export type Colors = { [K in keyof typeof darkColors]: string };

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

export function highlightedRowBackground(colors: Colors, isDark: boolean): string {
  return isDark ? `${colors.surface}CC` : colors.surface;
}
