import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "@remix-run/react";
import { json } from "@remix-run/node";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";

const APP_BRIDGE_URL =
  "https://cdn.shopify.com/shopifycloud/app-bridge.js";

export const links: LinksFunction = () => [];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // `host` is always present when Shopify admin loads the embedded app.
  const isEmbeddedApp = Boolean(url.searchParams.get("host"));
  return json({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    isEmbeddedApp,
  });
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { apiKey, isEmbeddedApp } = useLoaderData<typeof loader>();

  return (
    <>
      {/*
        Inject App Bridge directly — no Polaris wrapper needed since we use
        zero Polaris components. Putting it here (after <Links /> and before
        app content) lets App Bridge initialise before the UI renders while
        still being inside the React tree so React can hydrate it cleanly.
      */}
      {isEmbeddedApp && (
        <script
          src={APP_BRIDGE_URL}
          data-api-key={apiKey}
          suppressHydrationWarning
        />
      )}
      <Outlet />
    </>
  );
}
