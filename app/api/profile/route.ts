import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        subjectName: true,
        dominantName: true,
        dominantTitle: true,
        subjectGender: true,
        dominantGender: true,
        subjectPOV: true,
        dominantPOV: true,
        totalScore: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json(user);
  } catch (error) {
    console.error("Error fetching profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { name, subjectName, dominantName, dominantTitle } = body;

    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: name || undefined,
        subjectName: subjectName || null,
        dominantName: dominantName || null,
        dominantTitle: dominantTitle || null,
      },
      select: {
        id: true,
        name: true,
        email: true,
        subjectName: true,
        dominantName: true,
        dominantTitle: true,
      },
    });

    return NextResponse.json(user);
  } catch (error) {
    console.error("Error updating profile:", error);
    return NextResponse.json(
      { error: "Failed to update profile" },
      { status: 500 }
    );
  }
}
