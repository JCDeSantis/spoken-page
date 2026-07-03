import { NextResponse } from "next/server";
import { listLibraries } from "@/lib/audiobookshelf";
import { errorResponse, privateJson } from "@/lib/server-api";

export async function GET(request: Request) {
  try {
    const libraries = await listLibraries();
    return privateJson({ libraries });
  } catch (error) {
    return errorResponse(error, "Unable to load libraries.", request);
  }
}
