import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import { validateYotpoCredentials } from "../yotpo.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await prisma.appSettings.findUnique({
    where: { shop: session.shop },
  });
  return json({ settings });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "save") {
    const yotpoApiKey = String(formData.get("yotpoApiKey") || "");
    const yotpoGuid = String(formData.get("yotpoGuid") || "");
    const yotpoSecretKey = String(formData.get("yotpoSecretKey") || "");
    const pointsName = String(formData.get("pointsName") || "Doomlings Points");
    const pointsNamePlural = String(formData.get("pointsNamePlural") || "Doomlings Points");
    const currencySymbol = String(formData.get("currencySymbol") || "★");
    const widgetEnabled = formData.get("widgetEnabled") === "on";
    const referralEnabled = formData.get("referralEnabled") === "on";
    const reviewsEnabled = formData.get("reviewsEnabled") === "on";

    // Validate Yotpo credentials if provided
    let credentialsValid = null;
    if (yotpoApiKey && yotpoGuid) {
      credentialsValid = await validateYotpoCredentials({
        apiKey: yotpoApiKey,
        guid: yotpoGuid,
        secretKey: yotpoSecretKey || undefined,
      });
      if (!credentialsValid) {
        return json({
          error: "Could not connect to Yotpo with the provided credentials. Please check your API Key and GUID.",
          success: false,
        });
      }
    }

    await prisma.appSettings.upsert({
      where: { shop: session.shop },
      create: {
        shop: session.shop,
        yotpoApiKey: yotpoApiKey || null,
        yotpoGuid: yotpoGuid || null,
        yotpoSecretKey: yotpoSecretKey || null,
        pointsName,
        pointsNamePlural,
        currencySymbol,
        widgetEnabled,
        referralEnabled,
        reviewsEnabled,
      },
      update: {
        yotpoApiKey: yotpoApiKey || null,
        yotpoGuid: yotpoGuid || null,
        yotpoSecretKey: yotpoSecretKey || null,
        pointsName,
        pointsNamePlural,
        currencySymbol,
        widgetEnabled,
        referralEnabled,
        reviewsEnabled,
      },
    });

    return json({ success: true, error: null });
  }

  return json({ success: false, error: "Unknown action" });
};

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Configure Yotpo integration and loyalty program</p>
        </div>
      </div>

      {actionData?.success && (
        <div className="alert alert-success">
          ✓ Settings saved successfully
        </div>
      )}
      {actionData?.error && (
        <div className="alert alert-error">
          ✗ {actionData.error}
        </div>
      )}

      <Form method="post" className="settings-form">
        <input type="hidden" name="intent" value="save" />

        {/* Yotpo Credentials */}
        <div className="card settings-card">
          <div className="card-header">
            <h2 className="card-title">Yotpo Integration</h2>
            <span className="status-dot" data-active={!!(settings?.yotpoApiKey && settings?.yotpoGuid)}>
              {settings?.yotpoApiKey && settings?.yotpoGuid ? "● Connected" : "○ Not connected"}
            </span>
          </div>
          <div className="card-body">
            <p className="card-hint">
              Find your credentials in your{" "}
              <strong>Yotpo dashboard → Account Settings → Store Settings</strong>.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="yotpoApiKey">API Key</label>
                <input
                  id="yotpoApiKey"
                  name="yotpoApiKey"
                  type="text"
                  defaultValue={settings?.yotpoApiKey ?? ""}
                  placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
                  autoComplete="off"
                />
              </div>
              <div className="form-group">
                <label htmlFor="yotpoGuid">Store GUID</label>
                <input
                  id="yotpoGuid"
                  name="yotpoGuid"
                  type="text"
                  defaultValue={settings?.yotpoGuid ?? ""}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="yotpoSecretKey">
                Secret Key <span className="label-optional">(optional)</span>
              </label>
              <input
                id="yotpoSecretKey"
                name="yotpoSecretKey"
                type="password"
                defaultValue={settings?.yotpoSecretKey ?? ""}
                placeholder="For server-side operations"
                autoComplete="off"
              />
            </div>
          </div>
        </div>

        {/* Loyalty Branding */}
        <div className="card settings-card">
          <div className="card-header">
            <h2 className="card-title">Loyalty Program Branding</h2>
          </div>
          <div className="card-body">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="pointsName">Points Name (singular)</label>
                <input
                  id="pointsName"
                  name="pointsName"
                  type="text"
                  defaultValue={settings?.pointsName ?? "Doomlings Point"}
                  placeholder="Doomlings Point"
                />
                <span className="field-hint">e.g. "Doomling", "Star", "Coin"</span>
              </div>
              <div className="form-group">
                <label htmlFor="pointsNamePlural">Points Name (plural)</label>
                <input
                  id="pointsNamePlural"
                  name="pointsNamePlural"
                  type="text"
                  defaultValue={settings?.pointsNamePlural ?? "Doomlings Points"}
                  placeholder="Doomlings Points"
                />
              </div>
            </div>
            <div className="form-group form-group-sm">
              <label htmlFor="currencySymbol">Points Icon</label>
              <input
                id="currencySymbol"
                name="currencySymbol"
                type="text"
                defaultValue={settings?.currencySymbol ?? "★"}
                placeholder="★"
                maxLength={2}
              />
              <span className="field-hint">A single emoji or symbol shown next to point totals</span>
            </div>
          </div>
        </div>

        {/* Widget Features */}
        <div className="card settings-card">
          <div className="card-header">
            <h2 className="card-title">Storefront Features</h2>
          </div>
          <div className="card-body">
            <div className="toggle-list">
              {[
                {
                  name: "widgetEnabled",
                  label: "Loyalty Widget",
                  desc: "Show loyalty points balance and earning rules on the storefront",
                  defaultChecked: settings?.widgetEnabled ?? true,
                },
                {
                  name: "referralEnabled",
                  label: "Referral Program",
                  desc: "Allow customers to share referral links and earn bonus points",
                  defaultChecked: settings?.referralEnabled ?? true,
                },
                {
                  name: "reviewsEnabled",
                  label: "Review Points",
                  desc: "Award points when customers submit Yotpo reviews",
                  defaultChecked: settings?.reviewsEnabled ?? true,
                },
              ].map((toggle) => (
                <label key={toggle.name} className="toggle-row">
                  <div className="toggle-info">
                    <span className="toggle-label">{toggle.label}</span>
                    <span className="toggle-desc">{toggle.desc}</span>
                  </div>
                  <div className="toggle-control">
                    <input
                      type="checkbox"
                      name={toggle.name}
                      id={toggle.name}
                      defaultChecked={toggle.defaultChecked}
                      className="toggle-input"
                    />
                    <span className="toggle-thumb" />
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </Form>

      <style>{`
        ${settingsStyles}
      `}</style>
    </div>
  );
}

const settingsStyles = `
  .page { max-width: 80rem; }
  .page-header { margin-bottom: 3.2rem; }
  .page-title { font-size: 2.8rem; font-weight: 700; letter-spacing: -0.04em; color: #000; }
  .page-subtitle { font-size: 1.3rem; color: rgba(0,0,0,.5); margin-top: 0.4rem; }

  .alert {
    padding: 1.4rem 2rem;
    border-radius: 0.8rem;
    font-size: 1.4rem;
    font-weight: 500;
    margin-bottom: 2.4rem;
  }
  .alert-success { background: #d4f4e4; color: #0a5c38; border: 1px solid #0a9b6133; }
  .alert-error { background: #fde8e4; color: #7a1a10; border: 1px solid #c4301c33; }

  .settings-form { display: flex; flex-direction: column; gap: 2.4rem; }
  .settings-card {
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
  .status-dot { font-size: 1.2rem; color: rgba(0,0,0,.4); }
  .status-dot[data-active="true"] { color: #0a9b61; }
  .card-body { padding: 2.4rem; display: flex; flex-direction: column; gap: 1.6rem; }
  .card-hint { font-size: 1.3rem; color: rgba(0,0,0,.55); background: #f5f5f5; padding: 1.2rem 1.6rem; border-radius: 0.6rem; }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1.6rem; }
  .form-group { display: flex; flex-direction: column; gap: 0.6rem; }
  .form-group-sm { max-width: 20rem; }
  .form-group label {
    font-size: 1.3rem;
    font-weight: 600;
    color: #000;
  }
  .label-optional { font-weight: 400; color: rgba(0,0,0,.4); }
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
  }
  .form-group input:focus { border-color: #000; background: #fff; }
  .field-hint { font-size: 1.2rem; color: rgba(0,0,0,.45); }

  /* Toggles */
  .toggle-list { display: flex; flex-direction: column; gap: 0; }
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
    padding: 1.6rem 0;
    border-bottom: 1px solid rgba(0,0,0,.05);
    cursor: pointer;
  }
  .toggle-row:last-child { border-bottom: none; padding-bottom: 0; }
  .toggle-row:first-child { padding-top: 0; }
  .toggle-info { flex: 1; }
  .toggle-label { display: block; font-size: 1.4rem; font-weight: 600; color: #000; margin-bottom: 0.2rem; }
  .toggle-desc { font-size: 1.2rem; color: rgba(0,0,0,.5); }
  .toggle-control { position: relative; width: 4.4rem; height: 2.4rem; flex-shrink: 0; }
  .toggle-input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .toggle-thumb {
    position: absolute;
    inset: 0;
    background: #ddd;
    border-radius: 2.4rem;
    transition: background 0.2s;
    cursor: pointer;
  }
  .toggle-thumb::after {
    content: "";
    position: absolute;
    top: 0.2rem;
    left: 0.2rem;
    width: 2rem;
    height: 2rem;
    background: #fff;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 0.1rem 0.4rem rgba(0,0,0,.2);
  }
  .toggle-input:checked + .toggle-thumb { background: #000; }
  .toggle-input:checked + .toggle-thumb::after { transform: translateX(2rem); }

  /* Actions */
  .form-actions { display: flex; justify-content: flex-end; }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 5rem;
    padding: 0 2.8rem;
    border-radius: 0.6rem;
    font-size: 1.4rem;
    font-weight: 600;
    border: none;
    cursor: pointer;
    transition: opacity 0.2s;
    letter-spacing: -0.01em;
    font-family: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn:hover:not(:disabled) { opacity: 0.85; }
  .btn-primary { background: #000; color: #fff; }
`;
