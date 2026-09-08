/**
 * Getting a reviewer session for a scripted run.
 *
 * A script still acts as a person. It signs in with that person's credentials from
 * the environment and gets a real session, so a published position records who
 * actually published it rather than whatever name the script passed in a header.
 *
 * The alternative — a long-lived shared token — is what this replaces. It made every
 * scripted action attributable to nobody in particular, and it could not be revoked
 * for one script without revoking it for every person too.
 */
export async function adminSessionToken(
  apiBase: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string> {
  const email = env.REVIEWER_EMAIL;
  const password = env.REVIEWER_PASSWORD;

  if (!email || !password) {
    // Only fall back when there is no reviewer configured at all. The API refuses the
    // shared token once an account exists, so this fails loudly rather than quietly
    // downgrading to the weaker path.
    const shared = env.ADMIN_TOKEN;
    if (shared && shared !== "change-me") return shared;
    throw new Error(
      "Set REVIEWER_EMAIL and REVIEWER_PASSWORD so this run is attributable to a person. " +
        "Create an account with: pnpm --filter @civic/api exec dotenv -e ../../.env -- " +
        "tsx src/reviewers.ts <email> <name> <password>",
    );
  }

  const res = await fetch(`${apiBase}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`could not sign in as ${email}: ${res.status}. Check REVIEWER_PASSWORD.`);
  }
  return ((await res.json()) as { token: string }).token;
}
