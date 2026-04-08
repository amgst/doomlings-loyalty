import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, payload } = await authenticate.webhook(request);

  console.log(`Received webhook: ${topic} from ${shop}`);

  switch (topic) {
    case "APP_UNINSTALLED":
      if (session) {
        await prisma.session.deleteMany({ where: { shop } });
      }
      break;
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
    case "SHOP_REDACT":
      // GDPR compliance - log and acknowledge
      console.log(`GDPR webhook ${topic} for shop ${shop}`);
      break;
    case "ORDERS_PAID":
      // Yotpo handles purchase points natively via their Shopify integration.
      // This webhook is a hook for any custom logic you want to add.
      console.log(`Order paid for ${shop}:`, (payload as any)?.id);
      break;
    default:
      console.warn(`Unhandled webhook topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};
