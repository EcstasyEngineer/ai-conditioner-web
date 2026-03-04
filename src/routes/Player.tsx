import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { decodeSessionParams, buildSessionUrl } from '@lib/url-params';
import { loadTheme, generatePlaylist, PlaylistItem } from '@lib/theme-loader';
import { DronePlayer } from '@lib/drone';
import { useTheme } from '../components/ThemeContext';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { Spiral } from '../components/Spiral';

export default function Player() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme } = useTheme();

  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const droneRef = useRef<DronePlayer | null>(null);

  const params = decodeSessionParams(searchParams.toString());

  // Initialize drone player
  useEffect(() => {
    droneRef.current = new DronePlayer();
    return () => {
      droneRef.current?.dispose();
    };
  }, []);

  // Load playlist
  useEffect(() => {
    if (!params) {
      setError('Invalid session parameters');
      setLoading(false);
      return;
    }

    setShareUrl(buildSessionUrl(params));

    loadTheme(params.theme)
      .then((theme) => {
        const items = generatePlaylist(
          theme,
          params.petName,
          params.dominantName,
          params.duration
        );
        setPlaylist(items);
        setLoading(false);
      })
      .catch((err) => {
        setError(`Failed to load theme: ${err.message}`);
        setLoading(false);
      });
  }, [searchParams]);

  // Handle play/pause - start/stop drone
  useEffect(() => {
    if (isPlaying) {
      droneRef.current?.start();
    } else {
      droneRef.current?.stop();
    }
  }, [isPlaying]);

  // Auto-advance when playing (~4 sec per mantra)
  useEffect(() => {
    if (!isPlaying || playlist.length === 0) return;

    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= playlist.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 4000);

    return () => clearInterval(timer);
  }, [isPlaying, playlist.length]);

  const handlePrevious = () => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => Math.min(playlist.length - 1, prev + 1));
  };

  const handlePlayPause = async () => {
    setIsPlaying(!isPlaying);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBack = () => {
    if (isPlaying) {
      droneRef.current?.stop();
      setIsPlaying(false);
    }
    navigate('/');
  };

  const { colors } = theme;

  if (loading) {
    return (
      <div className={`min-h-screen ${colors.bg} ${colors.text} flex items-center justify-center`}>
        <p>Loading session...</p>
      </div>
    );
  }

  if (error || !params) {
    return (
      <div className={`min-h-screen ${colors.bg} ${colors.text} flex flex-col items-center justify-center p-8`}>
        <p className="text-red-400 mb-4">{error || 'Invalid session'}</p>
        <button
          onClick={() => navigate('/')}
          className={`${colors.primary} ${colors.primaryHover} px-6 py-2 rounded-lg`}
        >
          Create New Session
        </button>
      </div>
    );
  }

  const currentItem = playlist[currentIndex];
  const progress = ((currentIndex + 1) / playlist.length) * 100;

  return (
    <div className={`min-h-screen ${colors.bg} ${colors.text} flex flex-col`}>
      {/* Header */}
      <div className={`p-4 ${colors.border} border-b`}>
        <div className="max-w-2xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-4">
            {/* Back button */}
            <button
              onClick={handleBack}
              className={`p-2 rounded-lg ${colors.bgSecondary} hover:opacity-80 transition-opacity`}
              title="Back to builder"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="font-medium capitalize">
                {params.theme.replace('_', ' ')}
              </h1>
              <p className={`text-sm ${colors.textMuted}`}>
                {params.duration} min session
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeSwitcher />
            <button
              onClick={handleCopyLink}
              className={`text-sm ${colors.bgSecondary} hover:opacity-80 px-3 py-1 rounded transition-opacity`}
            >
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className={`h-1 ${colors.bgSecondary}`}>
        <div
          className={`h-full ${colors.primary} transition-all duration-300`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-8 relative">
        {/* Spiral background */}
        <Spiral isPlaying={isPlaying} />

        {/* Mantra text */}
        <div className="max-w-2xl text-center relative z-10">
          <p className="text-3xl md:text-4xl font-light leading-relaxed">
            {currentItem?.renderedText}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className={`p-6 ${colors.border} border-t`}>
        <div className="max-w-md mx-auto">
          {/* Playback Controls */}
          <div className="flex items-center justify-center gap-6 mb-4">
            <button
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className={`p-3 rounded-full hover:${colors.bgSecondary} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
            </button>

            <button
              onClick={handlePlayPause}
              className={`p-4 rounded-full ${colors.primary} ${colors.primaryHover} transition-colors`}
            >
              {isPlaying ? (
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg className="w-8 h-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>

            <button
              onClick={handleNext}
              disabled={currentIndex === playlist.length - 1}
              className={`p-3 rounded-full hover:${colors.bgSecondary} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
            >
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
            </button>
          </div>

          {/* Progress Text */}
          <p className={`text-center text-sm ${colors.textMuted}`}>
            {currentIndex + 1} / {playlist.length}
          </p>
        </div>
      </div>
    </div>
  );
}
