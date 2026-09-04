"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE, adminFetch } from "@/lib/admin";

export async function signIn(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  (await cookies()).set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 8,
  });
  revalidatePath("/admin");
}

export async function signOut() {
  (await cookies()).delete(ADMIN_COOKIE);
  revalidatePath("/admin");
}

export async function decideRoster(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reviewer = String(formData.get("reviewer") ?? "").trim();
  const artifactUrl = String(formData.get("artifactUrl") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  const r = await adminFetch(`/roster-diffs/${id}/${decision}`, {
    method: "POST",
    reviewer,
    body: JSON.stringify(
      decision === "accept"
        ? { ...(artifactUrl ? { artifactUrl } : {}), ...(note ? { note } : {}) }
        : { note: note || "rejected" },
    ),
  });
  revalidatePath("/admin");
  // A refusal must be visible. The API rejects an unaccompanied removal with 422 and
  // an explanation; swallowing that would make the rule look optional.
  if (!r.ok) redirect(`/admin?error=${encodeURIComponent(r.error)}`);
  redirect("/admin");
}

export async function decidePosition(formData: FormData) {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const reviewer = String(formData.get("reviewer") ?? "").trim();
  const r = await adminFetch(`/positions/${id}/${decision}`, { method: "POST", reviewer });
  revalidatePath("/admin");
  if (!r.ok) redirect(`/admin?error=${encodeURIComponent(r.error)}`);
  redirect("/admin");
}
