import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { useEffect } from "react";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();
  const location = useLocation();

  useEffect(() => {
    if (apiKey && !document.querySelector("script[data-api-key]")) {
      const script = document.createElement("script");
      script.src = "https://cdn.shopify.com/shopifycloud/app-bridge.js";
      script.setAttribute("data-api-key", apiKey);
      document.head.appendChild(script);
    }
  }, [apiKey]);

  const nav = [
    { href: "/app", label: "Overview", icon: "⬡" },
    { href: "/app/customers", label: "Customers", icon: "◉" },
    { href: "/app/settings", label: "Settings", icon: "◈" },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="brand-icon">★</span>
          <span className="brand-name">Doomlings</span>
          <span className="brand-sub">Loyalty</span>
        </div>
        <nav className="sidebar-nav">
          {nav.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={`nav-link${location.pathname === item.href ? " active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="powered-by">Powered by Yotpo</span>
        </div>
      </aside>

      <main className="app-main">
        <Outlet />
      </main>

      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { font-size: 62.5%; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
          font-size: 1.4rem;
          background: #f5f5f5;
          color: #000;
          -webkit-font-smoothing: antialiased;
        }
        a { text-decoration: none; color: inherit; }

        /* Layout */
        .app-shell {
          display: flex;
          min-height: 100vh;
        }

        /* Sidebar */
        .sidebar {
          width: 24rem;
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
          position: fixed;
          top: 0; left: 0; bottom: 0;
          z-index: 10;
          padding: 0 0 2.4rem;
        }
        .sidebar-brand {
          display: flex;
          align-items: baseline;
          gap: 0.6rem;
          padding: 2.8rem 2.4rem 2.4rem;
          border-bottom: 1px solid rgba(255,255,255,.1);
          margin-bottom: 1.6rem;
        }
        .brand-icon { font-size: 2rem; color: #f6fd7c; }
        .brand-name { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.04em; }
        .brand-sub { font-size: 1.2rem; color: rgba(255,255,255,.5); font-weight: 400; }
        .sidebar-nav { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; padding: 0 1.2rem; }
        .nav-link {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1.1rem 1.4rem;
          border-radius: 0.8rem;
          font-size: 1.4rem;
          font-weight: 500;
          color: rgba(255,255,255,.6);
          transition: all 0.15s;
        }
        .nav-link:hover { background: rgba(255,255,255,.08); color: #fff; }
        .nav-link.active { background: rgba(255,255,255,.12); color: #fff; }
        .nav-icon { font-size: 1.6rem; width: 2rem; text-align: center; }
        .sidebar-footer {
          padding: 0 2.4rem;
          font-size: 1.1rem;
          color: rgba(255,255,255,.3);
        }
        .powered-by::before { content: "⚡ "; }

        /* Main area */
        .app-main {
          margin-left: 24rem;
          flex: 1;
          min-height: 100vh;
          padding: 4rem;
          max-width: calc(100vw - 24rem);
        }
      `}</style>
    </div>
  );
}
