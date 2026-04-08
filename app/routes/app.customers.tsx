import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { getCustomerPoints, getPointsHistory, awardPoints, type YotpoConfig } from "../yotpo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.appSettings.findUnique({ where: { shop: session.shop } });
  const configured = !!(settings?.yotpoApiKey && settings?.yotpoGuid);
  return json({ configured, pointsName: settings?.pointsName ?? "Points", currencySymbol: settings?.currencySymbol ?? "★" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.appSettings.findUnique({ where: { shop: session.shop } });

  if (!settings?.yotpoApiKey || !settings?.yotpoGuid) {
    return json({ error: "Yotpo not configured.", customer: null, history: null, awarded: null });
  }

  const config: YotpoConfig = {
    apiKey: settings.yotpoApiKey,
    guid: settings.yotpoGuid,
    secretKey: settings.yotpoSecretKey ?? undefined,
  };

  const formData = await request.formData();
  const intent = String(formData.get("intent"));

  if (intent === "lookup") {
    const email = String(formData.get("email") || "");
    if (!email) return json({ error: "Email required.", customer: null, history: null, awarded: null });

    const [customer, history] = await Promise.all([
      getCustomerPoints(config, email),
      getPointsHistory(config, email),
    ]);

    if (!customer) return json({ error: `No Yotpo customer found for ${email}.`, customer: null, history: null, awarded: null });
    return json({ error: null, customer, history, awarded: null });
  }

  if (intent === "award") {
    const email = String(formData.get("email") || "");
    const points = Number(formData.get("points") || 0);
    const note = String(formData.get("note") || "Manual award by merchant");
    const result = await awardPoints(config, email, points, note);
    if (!result.success) return json({ error: result.error ?? "Failed to award points.", customer: null, history: null, awarded: null });
    const [customer, history] = await Promise.all([
      getCustomerPoints(config, email),
      getPointsHistory(config, email),
    ]);
    return json({ error: null, customer, history, awarded: points });
  }

  return json({ error: "Unknown intent.", customer: null, history: null, awarded: null });
};

export default function CustomersPage() {
  const { configured, pointsName, currencySymbol } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const loading = navigation.state === "submitting";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Customer Lookup</h1>
          <p className="page-subtitle">Search Yotpo loyalty profiles by email</p>
        </div>
      </div>

      {!configured && (
        <div className="notice">
          ⚠ Yotpo is not configured. <a href="/app/settings">Go to Settings →</a>
        </div>
      )}

      {/* Search */}
      <div className="card search-card">
        <Form method="post">
          <input type="hidden" name="intent" value="lookup" />
          <div className="search-row">
            <div className="form-group flex-1">
              <label htmlFor="email">Customer Email</label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="customer@example.com"
                defaultValue={actionData?.customer?.email ?? ""}
                required
                disabled={!configured}
              />
            </div>
            <button type="submit" className="btn btn-primary search-btn" disabled={loading || !configured}>
              {loading ? "Searching…" : "Look Up"}
            </button>
          </div>
        </Form>
      </div>

      {actionData?.error && (
        <div className="alert alert-error">{actionData.error}</div>
      )}
      {actionData?.awarded && (
        <div className="alert alert-success">
          ✓ Awarded {actionData.awarded} {pointsName} successfully
        </div>
      )}

      {/* Customer Profile */}
      {actionData?.customer && (
        <>
          <div className="customer-profile card">
            <div className="profile-hero">
              <div className="profile-avatar">
                {actionData.customer.firstName?.[0] ?? "?"}
                {actionData.customer.lastName?.[0] ?? ""}
              </div>
              <div className="profile-info">
                <h2 className="profile-name">
                  {actionData.customer.firstName} {actionData.customer.lastName}
                </h2>
                <p className="profile-email">{actionData.customer.email}</p>
                {actionData.customer.tierName && (
                  <span className="tier-badge">{actionData.customer.tierName}</span>
                )}
              </div>
            </div>
            <div className="profile-stats">
              <div className="profile-stat">
                <span className="profile-stat-value">
                  {currencySymbol} {formatNumber(actionData.customer.pointsBalance)}
                </span>
                <span className="profile-stat-label">{pointsName} Balance</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">
                  ${actionData.customer.totalSpend.toFixed(2)}
                </span>
                <span className="profile-stat-label">Total Spend</span>
              </div>
              <div className="profile-stat">
                <span className="profile-stat-value">{actionData.customer.totalOrders}</span>
                <span className="profile-stat-label">Orders</span>
              </div>
              {actionData.customer.referralCode && (
                <div className="profile-stat">
                  <span className="profile-stat-value referral-code">
                    {actionData.customer.referralCode}
                  </span>
                  <span className="profile-stat-label">Referral Code</span>
                </div>
              )}
            </div>
          </div>

          {/* Award Points */}
          <div className="card award-card">
            <div className="card-header">
              <h3 className="card-title">Award Points Manually</h3>
            </div>
            <div className="card-body">
              <Form method="post" className="award-form">
                <input type="hidden" name="intent" value="award" />
                <input type="hidden" name="email" value={actionData.customer.email} />
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="points">Points to Award</label>
                    <input id="points" name="points" type="number" min="1" placeholder="100" required />
                  </div>
                  <div className="form-group flex-1">
                    <label htmlFor="note">Note</label>
                    <input id="note" name="note" type="text" placeholder="Reason for awarding points" defaultValue="Manual award by merchant" />
                  </div>
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={loading}>
                  {loading ? "Awarding…" : `Award ${pointsName}`}
                </button>
              </Form>
            </div>
          </div>

          {/* Points History */}
          {actionData.history && actionData.history.length > 0 && (
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Points History</h3>
                <span className="badge">{actionData.history.length} events</span>
              </div>
              <ul className="history-list">
                {actionData.history.map((event) => (
                  <li key={event.id} className="history-item">
                    <div className="history-main">
                      <span className="history-action">{event.description}</span>
                      <span className="history-date">{formatEventDate(event.createdAt)}</span>
                    </div>
                    <span className={`history-points ${event.points >= 0 ? "positive" : "negative"}`}>
                      {event.points >= 0 ? "+" : ""}{event.points}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <style>{customerStyles}</style>
    </div>
  );
}

const numberFormatter = new Intl.NumberFormat("en-US");
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatEventDate(value: string) {
  return dateFormatter.format(new Date(value));
}

const customerStyles = `
  .page { max-width: 80rem; }
  .page-header { margin-bottom: 3.2rem; }
  .page-title { font-size: 2.8rem; font-weight: 700; letter-spacing: -0.04em; color: #000; }
  .page-subtitle { font-size: 1.3rem; color: rgba(0,0,0,.5); margin-top: 0.4rem; }

  .notice {
    background: #fff8e1;
    border: 1px solid #ffc10733;
    border-radius: 0.8rem;
    padding: 1.4rem 2rem;
    font-size: 1.3rem;
    margin-bottom: 2.4rem;
  }
  .notice a { color: #000; font-weight: 600; text-decoration: underline; }

  .alert { padding: 1.4rem 2rem; border-radius: 0.8rem; font-size: 1.4rem; font-weight: 500; margin-bottom: 2.4rem; }
  .alert-success { background: #d4f4e4; color: #0a5c38; border: 1px solid #0a9b6133; }
  .alert-error { background: #fde8e4; color: #7a1a10; border: 1px solid #c4301c33; }

  .card {
    background: #fff;
    border: 1px solid rgba(0,0,0,.08);
    border-radius: 1.2rem;
    overflow: hidden;
    margin-bottom: 2.4rem;
  }
  .card-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 2rem 2.4rem;
    border-bottom: 1px solid rgba(0,0,0,.06);
  }
  .card-title { font-size: 1.6rem; font-weight: 700; letter-spacing: -0.02em; }
  .badge { background: #eee; color: rgba(0,0,0,.6); padding: 0.3rem 0.8rem; border-radius: 2rem; font-size: 1.1rem; font-weight: 600; }
  .card-body { padding: 2.4rem; }

  .search-card { padding: 2.4rem; margin-bottom: 2.4rem; }
  .search-row { display: flex; align-items: flex-end; gap: 1.6rem; }
  .flex-1 { flex: 1; }
  .form-group { display: flex; flex-direction: column; gap: 0.6rem; }
  .form-group label { font-size: 1.3rem; font-weight: 600; color: #000; }
  .form-group input {
    height: 4.4rem;
    padding: 0 1.4rem;
    background: #eee;
    border: 1px solid transparent;
    border-radius: 0.6rem;
    font-size: 1.4rem;
    color: #000;
    outline: none;
    transition: border-color 0.2s;
    font-family: inherit;
    width: 100%;
  }
  .form-group input:focus { border-color: #000; background: #fff; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    height: 5rem; padding: 0 2.4rem;
    border-radius: 0.6rem;
    font-size: 1.4rem; font-weight: 600;
    border: none; cursor: pointer;
    transition: opacity 0.2s;
    letter-spacing: -0.01em;
    font-family: inherit;
    white-space: nowrap;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn:hover:not(:disabled) { opacity: 0.85; }
  .btn-primary { background: #000; color: #fff; }
  .btn-sm { height: 4rem; padding: 0 1.6rem; font-size: 1.3rem; }
  .search-btn { height: 4.4rem; align-self: flex-end; }

  /* Profile */
  .customer-profile { margin-bottom: 2.4rem; }
  .profile-hero {
    display: flex; align-items: center; gap: 2rem;
    padding: 2.4rem;
    border-bottom: 1px solid rgba(0,0,0,.06);
  }
  .profile-avatar {
    width: 6.4rem; height: 6.4rem;
    background: #000; color: #fff;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 2rem; font-weight: 700;
    flex-shrink: 0;
    text-transform: uppercase;
  }
  .profile-name { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; margin-bottom: 0.2rem; }
  .profile-email { font-size: 1.3rem; color: rgba(0,0,0,.5); margin-bottom: 0.8rem; }
  .tier-badge {
    display: inline-block;
    background: #f6fd7c;
    color: #000;
    font-size: 1.1rem;
    font-weight: 700;
    padding: 0.3rem 0.8rem;
    border-radius: 2rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .profile-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0;
  }
  .profile-stat {
    display: flex; flex-direction: column;
    padding: 2rem 2.4rem;
    border-right: 1px solid rgba(0,0,0,.06);
  }
  .profile-stat:last-child { border-right: none; }
  .profile-stat-value {
    font-size: 2.2rem; font-weight: 700;
    letter-spacing: -0.03em;
    color: #000; margin-bottom: 0.4rem;
  }
  .referral-code { font-family: monospace; font-size: 1.6rem; }
  .profile-stat-label { font-size: 1.2rem; color: rgba(0,0,0,.5); }

  /* Award */
  .award-card { margin-bottom: 2.4rem; }
  .award-form { display: flex; flex-direction: column; gap: 1.6rem; }
  .form-row { display: grid; grid-template-columns: 16rem 1fr; gap: 1.6rem; }

  /* History */
  .history-list { list-style: none; }
  .history-item {
    display: flex; align-items: center; justify-content: space-between; gap: 2rem;
    padding: 1.4rem 2.4rem;
    border-bottom: 1px solid rgba(0,0,0,.04);
  }
  .history-item:last-child { border-bottom: none; }
  .history-main { display: flex; flex-direction: column; gap: 0.2rem; }
  .history-action { font-size: 1.3rem; font-weight: 500; color: #000; }
  .history-date { font-size: 1.1rem; color: rgba(0,0,0,.4); }
  .history-points {
    font-size: 1.4rem; font-weight: 700;
    padding: 0.4rem 0.8rem; border-radius: 0.6rem;
    white-space: nowrap;
  }
  .history-points.positive { background: #d4f4e4; color: #0a5c38; }
  .history-points.negative { background: #fde8e4; color: #7a1a10; }
`;
