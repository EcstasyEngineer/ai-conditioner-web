import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { ThemeLoader } from '@/lib/themes';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const withMantrasOnly = searchParams.get('withMantras') === 'true';

    const themes = await prisma.theme.findMany({
      include: {
        mantras: {
          select: {
            id: true,
            template: true,
            difficulty: true,
            points: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    // Transform JSON string fields back to arrays for API response
    let transformed = themes.map(theme => ({
      ...theme,
      keywords: JSON.parse(theme.keywords),
      categories: JSON.parse(theme.categories),
      relatedThemes: JSON.parse(theme.relatedThemes),
      mantraCount: theme.mantras.length,
      // Map mantras for dashboard compatibility
      mantras: theme.mantras.map(m => ({
        id: m.id,
        text: m.template, // Dashboard expects 'text'
        difficulty: m.difficulty,
        points: m.points
      }))
    }));

    // Filter to only themes with mantras if requested
    if (withMantrasOnly) {
      transformed = transformed.filter(t => t.mantraCount > 0);
    }

    return NextResponse.json(transformed);
  } catch (error) {
    console.error('Error fetching themes:', error);
    return NextResponse.json({ error: 'Failed to fetch themes' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const themeLoader = new ThemeLoader();
    await themeLoader.loadAllThemes();

    return NextResponse.json({ message: 'Themes loaded successfully' });
  } catch (error) {
    console.error('Error loading themes:', error);
    return NextResponse.json({ error: 'Failed to load themes' }, { status: 500 });
  }
}
