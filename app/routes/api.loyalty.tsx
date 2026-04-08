/**
 * Public API endpoint used by the storefront widget (Theme App Extension).
 * Returns loyalty data for a customer email — called client-side.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";
import { prisma } from "../db.server";
import {
  getCustomerPoints,
  getPointsHistory,
  getAvailableRewards,
  getEarningRules,
  redeemReward,
  type YotpoConfig,
} from "../yotpo.server";

function corsHeaders(shop: string) {
  return {
    "Access-Control-Allow-Origin": `https://${shop}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const email = url.searchParams.get("email") ?? "";
  const action = url.searchParams.get("action") ?? "profile";

  if (!shop) return json({ error: "shop required" }, { status: 400 });

  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  if (!settings?.yotpoApiKey || !settings?.yotpoGuid) {
    return json({ error: "Not configured" }, { status: 503, headers: corsHeaders(shop) });
  }

  const config: YotpoConfig = {
    apiKey: settings.yotpoApiKey,
    guid: settings.yotpoGuid,
    secretKey: settings.yotpoSecretKey ?? undefined,
  };

  if (action === "rules") {
    const [earningRules, rewards] = await Promise.all([
      getEarningRules(config),
      getAvailableRewards(config),
    ]);
    return json(
      {
        earningRules,
        rewards,
        pointsName: settings.pointsName,
        pointsNamePlural: settings.pointsNamePlural,
        currencySymbol: settings.currencySymbol,
      },
      { headers: corsHeaders(shop) }
    );
  }

  if (!email) return json({ error: "email required" }, { status: 400 });

  const [customer, history] = await Promise.all([
    getCustomerPoints(config, email),
    getPointsHistory(config, email),
  ]);

  return json(
    {
      customer,
      history,
      pointsName: settings.pointsName,
      pointsNamePlural: settings.pointsNamePlural,
      currencySymbol: settings.currencySymbol,
      widgetEnabled: settings.widgetEnabled,
      referralEnabled: settings.referralEnabled,
    },
    { headers: corsHeaders(shop) }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(shop) });
  }

  if (!shop) return json({ error: "shop required" }, { status: 400 });

  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  if (!settings?.yotpoApiKey || !settings?.yotpoGuid) {
    return json({ error: "Not configured" }, { status: 503, headers: corsHeaders(shop) });
  }

  const config: YotpoConfig = {
    apiKey: settings.yotpoApiKey,
    guid: settings.yotpoGuid,
    secretKey: settings.yotpoSecretKey ?? undefined,
  };

  const body = await request.json();
  const { intent, email, redemptionOptionId } = body;

  if (intent === "redeem") {
    const result = await redeemReward(config, email, redemptionOptionId);
    return json(result, { headers: corsHeaders(shop) });
  }

  return json({ error: "Unknown intent" }, { status: 400, headers: corsHeaders(shop) });
};
