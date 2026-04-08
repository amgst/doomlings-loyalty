import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import {
  getEarningRules,
  getAvailableRewards,
  type YotpoConfig,
} from "../yotpo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });

  let earningRules: Awaited<ReturnType<typeof getEarningRules>> = [];
  let rewards: Awaited<ReturnType<typeof getAvailableRewards>> = [];
  let configured = false;

  if (settings?.yotpoApiKey && settings?.yotpoGuid) {
    configured = true;
    const config: YotpoConfig = {
      apiKey: settings.yotpoApiKey,
      guid: settings.yotpoGuid,
      secretKey: settings.yotpoSecretKey ?? undefined,
    };
    [earningRules, rewards] = await Promise.all([
      getEarningRules(config),
      getAvailableRewards(config),
    ]);
  }

  return json({
    shop: session.shop,
    configured,
    pointsName: settings?.pointsName ?? "Doomlings Points",
    currencySymbol: settings?.currencySymbol ?? "★",
    earningRules,
    rewards,
    stats: {
      totalCustomers: 0,
      activeMembers: 0,
      pointsIssued: 0,
      rewardsRedeemed: 0,
    },
  });
};

export default function AppIndex() {
  const { shop, configured, pointsName, currencySymbol, earningRules, rewards, stats } =
    useLoaderData<typeof loader>();

  return (
    <div className="page">
      {/* Page Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">{shop}</p>
        </div>
        {!configured && (
          <a href="/app/settings" className="btn btn-primary">
            Connect Yotpo →
          </a>
        )}
      </div>

      {/* Setup Banner */}
      {!configured && (
        <div className="setup-banner">
          <div className="setup-banner-icon">⚙</div>
          <div className="setup-banner-content">
            <h3>Connect your Yotpo account</h3>
            <p>
              Add your Yotpo API credentials to start displaying loyalty points,
              earning rules, and rewards on your storefront.
            </p>
          </div>
          <a href="/app/settings" className="btn btn-primary btn-sm">
            Go to Settings
          </a>
        </div>
      )}

      {/* Stats Grid */}
      <div className="stats-grid">
        {[
          { label: "Total Members", value: formatNumber(stats.totalCustomers), icon: "◉", note: "All time" },
          { label: "Active This Month", value: formatNumber(stats.activeMembers), icon: "▲", note: "Last 30 days" },
          { label: `${pointsName} Issued`, value: formatNumber(stats.pointsIssued), icon: currencySymbol, note: "All time" },
          { label: "Rewards Redeemed", value: formatNumber(stats.rewardsRedeemed), icon: "⬡", note: "All time" },
        ].map((stat) => (
          <div key={stat.label} className="stat-card">
            <div className="stat-icon">{stat.icon}</div>
            <div className="stat-value">{stat.value}</div>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-note">{stat.note}</div>
          </div>
        ))}
      </div>

      {/* Two-column grid */}
      <div className="content-grid">
        {/* Earning Rules */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Ways to Earn</h2>
            <span className="badge">{earningRules.length} rules</span>
          </div>
          {earningRules.length === 0 ? (
            <div className="empty-state">
              <p>{configured ? "No earning rules configured in Yotpo." : "Connect Yotpo to view earning rules."}</p>
            </div>
          ) : (
            <ul className="rule-list">
              {earningRules.map((rule) => (
                <li key={rule.id} className="rule-item">
                  <div className="rule-icon">{iconEmoji(rule.icon)}</div>
                  <div className="rule-info">
                    <span className="rule-name">{rule.name}</span>
                    <span className="rule-desc">{rule.description}</span>
                  </div>
                  <div className="rule-points">
                    {rule.points > 0 ? `+${rule.points}` : rule.points} pts
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Rewards */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Rewards Catalog</h2>
            <span className="badge">{rewards.length} rewards</span>
          </div>
          {rewards.length === 0 ? (
            <div className="empty-state">
              <p>{configured ? "No rewards configured in Yotpo." : "Connect Yotpo to view rewards."}</p>
            </div>
          ) : (
            <ul className="rule-list">
              {rewards.map((reward) => (
                <li key={reward.id} className="rule-item">
                  <div className="rule-icon">🎁</div>
                  <div className="rule-info">
                    <span className="rule-name">{reward.name}</span>
                    <span className="rule-desc">{reward.description}</span>
                  </div>
                  <div className="rule-points">{reward.pointsCost} pts</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <style>{adminStyles}</style>
    </div>
  );
}

function iconEmoji(icon: string) {
  const map: Record<string, string> = {
    cart: "🛒", person: "👤", gift: "🎁", share: "🔗",
    star: "⭐", sparkles: "✨", heart: "❤",
  };
  return map[icon] || "⭐";
}

const numberFormatter = new Intl.NumberFormat("en-US");

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

export const adminStyles = `
  .page { max-width: 120rem; }
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 3.2rem;
  }
  .page-title {
    font-size: 2.8rem;
    font-weight: 700;
    letter-spacing: -0.04em;
    color: #000;
    line-height: 1.2;
  }
  .page-subtitle { font-size: 1.3rem; color: rgba(0,0,0,.5); margin-top: 0.4rem; }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 5rem;
    padding: 0 2.4rem;
    border-radius: 0.6rem;
    font-size: 1.4rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    text-decoration: none;
    transition: opacity 0.2s;
    letter-spacing: -0.01em;
  }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: #000; color: #fff; }
  .btn-secondary { background: #ebebeb; color: #000; }
  .btn-sm { height: 4rem; padding: 0 1.6rem; font-size: 1.3rem; }

  /* Setup Banner */
  .setup-banner {
    display: flex;
    align-items: center;
    gap: 2rem;
    background: #f6fd7c;
    border: 1px solid rgba(0,0,0,.12);
    border-radius: 1.2rem;
    padding: 2.4rem;
    margin-bottom: 3.2rem;
  }
  .setup-banner-icon { font-size: 2.4rem; flex-shrink: 0; }
  .setup-banner-content { flex: 1; }
  .setup-banner-content h3 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.4rem; }
  .setup-banner-content p { font-size: 1.3rem; color: rgba(0,0,0,.65); }

  /* Stats */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2rem;
    margin-bottom: 3.2rem;
  }
  .stat-card {
    background: #fff;
    border: 1px solid rgba(0,0,0,.08);
    border-radius: 1.2rem;
    padding: 2.4rem;
    position: relative;
    overflow: hidden;
  }
  .stat-icon {
    font-size: 1.8rem;
    margin-bottom: 1.2rem;
    color: rgba(0,0,0,.3);
  }
  .stat-value {
    font-size: 3.2rem;
    font-weight: 700;
    letter-spacing: -0.05em;
    color: #000;
    line-height: 1;
    margin-bottom: 0.6rem;
  }
  .stat-label { font-size: 1.3rem; font-weight: 600; color: #000; margin-bottom: 0.2rem; }
  .stat-note { font-size: 1.1rem; color: rgba(0,0,0,.4); }

  /* Content Grid */
  .content-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.4rem;
  }

  /* Cards */
  .card {
    background: #fff;
    border: 1px solid rgba(0,0,0,.08);
    border-radius: 1.2rem;
    overflow: hidden;
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2rem 2.4rem;
    border-bottom: 1px solid rgba(0,0,0,.06);
  }
  .card-title { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; }
  .badge {
    background: #eeeeee;
    color: rgba(0,0,0,.6);
    padding: 0.3rem 0.8rem;
    border-radius: 2rem;
    font-size: 1.1rem;
    font-weight: 600;
  }

  /* Lists */
  .rule-list { list-style: none; }
  .rule-item {
    display: flex;
    align-items: center;
    gap: 1.4rem;
    padding: 1.6rem 2.4rem;
    border-bottom: 1px solid rgba(0,0,0,.04);
  }
  .rule-item:last-child { border-bottom: none; }
  .rule-icon { font-size: 1.8rem; width: 3.2rem; text-align: center; flex-shrink: 0; }
  .rule-info { flex: 1; display: flex; flex-direction: column; gap: 0.2rem; }
  .rule-name { font-size: 1.4rem; font-weight: 600; color: #000; }
  .rule-desc { font-size: 1.2rem; color: rgba(0,0,0,.5); }
  .rule-points {
    font-size: 1.4rem;
    font-weight: 700;
    color: #000;
    white-space: nowrap;
    background: #f5f5f5;
    padding: 0.4rem 1rem;
    border-radius: 0.6rem;
  }

  /* Empty state */
  .empty-state {
    padding: 4rem 2.4rem;
    text-align: center;
    color: rgba(0,0,0,.4);
    font-size: 1.3rem;
  }
`;
