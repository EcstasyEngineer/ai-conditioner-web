"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Play, Plus, Settings, BookOpen } from "lucide-react";

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

interface UserSession {
  id: string;
  name: string;
  duration?: number;
  createdAt: string;
  phases: Array<{
    id: string;
    name: string;
    duration: number;
    player: string;
    cycler: string;
  }>;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [themes, setThemes] = useState<Theme[]>([]);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // Authentication check
  useEffect(() => {
    if (status === "loading") return; // Still loading
    
    if (!session) {
      router.push("/auth/signin");
      return;
    }
  }, [session, status, router]);

  // Load data when authenticated
  useEffect(() => {
    if (session) {
      loadThemes();
      loadSessions();
    }
  }, [session]);

  const loadThemes = async () => {
    try {
      const response = await fetch('/api/themes');
      if (response.ok) {
        const themesData = await response.json();
        setThemes(themesData);
      }
    } catch (error) {
      console.error('Error loading themes:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const response = await fetch('/api/sessions');
      if (response.ok) {
        const sessionsData = await response.json();
        setSessions(sessionsData);
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    } finally {
      setLoading(false);
    }
  };

  const initializeThemes = async () => {
    try {
      const response = await fetch('/api/themes', { method: 'POST' });
      if (response.ok) {
        await loadThemes();
      }
    } catch (error) {
      console.error('Error initializing themes:', error);
    }
  };

  const categoriesList = ['All', ...new Set(themes.flatMap(theme => theme.categories))];
  const filteredThemes = selectedCategory === 'All'
    ? themes
    : themes.filter(theme => theme.categories.includes(selectedCategory));

  // Loading state for authentication
  if (status === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-pink-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect if not authenticated
  if (!session) {
    return null; // Will redirect to signin
  }

  // Loading state for dashboard data
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-pink-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">AI Conditioner</h1>
              <p className="text-gray-600">
                Welcome back, {session.user?.name}! Personalized hypnosis content generation
              </p>
            </div>
            <div className="flex gap-4">
              <Link href="/session/builder" className="bg-pink-600 text-white px-4 py-2 rounded-lg hover:bg-pink-700 flex items-center gap-2">
                <Plus className="w-4 h-4" />
                New Session
              </Link>
              <button className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Settings
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Recent Sessions */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Recent Sessions</h2>
                <Link href="/session/builder" className="text-pink-600 hover:text-pink-700 text-sm font-medium">
                  Create New →
                </Link>
              </div>
              
              {sessions.length === 0 ? (
                <div className="text-center py-12">
                  <Play className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No sessions yet</h3>
                  <p className="text-gray-600 mb-4">Create your first personalized hypnosis session</p>
                  <Link href="/session/builder" className="bg-pink-600 text-white px-4 py-2 rounded-lg hover:bg-pink-700">
                    Create Session
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {sessions.map((session) => (
                    <div key={session.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-medium text-gray-900">{session.name}</h3>
                          <p className="text-sm text-gray-600">
                            {session.duration ? `${Math.floor(session.duration / 60)} minutes` : 'Custom duration'} • 
                            {session.phases.length} phases
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            Created {new Date(session.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                        <Link href={`/session/player/${session.id}`} className="bg-pink-600 text-white px-3 py-1 rounded text-sm hover:bg-pink-700">
                          Play
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Theme Browser */}
          <div>
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-900">Themes</h2>
                {themes.length === 0 && (
                  <button 
                    onClick={initializeThemes}
                    className="text-pink-600 hover:text-pink-700 text-sm font-medium"
                  >
                    Load Themes
                  </button>
                )}
              </div>

              {/* Category Filter */}
              <div className="mb-4">
                <select 
                  value={selectedCategory} 
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded-lg text-sm"
                >
                  {categoriesList.map(category => (
                    <option key={category} value={category}>{category}</option>
                  ))}
                </select>
              </div>

              {themes.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600 text-sm">No themes loaded</p>
                  <button 
                    onClick={initializeThemes}
                    className="mt-2 bg-pink-600 text-white px-3 py-1 rounded text-sm hover:bg-pink-700"
                  >
                    Initialize Themes
                  </button>
                </div>
              ) : (
                <div className="space-y-3 max-h-96 overflow-y-auto">
                  {filteredThemes.map((theme) => (
                    <div key={theme.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                      <h3 className="font-medium text-gray-900 text-sm">{theme.name}</h3>
                      <p className="text-xs text-gray-600 mt-1 line-clamp-2">{theme.description}</p>
                      <div className="flex justify-between items-center mt-2">
                        <span className="text-xs text-gray-500">
                          {theme.mantras.length} mantras
                        </span>
                        <div className="flex gap-1">
                          {theme.categories.slice(0, 2).map(cat => (
                            <span key={cat} className="bg-pink-100 text-pink-700 px-2 py-1 rounded text-xs">
                              {cat}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-8">
          <div className="bg-white rounded-lg shadow-sm p-4 text-center">
            <div className="text-2xl font-bold text-pink-600">{themes.length}</div>
            <div className="text-sm text-gray-600">Available Themes</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 text-center">
            <div className="text-2xl font-bold text-pink-600">{sessions.length}</div>
            <div className="text-sm text-gray-600">Your Sessions</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 text-center">
            <div className="text-2xl font-bold text-pink-600">
              {themes.reduce((sum, theme) => sum + theme.mantras.length, 0)}
            </div>
            <div className="text-sm text-gray-600">Total Mantras</div>
          </div>
          <div className="bg-white rounded-lg shadow-sm p-4 text-center">
            <div className="text-2xl font-bold text-pink-600">0</div>
            <div className="text-sm text-gray-600">Hours Listened</div>
          </div>
        </div>
      </main>
    </div>
  );
}