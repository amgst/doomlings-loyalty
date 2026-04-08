import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteLoaderData,
} from "@remix-run/react";
import { json } from "@remix-run/node";
import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { AppProvider } from "@shopify/shopify-app-remix/react";

export const links: LinksFunction = () => [];

export async function loader({ request }: LoaderFunctionArgs) {
  return json({ apiKey: process.env.SHOPIFY_API_KEY || "" });
}

export function Layout({ children }: { children: React.ReactNode }) {
  // useRouteLoaderData lets Layout access root loader data without breaking error boundaries
  const data = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* App Bridge must live in <head> so React 18.3 resource-hoisting doesn't
            cause a server/client tree mismatch (Error #418) */}
        {data?.apiKey && (
          <script
            src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
            data-api-key={data.apiKey}
          />
        )}
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
  const { apiKey } = useLoaderData<typeof loader>();
  // isEmbeddedApp={false} prevents AppProvider from rendering a second App Bridge
  // script tag in <body> — we handle it manually in Layout above
  return (
    <AppProvider isEmbeddedApp={false} apiKey={apiKey}>
      <Outlet />
    </AppProvider>
  );
}
