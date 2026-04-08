/**
 * Serves loyalty-widget.css from the app URL so the proxy page can
 * reference it without needing theme assets at all.
 * URL: /proxy/loyalty.css
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Read from extensions asset (single source of truth)
  const cssPath = join(
    __dirname,
    "../../extensions/loyalty-widget/assets/loyalty-widget.css"
  );

  let css: string;
  try {
    css = await readFile(cssPath, "utf-8");
  } catch {
    css = "/* loyalty-widget.css not found */";
  }

  return new Response(css, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
