import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { prisma } from "./db.server";

const DEFAULT_SCOPES = [
  "read_customers",
  "write_customers",
  "read_orders",
  "write_orders",
  "read_products",
  "read_script_tags",
  "write_script_tags",
].join(",");

const shopifyApiKey = process.env.SHOPIFY_API_KEY ?? "";
const shopifyApiSecret =
  process.env.SHOPIFY_API_SECRET ??
  process.env.SHOPIFY_API_SECRET_KEY ??
  "";
const shopifyAppUrl =
  process.env.SHOPIFY_APP_URL ??
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? process.env.VERCEL_PROJECT_PRODUCTION_URL.startsWith("http")
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "");
const shopifyScopes = (process.env.SCOPES ?? DEFAULT_SCOPES)
  .split(",")
  .map((scope) => scope.trim())
  .filter(Boolean);

const shopify = shopifyApp({
  apiKey: shopifyApiKey,
  apiSecretKey: shopifyApiSecret,
  apiVersion: ApiVersion.October24,
  scopes: shopifyScopes,
  appUrl: shopifyAppUrl,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October24;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
