/**
 * Reviewer authentication.
 *
 * Replaces a single shared secret held in an httpOnly cookie. That arrangement had
 * three concrete problems, not stylistic ones:
 *
 *   Attribution was a text field. Every published position recorded whoever typed a
 *   name into a form, which is not evidence of who decided anything.
 *   Revocation was all-or-nothing. Removing one person's access meant changing the
 *   secret for everyone still working.
 *   There was no way to end a session. A leaked cookie stayed valid until the shared
 *   secret changed.
 *
 * Passwords are scrypt with a per-user salt. Sessions are random tokens stored as a
 * SHA-256 hash, so reading the database does not hand anyone a live session, and
 * they are checked against the database on every request, so revoking one takes
 * effect on the next call rather than at expiry.
 */
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { prisma } from "@civic/db";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
export const SESSION_DAYS = 7;

export async function hashPassword(password: string, salt?: string) {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = (await scryptAsync(password, s, KEY_LENGTH)).toString("hex");
  return { hash, salt: s };
}

/** Constant-time. A length-varying comparison leaks how much of a guess was right. */
export async function verifyPassword(password: string, hash: string, salt: string) {
  const candidate = await scryptAsync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface AuthedReviewer {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Exchange credentials for a session token.
 *
 * Returns null for a wrong password, an unknown email, and a disabled account alike.
 * Distinguishing them tells an attacker which emails are real.
 */
export async function login(
  email: string,
  password: string,
  userAgent?: string,
): Promise<{ token: string; reviewer: AuthedReviewer } | null> {
  const reviewer = await prisma.reviewer.findUnique({ where: { email: email.toLowerCase().trim() } });

  // Hash even when there is no such user, so a missing account does not return
  // measurably faster than a wrong password.
  const ok = reviewer
    ? await verifyPassword(password, reviewer.passwordHash, reviewer.salt)
    : await verifyPassword(password, "0".repeat(128), "0".repeat(32));

  if (!reviewer || !ok || reviewer.disabledAt) return null;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await prisma.reviewerSession.create({
    data: {
      tokenHash: hashToken(token),
      reviewerId: reviewer.id,
      expiresAt,
      ...(userAgent ? { userAgent: userAgent.slice(0, 300) } : {}),
    },
  });
  await prisma.reviewer.update({ where: { id: reviewer.id }, data: { lastLoginAt: new Date() } });

  return {
    token,
    reviewer: { id: reviewer.id, email: reviewer.email, displayName: reviewer.displayName },
  };
}

/** Checked against the database every request, so a revoked session dies at once. */
export async function reviewerFromToken(token: string | undefined): Promise<AuthedReviewer | null> {
  if (!token) return null;
  const session = await prisma.reviewerSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { reviewer: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (session.reviewer.disabledAt) return null;
  return {
    id: session.reviewer.id,
    email: session.reviewer.email,
    displayName: session.reviewer.displayName,
  };
}

export async function logout(token: string | undefined): Promise<void> {
  if (!token) return;
  await prisma.reviewerSession.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function createReviewer(email: string, displayName: string, password: string) {
  if (password.length < 12) {
    throw new Error("a reviewer password must be at least 12 characters");
  }
  const { hash, salt } = await hashPassword(password);
  return prisma.reviewer.create({
    data: { email: email.toLowerCase().trim(), displayName, passwordHash: hash, salt },
  });
}
