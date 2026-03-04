import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAvailableThemes } from '@lib/theme-loader';
import { encodeSessionParams } from '@lib/url-params';
import { useTheme } from '../components/ThemeContext';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { SUBJECT_NAMES, CONTROLLER_NAMES } from '../lib/themes';

export default function Builder() {
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [themes, setThemes] = useState<string[]>([]);
  const [sessionTheme, setSessionTheme] = useState('');
  const [petName, setPetName] = useState<string>(SUBJECT_NAMES[0].value);
  const [dominantName, setDominantName] = useState<string>(CONTROLLER_NAMES[0].value);
  const [duration, setDuration] = useState(10);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAvailableThemes().then((t) => {
      setThemes(t);
      if (t.length > 0) setSessionTheme(t[0]);
      setLoading(false);
    });
  }, []);

  const canGenerate = sessionTheme && petName && dominantName && duration > 0;

  const handleGenerate = () => {
    if (!canGenerate) return;

    const params = encodeSessionParams({
      theme: sessionTheme,
      petName,
      dominantName,
      duration,
    });

    navigate(`/play?${params}`);
  };

  const { colors } = theme;

  if (loading) {
    return (
      <div className={`min-h-screen ${colors.bg} ${colors.text} flex items-center justify-center`}>
        <p>Loading themes...</p>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${colors.bg} ${colors.text} p-8`}>
      <div className="max-w-md mx-auto">
        {/* Header with theme switcher */}
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Session Builder</h1>
          <ThemeSwitcher />
        </div>

        <div className="space-y-6">
          {/* Theme Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Theme</label>
            <select
              value={sessionTheme}
              onChange={(e) => setSessionTheme(e.target.value)}
              className={`w-full ${colors.bgSecondary} ${colors.border} border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-current`}
            >
              {themes.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1).replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Pet Name */}
          <div>
            <label className="block text-sm font-medium mb-2">Subject</label>
            <select
              value={petName}
              onChange={(e) => setPetName(e.target.value)}
              className={`w-full ${colors.bgSecondary} ${colors.border} border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-current`}
            >
              {SUBJECT_NAMES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          {/* Dominant Name */}
          <div>
            <label className="block text-sm font-medium mb-2">Controller</label>
            <select
              value={dominantName}
              onChange={(e) => setDominantName(e.target.value)}
              className={`w-full ${colors.bgSecondary} ${colors.border} border rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-current`}
            >
              {CONTROLLER_NAMES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Duration */}
          <div>
            <label className={`block text-sm font-medium mb-2`}>
              Duration: {duration} minutes
            </label>
            <input
              type="range"
              min={5}
              max={60}
              step={5}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10))}
              className="w-full accent-current"
            />
            <div className={`flex justify-between text-xs ${colors.textMuted} mt-1`}>
              <span>5 min</span>
              <span>60 min</span>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={`w-full ${colors.primary} ${colors.primaryHover} disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium py-3 rounded-lg transition-colors`}
          >
            Generate Session
          </button>
        </div>
      </div>
    </div>
  );
}
