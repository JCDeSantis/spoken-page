import { NextResponse } from "next/server";
import { listLibraries } from "@/lib/audiobookshelf";

export async function GET() {
  try {
    const libraries = await listLibraries();
    return NextResponse.json({ libraries });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load libraries.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
