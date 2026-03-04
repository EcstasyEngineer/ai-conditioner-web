import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ThemeName, AppTheme, THEMES, getStoredTheme, setStoredTheme } from '../lib/themes';

interface ThemeContextValue {
  theme: AppTheme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeName, setThemeName] = useState<ThemeName>(getStoredTheme);

  useEffect(() => {
    setStoredTheme(themeName);
  }, [themeName]);

  const value: ThemeContextValue = {
    theme: THEMES[themeName],
    themeName,
    setTheme: setThemeName,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
