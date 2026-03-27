import { defineMiddleware } from "astro:middleware";
import { getSessionCookie, validateSession } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname.startsWith("/api/")) {
    return next();
  }

  try {
    const runtime = context.locals.runtime;
    if (runtime?.env?.DB) {
      const sessionId = getSessionCookie(context.request);
      if (sessionId) {
        const user = await validateSession(runtime.env.DB, sessionId);
        if (user) {
          context.locals.user = user;
        }
      }
    }
  } catch {
    // No runtime available (build time or dev without D1)
  }

  const response = await next();
  const headers = new Headers(response.headers);
  
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=()");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' https://avatars.githubusercontent.com data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
    ].join("; ")
  );
  
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});