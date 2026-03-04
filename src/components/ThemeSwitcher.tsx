import { THEMES, ThemeName } from '../lib/themes';
import { useTheme } from './ThemeContext';

export function ThemeSwitcher() {
  const { themeName, setTheme } = useTheme();

  return (
    <div className="flex gap-2">
      {(Object.keys(THEMES) as ThemeName[]).map((name) => {
        const t = THEMES[name];
        const isActive = name === themeName;

        // Preview color for the button
        const previewColors: Record<ThemeName, string> = {
          clinical: 'bg-teal-500',
          bimbo: 'bg-pink-500',
          void: 'bg-purple-500',
          evil: 'bg-red-600',
        };

        return (
          <button
            key={name}
            onClick={() => setTheme(name)}
            title={t.description}
            className={`w-6 h-6 rounded-full ${previewColors[name]} transition-all ${
              isActive ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : 'opacity-50 hover:opacity-100'
            }`}
            aria-label={`Switch to ${t.label} theme`}
          />
        );
      })}
    </div>
  );
}
