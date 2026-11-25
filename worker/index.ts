// Cloudflare Workers entry (hm-labor.<account>.workers.dev): same app as Pages.
// /api/* goes to the Hono API; everything else is served from the built site.
import app, { type Env } from "../server/app";

type WorkerEnv = Env & { ASSETS: Fetcher };

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return app.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
