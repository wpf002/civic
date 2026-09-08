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

/**
 * Publish a whole race's verified positions after reading a sample.
 *
 * The decision this makes is about the BATCH, not about each row: a reviewer reads a
 * handful drawn deterministically from the race, and if those hold up the rest go
 * with them. That is the only way 8,000 positions get reviewed by a person at all,
 * and it is honest as long as the sample is real and the batch size is on screen —
 * both of which the review page shows.
 */
export async function publishRace(formData: FormData) {
  const reviewer = String(formData.get("reviewer") ?? "").trim();
  const ids = String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!reviewer || ids.length === 0) {
    redirect(`/admin/review?error=${encodeURIComponent("a reviewer name and a batch are required")}`);
  }

  const r = await adminFetch<{ published: number; refused: Array<{ why: string }> }>(
    "/positions/publish-batch",
    { method: "POST", reviewer, body: JSON.stringify({ ids }) },
  );
  revalidatePath("/admin/review");
  if (!r.ok) redirect(`/admin/review?error=${encodeURIComponent(r.error)}`);

  // A partial publish is reported, not hidden. Refusals here mean rows that could
  // not go live, and a reviewer who thinks they published a race that they did not
  // will never look at it again.
  const refused = r.data.refused.length;
  redirect(
    `/admin/review?published=${r.data.published}${refused ? `&refused=${refused}` : ""}`,
  );
}
