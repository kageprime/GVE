/**
 * Conditional Clerk middleware + auth helpers.
 * When CLERK_SECRET_KEY (backend) and CLERK_PUBLISHABLE_KEY are missing,
 * we run in dev-bypass mode: no real auth, all requests get a dev user.
 */
import type { Request, Response, NextFunction } from "express";
import { clerkMiddleware, getAuth as clerkGetAuth } from "@clerk/express";

const DUMMY_KEY = "pk_test_dGVzdC10ZXJyYW5ldC1jbGVyay5jbGVyay5hY2NvdW50cy5kZXYk";
const isProduction = process.env.NODE_ENV === "production";
const hasClerkKey = Boolean(
  process.env.CLERK_SECRET_KEY &&
  process.env.CLERK_PUBLISHABLE_KEY &&
  process.env.CLERK_PUBLISHABLE_KEY !== DUMMY_KEY
);

/* In non-production, always bypass real auth so dev mode never 401s.
   In production, auth MUST be configured. Fail closed. */
const enforceRealAuth = isProduction && hasClerkKey;

if (isProduction && !hasClerkKey) {
  throw new Error(
    "FATAL: Missing CLERK_SECRET_KEY or CLERK_PUBLISHABLE_KEY in production. " +
    "Authentication cannot be bypassed in production mode."
  );
}

export const DEV_USER_ID = "dev-user";

function authErrorResponse(res: Response, status: number, message: string) {
  res.status(status).json({ error: "UNAUTHORIZED", message });
}

/* ── Conditional Clerk middleware ── */
export function conditionalClerkMiddleware() {
  if (enforceRealAuth) {
    return clerkMiddleware();
  }
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).auth = () => ({
      userId: DEV_USER_ID,
      sessionId: "dev-session",
    });
    next();
  };
}

/* ── Conditional requireAuth ── */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (enforceRealAuth) {
    let auth: { userId: string | null; sessionId: string | null };
    try {
      auth = conditionalGetAuth(req);
    } catch {
      authErrorResponse(res, 500, "Auth middleware not properly initialized.");
      return;
    }
    if (!auth?.userId) {
      authErrorResponse(res, 401, "Authentication required. Please sign in.");
      return;
    }
    next();
  } else {
    next();
  }
}

/* ── Conditional getAuth ── */
export function conditionalGetAuth(req: Request): { userId: string | null; sessionId: string | null } {
  if (enforceRealAuth) {
    return clerkGetAuth(req);
  }
  const mock = (req as any).auth;
  if (typeof mock === "function") return mock();
  return { userId: DEV_USER_ID, sessionId: "dev-session" };
}