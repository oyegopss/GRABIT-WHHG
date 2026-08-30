import { NextRequest, NextResponse } from "next/server";
import { getStudentRecommendations } from "@/lib/supabase/student_recommendations";

export async function GET(req: NextRequest) {
  try {
    const campusId = req.nextUrl.searchParams.get("campusId") || undefined;
    // 1. Fetch campus-scoped recommendations
    const recommendationsData = await getStudentRecommendations(campusId);

    return NextResponse.json(recommendationsData, {
      status: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      },
    });
  } catch (err) {
    console.error("Failed to fetch Student Recommendations:", err);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
