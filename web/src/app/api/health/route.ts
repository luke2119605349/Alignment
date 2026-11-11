import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "cntr-alignment",
    time: new Date().toISOString(),
  });
}
