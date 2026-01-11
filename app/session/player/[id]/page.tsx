"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Play,
  Pause,
  SkipForward,
  Volume2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import SpiralViewer from "@/components/ui/spiral-viewer";

interface Mantra {
  id: string;
  template: string;
  difficulty: string;
  points: number;
}

interface Theme {
  id: string;
  name: string;
  mantras: Mantra[];
}

interface Phase {
  id: string;
  name: string;
  order: number;
  duration: number;
  player: string;
  cycler: string;
  themes: Theme[];
}

interface Session {
  id: string;
  name: string;
  duration: number;
  phases: Phase[];
}

export default function SessionPlayer() {
  const params = useParams();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0);
  const [phaseElapsed, setPhaseElapsed] = useState(0);
  const [currentMantraIndex, setCurrentMantraIndex] = useState(0);
  const [showVisuals, setShowVisuals] = useState(true);
  const [volume, setVolume] = useState(70);

  // Load session data
  useEffect(() => {
    async function loadSession() {
      try {
        const response = await fetch(`/api/sessions/${sessionId}`);
        if (!response.ok) {
          throw new Error("Session not found");
        }
        const data = await response.json();
        setSession(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setLoading(false);
      }
    }
    loadSession();
  }, [sessionId]);

  // Get all mantras for current phase
  const currentPhase = session?.phases[currentPhaseIndex];
  const allMantras =
    currentPhase?.themes.flatMap((t) => t.mantras.map((m) => m.template)) || [];
  const currentMantra = allMantras[currentMantraIndex] || "Loading...";

  // Mantra cycling interval (every 5 seconds)
  const MANTRA_INTERVAL = 5;

  // Timer logic
  useEffect(() => {
    if (!isPlaying || !currentPhase) return;

    const interval = setInterval(() => {
      setPhaseElapsed((prev) => {
        const next = prev + 1;

        // Cycle to next mantra
        if (next % MANTRA_INTERVAL === 0 && allMantras.length > 0) {
          setCurrentMantraIndex((mi) => (mi + 1) % allMantras.length);
        }

        // Phase complete - move to next
        if (next >= currentPhase.duration) {
          if (currentPhaseIndex < (session?.phases.length || 0) - 1) {
            setCurrentPhaseIndex((pi) => pi + 1);
            setCurrentMantraIndex(0);
            return 0;
          } else {
            // Session complete
            setIsPlaying(false);
            return prev;
          }
        }

        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [
    isPlaying,
    currentPhase,
    allMantras.length,
    currentPhaseIndex,
    session?.phases.length,
  ]);

  const skipPhase = useCallback(
    (direction: number) => {
      const newIndex = currentPhaseIndex + direction;
      if (newIndex >= 0 && newIndex < (session?.phases.length || 0)) {
        setCurrentPhaseIndex(newIndex);
        setPhaseElapsed(0);
        setCurrentMantraIndex(0);
      }
    },
    [currentPhaseIndex, session?.phases.length]
  );

  const phaseProgress = currentPhase
    ? Math.round((phaseElapsed / currentPhase.duration) * 100)
    : 0;

  const totalElapsed =
    (session?.phases.slice(0, currentPhaseIndex).reduce((s, p) => s + p.duration, 0) || 0) +
    phaseElapsed;
  const totalProgress = session?.duration
    ? Math.round((totalElapsed / session.duration) * 100)
    : 0;

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-pink-500 animate-spin" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-4">Session Not Found</h1>
          <p className="text-gray-400 mb-6">{error}</p>
          <Link
            href="/dashboard"
            className="bg-pink-600 text-white px-6 py-3 rounded-lg hover:bg-pink-700"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const themeNames = currentPhase?.themes.map((t) => t.name).join(", ") || "";

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="text-gray-400 hover:text-white">
                <ArrowLeft className="w-6 h-6" />
              </Link>
              <div>
                <h1 className="text-2xl font-bold text-white">{session.name}</h1>
                <p className="text-gray-400">
                  {formatTime(session.duration || 0)} total •{" "}
                  {session.phases.length} phases
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowVisuals(!showVisuals)}
              className="p-2 bg-gray-700 rounded-lg hover:bg-gray-600"
              title={showVisuals ? "Hide visuals" : "Show visuals"}
            >
              {showVisuals ? (
                <EyeOff className="w-5 h-5" />
              ) : (
                <Eye className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Visual Panel */}
          <div className="flex justify-center items-center">
            {showVisuals ? (
              <div className="bg-gray-800 rounded-lg p-6">
                <SpiralViewer
                  shaderName="pink_spiral"
                  width={500}
                  height={400}
                  autoplay={isPlaying}
                  speed={isPlaying ? 0.7 : 0}
                />
              </div>
            ) : (
              <div className="bg-gray-800 rounded-lg p-12 text-center">
                <div className="text-6xl mb-4">🌸</div>
                <h3 className="text-xl font-medium text-white mb-2">
                  Audio Focus Mode
                </h3>
                <p className="text-gray-400">Close your eyes and listen deeply</p>
              </div>
            )}
          </div>

          {/* Control Panel */}
          <div className="space-y-6">
            {/* Current Phase Info */}
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-medium text-white">
                  Phase {currentPhaseIndex + 1}: {currentPhase?.name}
                </h3>
                <span className="text-sm text-gray-400">
                  {formatTime(phaseElapsed)} / {formatTime(currentPhase?.duration || 0)}
                </span>
              </div>
              <div className="text-sm text-gray-400 mb-4">
                {currentPhase?.player} • {currentPhase?.cycler} • {themeNames}
              </div>

              {/* Phase Progress */}
              <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
                <div
                  className="bg-pink-500 h-2 rounded-full transition-all duration-1000"
                  style={{ width: `${phaseProgress}%` }}
                ></div>
              </div>

              {/* Total Progress */}
              <div className="w-full bg-gray-700 rounded-full h-1">
                <div
                  className="bg-purple-500 h-1 rounded-full transition-all duration-1000"
                  style={{ width: `${totalProgress}%` }}
                ></div>
              </div>
              <div className="text-right text-xs text-gray-500 mt-1">
                {totalProgress}% of session
              </div>
            </div>

            {/* Current Mantra */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">Current Mantra</h3>
              <div className="bg-gray-700 rounded-lg p-6 min-h-[120px] flex items-center justify-center">
                <p className="text-xl text-gray-100 italic text-center leading-relaxed">
                  &ldquo;{currentMantra}&rdquo;
                </p>
              </div>
              <div className="text-xs text-gray-500 mt-2 text-center">
                {currentMantraIndex + 1} of {allMantras.length} mantras
              </div>
            </div>

            {/* Playback Controls */}
            <div className="bg-gray-800 rounded-lg p-6">
              <div className="flex justify-center items-center gap-6 mb-6">
                <button
                  onClick={() => skipPhase(-1)}
                  className="p-3 bg-gray-700 rounded-full hover:bg-gray-600 transition-colors disabled:opacity-50"
                  disabled={currentPhaseIndex === 0}
                >
                  <SkipForward className="w-6 h-6 rotate-180" />
                </button>

                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="p-4 bg-gradient-to-r from-pink-600 to-purple-600 rounded-full hover:from-pink-700 hover:to-purple-700 transition-all transform hover:scale-105"
                >
                  {isPlaying ? (
                    <Pause className="w-8 h-8" />
                  ) : (
                    <Play className="w-8 h-8" />
                  )}
                </button>

                <button
                  onClick={() => skipPhase(1)}
                  className="p-3 bg-gray-700 rounded-full hover:bg-gray-600 transition-colors disabled:opacity-50"
                  disabled={currentPhaseIndex === session.phases.length - 1}
                >
                  <SkipForward className="w-6 h-6" />
                </button>
              </div>

              {/* Volume Control */}
              <div className="flex items-center gap-4">
                <Volume2 className="w-5 h-5 text-gray-400" />
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={volume}
                  onChange={(e) => setVolume(parseInt(e.target.value))}
                  className="flex-1 accent-pink-600"
                />
                <span className="text-sm text-gray-400 w-12">{volume}%</span>
              </div>
            </div>

            {/* Phase List */}
            <div className="bg-gray-800 rounded-lg p-6">
              <h3 className="text-lg font-medium text-white mb-4">Phases</h3>
              <div className="space-y-2">
                {session.phases.map((phase, index) => (
                  <button
                    key={phase.id}
                    onClick={() => {
                      setCurrentPhaseIndex(index);
                      setPhaseElapsed(0);
                      setCurrentMantraIndex(0);
                    }}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      index === currentPhaseIndex
                        ? "bg-pink-600/20 border border-pink-500"
                        : "bg-gray-700 hover:bg-gray-600"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-medium">
                        {index + 1}. {phase.name}
                      </span>
                      <span className="text-sm text-gray-400">
                        {formatTime(phase.duration)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {phase.themes.length} themes • {phase.player} • {phase.cycler}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <div className="mt-8 text-center">
          <div className="inline-flex items-center gap-3 bg-gray-800 rounded-full px-6 py-3">
            <div
              className={`w-2 h-2 rounded-full ${
                isPlaying ? "bg-green-500 animate-pulse" : "bg-gray-500"
              }`}
            ></div>
            <span className="text-sm text-gray-400">
              {isPlaying ? "Session Active" : "Session Paused"} •{" "}
              {formatTime(totalElapsed)} elapsed
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
