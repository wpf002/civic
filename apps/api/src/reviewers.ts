/**
 * Create a reviewer from the command line.
 *
 * Deliberately not an HTTP endpoint. A route that creates accounts is a route that
 * can be found, and there is no legitimate case for creating one over the network in
 * a product with no public sign-up.
 */
import { createReviewer } from "./auth.js";
import { prisma } from "@civic/db";

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password) {
  console.error("usage: tsx src/reviewers.ts <email> <display name> <password>");
  process.exit(1);
}

createReviewer(email, name, password)
  .then((r) => console.log(`created ${r.email} (${r.displayName})`))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
