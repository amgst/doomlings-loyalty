/**
 * Yotpo Loyalty & Referrals API integration
 * Docs: https://loyalty.yotpo.com/api/v2
 */

const YOTPO_API_BASE = "https://loyalty.yotpo.com/api/v2";

export interface YotpoConfig {
  apiKey: string;
  guid: string;
  secretKey?: string;
}

export interface YotpoCustomer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  pointsBalance: number;
  rewardsBalance: number;
  totalSpend: number;
  totalOrders: number;
  tier: string | null;
  tierName: string | null;
  referralCode: string | null;
  referralLink: string | null;
  createdAt: string;
}

export interface YotpoPointsHistory {
  id: string;
  action: string;
  points: number;
  description: string;
  createdAt: string;
}

export interface YotpoReward {
  id: string;
  name: string;
  description: string;
  pointsCost: number;
  discountValue: number | null;
  discountType: "fixed" | "percentage" | "free_shipping";
  code: string | null;
  expiresAt: string | null;
}

export interface YotpoEarningRule {
  id: string;
  name: string;
  description: string;
  points: number;
  action: string;
  icon: string;
}

async function yotpoRequest(
  config: YotpoConfig,
  path: string,
  options: RequestInit = {}
) {
  const url = `${YOTPO_API_BASE}${path}`;
  const headers = {
    "Content-Type": "application/json",
    "x-guid": config.guid,
    "x-api-key": config.apiKey,
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Yotpo API error ${response.status}: ${error}`);
  }

  return response.json();
}

export async function getCustomerPoints(
  config: YotpoConfig,
  email: string
): Promise<YotpoCustomer | null> {
  try {
    const data = await yotpoRequest(
      config,
      `/customers?customer_email=${encodeURIComponent(email)}`
    );
    const c = data.customer;
    if (!c) return null;

    return {
      id: c.id,
      email: c.email,
      firstName: c.first_name || "",
      lastName: c.last_name || "",
      pointsBalance: c.points_balance ?? 0,
      rewardsBalance: c.redemption_balance ?? 0,
      totalSpend: c.total_spend_cents ? c.total_spend_cents / 100 : 0,
      totalOrders: c.total_purchases ?? 0,
      tier: c.vip_tier_id ?? null,
      tierName: c.vip_tier_name ?? null,
      referralCode: c.referral_code ?? null,
      referralLink: c.referral_link ?? null,
      createdAt: c.created_at ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export async function getPointsHistory(
  config: YotpoConfig,
  email: string
): Promise<YotpoPointsHistory[]> {
  try {
    const data = await yotpoRequest(
      config,
      `/customers/activities?customer_email=${encodeURIComponent(email)}&count=20`
    );
    return (data.activities || []).map((a: any) => ({
      id: a.id,
      action: a.action,
      points: a.points ?? 0,
      description: a.body ?? a.action,
      createdAt: a.created_at,
    }));
  } catch {
    return [];
  }
}

export async function getAvailableRewards(
  config: YotpoConfig
): Promise<YotpoReward[]> {
  try {
    const data = await yotpoRequest(config, "/redemption_options");
    return (data.redemption_options || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      pointsCost: r.points_cost ?? 0,
      discountValue: r.amount ?? null,
      discountType: r.reward_type ?? "fixed",
      code: null,
      expiresAt: null,
    }));
  } catch {
    return [];
  }
}

export async function getEarningRules(
  config: YotpoConfig
): Promise<YotpoEarningRule[]> {
  try {
    const data = await yotpoRequest(config, "/campaigns");
    return (data.campaigns || []).map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description ?? "",
      points: c.reward_points ?? 0,
      action: c.action ?? "custom",
      icon: actionToIcon(c.action),
    }));
  } catch {
    return [];
  }
}

export async function redeemReward(
  config: YotpoConfig,
  email: string,
  redemptionOptionId: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  try {
    const data = await yotpoRequest(config, "/redemptions", {
      method: "POST",
      body: JSON.stringify({
        customer_email: email,
        redemption_option_id: redemptionOptionId,
      }),
    });
    return {
      success: true,
      code: data.redemption?.code,
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function awardPoints(
  config: YotpoConfig,
  email: string,
  points: number,
  description: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await yotpoRequest(config, "/customers/bonus_points", {
      method: "POST",
      body: JSON.stringify({
        customer_email: email,
        points_change: points,
        note: description,
      }),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export async function validateYotpoCredentials(
  config: YotpoConfig
): Promise<boolean> {
  try {
    await yotpoRequest(config, "/redemption_options");
    return true;
  } catch {
    return false;
  }
}

function actionToIcon(action: string): string {
  const map: Record<string, string> = {
    purchase: "cart",
    signup: "person",
    birthday: "gift",
    referral: "share",
    review: "star",
    custom: "sparkles",
    social_follow: "heart",
  };
  return map[action] || "star";
}
