/**
 * App Proxy — Customer Data endpoint
 * Called client-side from the loyalty page JS to fetch live balance,
 * history, and referral data for the logged-in customer.
 * No CORS headers needed — same-origin via the Shopify proxy.
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { getCustomerPoints, getPointsHistory, type YotpoConfig } from "../yotpo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const email = url.searchParams.get("email") ?? "";

  if (!shop || !email) {
    return json({ error: "shop and email required" }, { status: 400 });
  }

  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  if (!settings?.yotpoApiKey || !settings?.yotpoGuid) {
    return json({ error: "Not configured" }, { status: 503 });
  }

  const config: YotpoConfig = {
    apiKey: settings.yotpoApiKey,
    guid: settings.yotpoGuid,
    secretKey: settings.yotpoSecretKey ?? undefined,
  };

  const [customer, history] = await Promise.all([
    getCustomerPoints(config, email),
    getPointsHistory(config, email),
  ]);

  return json({
    customer,
    history,
    pointsName: settings.pointsName,
    pointsNamePlural: settings.pointsNamePlural,
    currencySymbol: settings.currencySymbol,
  });
};
