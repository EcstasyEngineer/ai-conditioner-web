import { useEffect, useRef } from 'react';
import { useTheme } from './ThemeContext';

interface SpiralProps {
  isPlaying: boolean;
}

export function Spiral({ isPlaying }: SpiralProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const { themeName } = useTheme();

  // Theme-specific spiral colors
  const spiralColors: Record<string, { primary: string; secondary: string }> = {
    clinical: { primary: '#14b8a6', secondary: '#0f766e' }, // teal
    bimbo: { primary: '#ec4899', secondary: '#db2777' }, // pink
    void: { primary: '#a855f7', secondary: '#7c3aed' }, // purple
    evil: { primary: '#dc2626', secondary: '#991b1b' }, // red
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resize = () => {
      const size = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.5, 400);
      canvas.width = size;
      canvas.height = size;
    };
    resize();
    window.addEventListener('resize', resize);

    let rotation = 0;
    const colors = spiralColors[themeName] || spiralColors.clinical;

    const draw = () => {
      const { width, height } = canvas;
      const cx = width / 2;
      const cy = height / 2;

      // Clear with transparent background
      ctx.clearRect(0, 0, width, height);

      // Draw spiral
      const arms = 6;
      const maxRadius = Math.min(width, height) / 2 - 10;

      for (let arm = 0; arm < arms; arm++) {
        const armOffset = (arm / arms) * Math.PI * 2;

        ctx.beginPath();
        for (let i = 0; i <= 200; i++) {
          const t = i / 200;
          const angle = t * Math.PI * 6 + rotation + armOffset;
          const radius = t * maxRadius;

          const x = cx + Math.cos(angle) * radius;
          const y = cy + Math.sin(angle) * radius;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        // Gradient stroke
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, colors.primary);
        gradient.addColorStop(1, colors.secondary);

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 2 + (arm % 2);
        ctx.lineCap = 'round';
        ctx.globalAlpha = 0.6 + (arm % 2) * 0.2;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Rotate for next frame
      rotation += 0.015;

      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, [themeName]);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 m-auto transition-opacity duration-1000 ${
        isPlaying ? 'opacity-30' : 'opacity-0'
      }`}
      style={{ pointerEvents: 'none' }}
    />
  );
}
