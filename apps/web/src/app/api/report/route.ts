import { NextResponse } from "next/server";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function POST(req: Request) {
  const form = await req.formData();
  const body = {
    targetType: String(form.get("targetType") ?? "candidate"),
    targetId: String(form.get("targetId") ?? ""),
    message: String(form.get("message") ?? "").slice(0, 1000),
  };
  await fetch(`${BASE}/v1/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  return NextResponse.redirect(new URL("/report/thanks", req.url), 303);
}
