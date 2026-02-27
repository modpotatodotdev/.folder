import type { APIRoute } from "astro";
import app from "../../lib/api";

const handler: APIRoute = async ({ request, locals }) => {
  const runtime = locals.runtime;
  return app.fetch(request, runtime.env, runtime.ctx);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
