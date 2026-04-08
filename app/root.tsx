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
import { AppProvider } from "@shopify/shopify-app-remix/react";

export const links: LinksFunction = () => [];

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  // `host` is always present when loaded from the Shopify admin iframe.
  // Using only `host` (not `shop`) avoids a false-positive on proxy requests
  // that also carry a `shop` param.
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
    <AppProvider isEmbeddedApp={isEmbeddedApp} apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
