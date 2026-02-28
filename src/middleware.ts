import { defineMiddleware } from "astro:middleware";
import { getSessionCookie, validateSession } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  // Skip session validation for API routes — they handle auth independently
  if (context.url.pathname.startsWith("/api/")) {
    return next();
  }

  try {
    const runtime = (context.locals as any).runtime;
    if (runtime?.env?.DB) {
      const sessionId = getSessionCookie(context.request);
      if (sessionId) {
        const user = await validateSession(runtime.env.DB, sessionId);
        if (user) {
          (context.locals as any).user = user;
        }
      }
    }
  } catch {
    // No runtime available (build time or dev without D1)
  }

  return next();
});
