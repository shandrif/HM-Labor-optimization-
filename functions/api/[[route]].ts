// Cloudflare Pages entry (hm-labor.pages.dev): the API lives in server/app.ts
import { handle } from "hono/cloudflare-pages";
import app from "../../server/app";

export const onRequest = handle(app);
