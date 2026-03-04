/**
 * Visual theme system for the app
 */

export type ThemeName = 'clinical' | 'bimbo' | 'void' | 'evil';

/**
 * Subject (pet) and Controller (dom) name options
 * Based on actual usage data from conditioner bot logs
 */
export const SUBJECT_NAMES = [
  { value: 'Pet', label: 'Pet' },
  { value: 'Puppet', label: 'Puppet' },
  { value: 'Slave', label: 'Slave' },
  { value: 'Bimbo', label: 'Bimbo' },
  { value: 'Toy', label: 'Toy' },
  { value: 'Kitten', label: 'Kitten' },
] as const;

export const CONTROLLER_NAMES = [
  { value: 'Master', label: 'Master' },
  { value: 'Mistress', label: 'Mistress' },
  { value: 'Goddess', label: 'Goddess' },
  { value: 'Owner', label: 'Owner' },
] as const;

export type SubjectName = typeof SUBJECT_NAMES[number]['value'];
export type ControllerName = typeof CONTROLLER_NAMES[number]['value'];

export interface AppTheme {
  name: ThemeName;
  label: string;
  description: string;
  colors: {
    bg: string;
    bgSecondary: string;
    border: string;
    text: string;
    textMuted: string;
    primary: string;
    primaryHover: string;
    accent: string;
  };
}

export const THEMES: Record<ThemeName, AppTheme> = {
  clinical: {
    name: 'clinical',
    label: 'Clinical',
    description: 'Teal & gray - hypnotherapist vibes',
    colors: {
      bg: 'bg-gray-950',
      bgSecondary: 'bg-gray-900',
      border: 'border-gray-800',
      text: 'text-white',
      textMuted: 'text-gray-400',
      primary: 'bg-teal-600',
      primaryHover: 'hover:bg-teal-700',
      accent: 'text-teal-400',
    },
  },
  bimbo: {
    name: 'bimbo',
    label: 'Bimbo',
    description: 'Pink & magenta - sweet & dumb',
    colors: {
      bg: 'bg-fuchsia-950',
      bgSecondary: 'bg-fuchsia-900/50',
      border: 'border-fuchsia-800',
      text: 'text-pink-100',
      textMuted: 'text-pink-300/70',
      primary: 'bg-pink-500',
      primaryHover: 'hover:bg-pink-600',
      accent: 'text-pink-300',
    },
  },
  void: {
    name: 'void',
    label: 'Void',
    description: 'Purple & black - mystical trance',
    colors: {
      bg: 'bg-slate-950',
      bgSecondary: 'bg-purple-950/50',
      border: 'border-purple-900',
      text: 'text-purple-100',
      textMuted: 'text-purple-300/70',
      primary: 'bg-purple-600',
      primaryHover: 'hover:bg-purple-700',
      accent: 'text-purple-400',
    },
  },
  evil: {
    name: 'evil',
    label: 'Evil',
    description: 'Red & black - dark control',
    colors: {
      bg: 'bg-black',
      bgSecondary: 'bg-red-950/30',
      border: 'border-red-900/50',
      text: 'text-red-100',
      textMuted: 'text-red-300/50',
      primary: 'bg-red-700',
      primaryHover: 'hover:bg-red-800',
      accent: 'text-red-500',
    },
  },
};

const STORAGE_KEY = 'hypnoapp-theme';

export function getStoredTheme(): ThemeName {
  if (typeof window === 'undefined') return 'clinical';
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && stored in THEMES) return stored as ThemeName;
  return 'clinical';
}

export function setStoredTheme(theme: ThemeName): void {
  localStorage.setItem(STORAGE_KEY, theme);
}
