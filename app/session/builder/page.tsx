"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Play, X } from "lucide-react";

interface Theme {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  categories: string[];
  mantras: Array<{
    id: string;
    text: string;
    difficulty: string;
    points: number;
  }>;
}

interface Phase {
  id: string;
  name: string;
  duration: number;
  player: string;
  cycler: string;
  themes: string[];
}

const PLAYER_TYPES = [
  { value: 'DIRECT', label: 'Direct', description: 'Simple, centered audio playback' },
  { value: 'TRI_CHAMBER', label: 'Tri-Chamber', description: 'Left-Center-Right spatial audio' },
  { value: 'STEREO_SPLIT', label: 'Stereo Split', description: 'Left-right channel separation' },
  { value: 'ROTATIONAL', label: 'Rotational', description: 'Moving audio around the head' },
  { value: 'LAYERED', label: 'Layered', description: 'Multiple overlapping audio tracks' }
];

const CYCLER_TYPES = [
  { value: 'RANDOM', label: 'Random', description: 'Random content selection' },
  { value: 'CHAIN', label: 'Chain', description: 'Sequential content playback' },
  { value: 'ADAPTIVE', label: 'Adaptive', description: 'Responds to user state' },
  { value: 'WEAVE', label: 'Weave', description: 'Interwoven content patterns' },
  { value: 'BRIDGE', label: 'Bridge', description: 'Smooth content transitions' }
];

export default function SessionBuilder() {
  const [sessionName, setSessionName] = useState('');
  const [phases, setPhases] = useState<Phase[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadThemes();
  }, []);

  const loadThemes = async () => {
    try {
      // Only fetch themes that have mantras
      const response = await fetch('/api/themes?withMantras=true');
      if (response.ok) {
        const themesData = await response.json();
        setThemes(themesData);
      }
    } catch (error) {
      console.error('Error loading themes:', error);
    } finally {
      setLoading(false);
    }
  };

  const addPhase = () => {
    const newPhase: Phase = {
      id: Date.now().toString(),
      name: `Phase ${phases.length + 1}`,
      duration: 300, // 5 minutes default
      player: 'DIRECT',
      cycler: 'RANDOM',
      themes: []
    };
    setPhases([...phases, newPhase]);
  };

  const removePhase = (phaseId: string) => {
    setPhases(phases.filter(p => p.id !== phaseId));
  };

  const updatePhase = (phaseId: string, updates: Partial<Phase>) => {
    setPhases(phases.map(p => p.id === phaseId ? { ...p, ...updates } : p));
  };

  const toggleTheme = (phaseId: string, themeId: string) => {
    const phase = phases.find(p => p.id === phaseId);
    if (!phase) return;

    const themes = phase.themes.includes(themeId)
      ? phase.themes.filter(t => t !== themeId)
      : [...phase.themes, themeId];
    
    updatePhase(phaseId, { themes });
  };

  const saveSession = async () => {
    if (!sessionName.trim()) {
      alert('Please enter a session name');
      return;
    }

    if (phases.length === 0) {
      alert('Please add at least one phase');
      return;
    }

    // Check that each phase has at least one theme
    const emptyPhase = phases.find(p => p.themes.length === 0);
    if (emptyPhase) {
      alert(`Phase "${emptyPhase.name}" has no themes selected`);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionName,
          phases: phases.map(p => ({
            name: p.name,
            duration: p.duration,
            player: p.player,
            cycler: p.cycler,
            themes: p.themes,
          })),
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save session');
      }

      const savedSession = await response.json();
      alert('Session saved successfully!');

      // Redirect to the player or dashboard
      window.location.href = `/session/player/${savedSession.id}`;
    } catch (error) {
      console.error('Error saving session:', error);
      alert(error instanceof Error ? error.message : 'Error saving session');
    } finally {
      setSaving(false);
    }
  };

  const totalDuration = phases.reduce((sum, phase) => sum + phase.duration, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-pink-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading session builder...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-gray-600 hover:text-gray-900">
                <ArrowLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Session Builder</h1>
                <p className="text-gray-600">Create a personalized hypnosis session</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={saveSession}
                disabled={saving}
                className="bg-pink-600 text-white px-4 py-2 rounded-lg hover:bg-pink-700 flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Session'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Session Info */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Session Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Session Name</label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="Enter session name..."
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-pink-500 focus:border-pink-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Total Duration</label>
              <div className="bg-gray-50 p-3 rounded-lg">
                <span className="text-lg font-semibold text-pink-600">
                  {Math.floor(totalDuration / 60)} minutes {totalDuration % 60} seconds
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Phases */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Session Phases</h2>
            <button 
              onClick={addPhase}
              className="bg-pink-600 text-white px-4 py-2 rounded-lg hover:bg-pink-700 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Phase
            </button>
          </div>

          {phases.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 mb-4">
                <Play className="w-12 h-12 mx-auto" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No phases yet</h3>
              <p className="text-gray-600 mb-4">Add phases to structure your session</p>
              <button 
                onClick={addPhase}
                className="bg-pink-600 text-white px-4 py-2 rounded-lg hover:bg-pink-700"
              >
                Add First Phase
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {phases.map((phase, index) => (
                <div key={phase.id} className="border border-gray-200 rounded-lg p-6">
                  <div className="flex justify-between items-start mb-4">
                    <h3 className="text-lg font-medium text-gray-900">
                      Phase {index + 1}: {phase.name}
                    </h3>
                    <button
                      onClick={() => removePhase(phase.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Phase Name</label>
                      <input
                        type="text"
                        value={phase.name}
                        onChange={(e) => updatePhase(phase.id, { name: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Duration (seconds)</label>
                      <input
                        type="number"
                        value={phase.duration}
                        onChange={(e) => updatePhase(phase.id, { duration: parseInt(e.target.value) || 0 })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Player</label>
                      <select
                        value={phase.player}
                        onChange={(e) => updatePhase(phase.id, { player: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      >
                        {PLAYER_TYPES.map(player => (
                          <option key={player.value} value={player.value}>
                            {player.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Cycler</label>
                      <select
                        value={phase.cycler}
                        onChange={(e) => updatePhase(phase.id, { cycler: e.target.value })}
                        className="w-full p-2 border border-gray-300 rounded-lg"
                      >
                        {CYCLER_TYPES.map(cycler => (
                          <option key={cycler.value} value={cycler.value}>
                            {cycler.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Theme Selection */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Themes ({phase.themes.length} selected)
                    </label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
                      {themes.map(theme => (
                        <label key={theme.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={phase.themes.includes(theme.id)}
                            onChange={() => toggleTheme(phase.id, theme.id)}
                            className="rounded border-gray-300 text-pink-600 focus:ring-pink-500"
                          />
                          <span className="truncate">{theme.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}