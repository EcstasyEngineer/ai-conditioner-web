import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    const userSession = await prisma.userSession.findUnique({
      where: { id },
      include: {
        phases: {
          orderBy: { order: "asc" },
          include: {
            items: {
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });

    if (!userSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Check ownership (optional - might want public sessions later)
    if (session?.user?.id && userSession.userId !== session.user.id) {
      // For now, allow viewing but could restrict
    }

    // Fetch mantras for each theme referenced in phase items
    const themeIds = new Set<string>();
    for (const phase of userSession.phases) {
      for (const item of phase.items) {
        if (item.content) {
          themeIds.add(item.content);
        }
      }
    }

    const themes = await prisma.theme.findMany({
      where: { id: { in: Array.from(themeIds) } },
      include: {
        mantras: {
          select: {
            id: true,
            template: true,
            difficulty: true,
            points: true,
          },
        },
      },
    });

    const themeMap = new Map(themes.map((t) => [t.id, t]));

    // Enrich phases with theme data
    const enrichedPhases = userSession.phases.map((phase) => ({
      ...phase,
      themes: phase.items
        .map((item) => themeMap.get(item.content))
        .filter(Boolean),
    }));

    return NextResponse.json({
      ...userSession,
      phases: enrichedPhases,
    });
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json(
      { error: "Failed to fetch session" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userSession = await prisma.userSession.findUnique({
      where: { id },
    });

    if (!userSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    if (userSession.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await prisma.userSession.delete({ where: { id } });

    return NextResponse.json({ message: "Session deleted" });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json(
      { error: "Failed to delete session" },
      { status: 500 }
    );
  }
}
