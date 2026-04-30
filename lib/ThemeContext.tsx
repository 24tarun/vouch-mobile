import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors, type Colors } from '@/lib/theme';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  colors: Colors;
  theme: ThemeMode;
  isDark: boolean;
  setTheme: (theme: ThemeMode) => void;
}

const STORAGE_KEY = 'vouch_theme';

const ThemeContext = createContext<ThemeContextValue>({
  colors: darkColors,
  theme: 'system',
  isDark: true,
  setTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [theme, setThemeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((storedTheme) => {
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
        setThemeState(storedTheme);
      }
    });
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const isDark = theme === 'system' ? systemScheme !== 'light' : theme === 'dark';
  const colors = isDark ? darkColors : lightColors;
  const value = useMemo(() => ({ colors, theme, isDark, setTheme }), [colors, theme, isDark, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
