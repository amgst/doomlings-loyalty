/**
 * App Proxy parent route.
 * All /proxy/* routes go through here.
 * Auth is handled individually by each child route so that static assets
 * (e.g. /proxy/loyalty.css) can be served without requiring a Shopify HMAC.
 */
import { Outlet } from "@remix-run/react";

// No parent-level auth — child routes (proxy._index, proxy.customer) call
// authenticate.public.appProxy themselves. This allows loyalty.css to be
// fetched directly by the browser without a Shopify signature.
export default function ProxyLayout() {
  return <Outlet />;
}
