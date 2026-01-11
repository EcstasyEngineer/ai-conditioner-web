import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PlayerType, CyclerType, ItemType } from "@prisma/client";

interface PhaseInput {
  name: string;
  duration: number;
  player: string;
  cycler: string;
  themes: string[]; // theme IDs
}

interface SessionInput {
  name: string;
  phases: PhaseInput[];
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await prisma.userSession.findMany({
      where: { userId: session.user.id },
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
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: SessionInput = await req.json();

    if (!body.name?.trim()) {
      return NextResponse.json(
        { error: "Session name is required" },
        { status: 400 }
      );
    }

    if (!body.phases?.length) {
      return NextResponse.json(
        { error: "At least one phase is required" },
        { status: 400 }
      );
    }

    // Calculate total duration
    const totalDuration = body.phases.reduce((sum, p) => sum + p.duration, 0);

    // Create session with phases and items
    const userSession = await prisma.userSession.create({
      data: {
        userId: session.user.id,
        name: body.name,
        duration: totalDuration,
        phases: {
          create: body.phases.map((phase, index) => ({
            name: phase.name,
            order: index,
            duration: phase.duration,
            player: phase.player as PlayerType,
            cycler: phase.cycler as CyclerType,
            items: {
              create: phase.themes.map((themeId, itemIndex) => ({
                type: ItemType.MANTRA,
                content: themeId, // Store theme ID
                order: itemIndex,
              })),
            },
          })),
        },
      },
      include: {
        phases: {
          include: {
            items: true,
          },
        },
      },
    });

    return NextResponse.json(userSession, { status: 201 });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
