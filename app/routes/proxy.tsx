/**
 * App Proxy parent route.
 * All /proxy/* routes go through here.
 * `authenticate.public.appProxy` validates Shopify's HMAC signature so
 * we know every request is genuinely from the storefront.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { Outlet } from "@remix-run/react";
import { authenticate } from "../shopify.server";

// Validate proxy on every loader in this subtree
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return null;
};

// No UI — child routes handle rendering
export default function ProxyLayout() {
  return <Outlet />;
}
