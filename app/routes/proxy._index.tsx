/**
 * App Proxy — Loyalty Page
 * URL: yourstore.com/apps/loyalty
 *
 * Returns Content-Type: application/liquid so Shopify renders the response
 * inside the store's theme (header, footer, CSS variables — all included).
 * Data is fetched server-side; no CORS issues, no extra client round-trips.
 */
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { prisma } from "../db.server";
import {
  getCustomerPoints,
  getPointsHistory,
  getEarningRules,
  getAvailableRewards,
  redeemReward,
  type YotpoConfig,
  type YotpoCustomer,
  type YotpoPointsHistory,
  type YotpoReward,
  type YotpoEarningRule,
} from "../yotpo.server";

// ─── Action: redeem reward ─────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { storefront } = await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const formData = await request.formData();
  const intent = String(formData.get("intent"));
  const email = String(formData.get("email") ?? "");
  const redemptionOptionId = String(formData.get("redemptionOptionId") ?? "");

  const settings = await prisma.appSettings.findUnique({ where: { shop } });
  if (!settings?.yotpoApiKey || !settings?.yotpoGuid) {
    return liquidResponse("{% assign loyalty_error = 'App not configured.' %}");
  }

  const config: YotpoConfig = {
    apiKey: settings.yotpoApiKey,
    guid: settings.yotpoGuid,
    secretKey: settings.yotpoSecretKey ?? undefined,
  };

  if (intent === "redeem" && email && redemptionOptionId) {
    const result = await redeemReward(config, email, redemptionOptionId);
    // Re-render the page with a result message embedded
    return renderLoyaltyPage({ request, shop, settings, config, redeemResult: result });
  }

  return renderLoyaltyPage({ request, shop, settings, config });
};

// ─── Loader: main page render ──────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop") ?? "";
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id") ?? "";

  const settings = await prisma.appSettings.findUnique({ where: { shop } });

  if (!settings?.yotpoApiKey || !settings?.yotpoGuid) {
    return renderNotConfigured();
  }

  const config: YotpoConfig = {
    apiKey: settings.yotpoApiKey,
    guid: settings.yotpoGuid,
    secretKey: settings.yotpoSecretKey ?? undefined,
  };

  return renderLoyaltyPage({ request, shop, settings, config });
};

// ─── Helpers ───────────────────────────────────────────────────────────────

function liquidResponse(body: string) {
  return new Response(body, {
    headers: { "Content-Type": "application/liquid" },
  });
}

function renderNotConfigured() {
  return liquidResponse(`
<div class="page-width" style="padding: 6rem 0; text-align: center;">
  <p style="color: rgb(var(--color-foreground) / 50%); font-size: 1.6rem;">
    The loyalty program is not yet configured.
  </p>
</div>
  `.trim());
}

interface RenderOptions {
  request: Request;
  shop: string;
  settings: Awaited<ReturnType<typeof prisma.appSettings.findUnique>>;
  config: YotpoConfig;
  redeemResult?: { success: boolean; code?: string; error?: string };
}

async function renderLoyaltyPage({
  request,
  shop,
  settings,
  config,
  redeemResult,
}: RenderOptions) {
  const appUrl = new URL(request.url).origin;
  const pointsName = settings?.pointsName ?? "Doomlings Points";
  const pointsNamePlural = settings?.pointsNamePlural ?? "Doomlings Points";
  const currencySymbol = settings?.currencySymbol ?? "★";
  const showReferral = settings?.referralEnabled ?? true;
  const showHistory = true;

  // We fetch rules/rewards server-side always (public data)
  const [earningRules, rewards] = await Promise.all([
    getEarningRules(config),
    getAvailableRewards(config),
  ]);

  // Customer data is fetched server-side using the email from Liquid context,
  // but at this point (before Liquid render) we don't have the email.
  // We embed a JS snippet that calls back for customer-specific data.
  // Rules & rewards are pre-rendered — no JS needed for those.

  const redeemAlert = redeemResult
    ? redeemResult.success
      ? `<div class="loyalty-alert loyalty-alert--success">✓ Reward redeemed!${redeemResult.code ? ` Your code: <strong>${escHtml(redeemResult.code)}</strong>` : ""}</div>`
      : `<div class="loyalty-alert loyalty-alert--error">✗ ${escHtml(redeemResult.error ?? "Redemption failed.")}</div>`
    : "";

  const earnCardsHtml = earningRules.length
    ? earningRules.map(renderEarnCard).join("\n")
    : `<p class="loyalty-empty">No earning rules configured yet.</p>`;

  const rewardCardsHtml = rewards.length
    ? rewards
        .map((r) => renderRewardCard(r, shop, appUrl))
        .join("\n")
    : `<p class="loyalty-empty">No rewards available yet.</p>`;

  // The returned string is Liquid — Shopify evaluates it in the store context,
  // giving us {{ customer }}, {{ shop }}, routes.*, btn classes, CSS vars, etc.
  const liquid = `
{% assign loyalty_app_url = ${JSON.stringify(appUrl)} %}
{% assign loyalty_shop = ${JSON.stringify(shop)} %}
{% assign loyalty_currency = ${JSON.stringify(currencySymbol)} %}
{% assign loyalty_pts_plural = ${JSON.stringify(pointsNamePlural)} %}

{{ 'loyalty-widget.css' | asset_url | stylesheet_tag }}
<link rel="stylesheet" href="{{ loyalty_app_url }}/proxy/loyalty.css">

<div class="loyalty-page-wrap">
<div class="page-width loyalty-page-inner">

{%- if customer -%}

  {%- comment -%} HERO — balance loaded client-side {%- endcomment -%}
  <div class="loyalty-hero" id="loyalty-hero" data-loading="true">
    <div class="loyalty-hero__inner">
      <div class="loyalty-hero__greeting">
        <p class="loyalty-hero__eyebrow">Welcome back,</p>
        <h1 class="loyalty-hero__name h2">{{ customer.first_name }}</h1>
      </div>
      <div class="loyalty-hero__balance-wrap">
        <div class="loyalty-hero__balance">
          <span class="loyalty-hero__balance-icon" id="lp-sym">{{ loyalty_currency }}</span>
          <span class="loyalty-hero__balance-number" id="lp-bal">—</span>
        </div>
        <p class="loyalty-hero__balance-label" id="lp-ptsLabel">{{ loyalty_pts_plural }}</p>
        <div class="loyalty-hero__tier" id="lp-tier" hidden>
          <span class="loyalty-tier-badge" id="lp-tierName"></span>
        </div>
      </div>
    </div>
  </div>

  {%- comment -%} TABS {%- endcomment -%}
  <div class="loyalty-tabs" role="tablist">
    <button class="loyalty-tab active" data-tab="earn"    role="tab" aria-selected="true"  aria-controls="lp-earn">Ways to Earn</button>
    <button class="loyalty-tab"        data-tab="rewards" role="tab" aria-selected="false" aria-controls="lp-rewards">Rewards</button>
    ${showReferral ? `<button class="loyalty-tab" data-tab="refer" role="tab" aria-selected="false" aria-controls="lp-refer">Refer a Friend</button>` : ""}
    ${showHistory ? `<button class="loyalty-tab" data-tab="history" role="tab" aria-selected="false" aria-controls="lp-history">History</button>` : ""}
  </div>

  {%- comment -%} EARN TAB — pre-rendered server-side {%- endcomment -%}
  <div id="lp-earn" class="loyalty-tab-panel" role="tabpanel">
    <div class="loyalty-earn-grid">
      ${earnCardsHtml}
    </div>
  </div>

  {%- comment -%} REWARDS TAB — pre-rendered, redeem via form POST {%- endcomment -%}
  <div id="lp-rewards" class="loyalty-tab-panel hidden" role="tabpanel">
    ${redeemAlert}
    <div class="loyalty-rewards-grid" id="lp-rewards-grid">
      ${rewardCardsHtml}
    </div>
  </div>

  ${showReferral ? referralTabHtml() : ""}
  ${showHistory ? historyTabHtml() : ""}

{%- else -%}

  {%- comment -%} GUEST VIEW {%- endcomment -%}
  <div class="loyalty-guest loyalty-card">
    <div class="loyalty-guest__icon">★</div>
    <h2 class="loyalty-guest__heading h2">Join the Doomlings Loyalty Program</h2>
    <p class="loyalty-guest__body">
      Earn points on every purchase, leave reviews, and refer friends to unlock exclusive rewards.
    </p>
    <div class="loyalty-guest__actions">
      <a href="{{ routes.account_login_url }}" class="btn btn--primary btn--medium">Sign In</a>
      <a href="{{ routes.account_register_url }}" class="btn btn--secondary btn--medium">Create Account</a>
    </div>
  </div>

{%- endif -%}

</div>
</div>

{%- if customer -%}
<script>
(function(){
  var APP = ${JSON.stringify(appUrl)};
  var SHOP = ${JSON.stringify(shop)};
  var EMAIL = {{ customer.email | json }};
  var sym = ${JSON.stringify(currencySymbol)};
  var ptsPlural = ${JSON.stringify(pointsNamePlural)};

  function el(id){ return document.getElementById(id); }
  function fmt(n){ return Number(n).toLocaleString(); }
  function fmtDate(iso){
    try{ return new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
    catch(e){ return iso; }
  }
  function esc(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── Tabs ── */
  document.querySelectorAll('.loyalty-tab').forEach(function(tab){
    tab.addEventListener('click', function(){
      document.querySelectorAll('.loyalty-tab').forEach(function(t){
        t.classList.remove('active'); t.setAttribute('aria-selected','false');
      });
      document.querySelectorAll('.loyalty-tab-panel').forEach(function(p){ p.classList.add('hidden'); });
      tab.classList.add('active'); tab.setAttribute('aria-selected','true');
      var panel = document.getElementById('lp-' + tab.getAttribute('data-tab'));
      if(panel) panel.classList.remove('hidden');
    });
  });

  /* ── Load customer profile (balance + referral + history) ── */
  fetch(APP + '/proxy/customer?shop=' + encodeURIComponent(SHOP) + '&email=' + encodeURIComponent(EMAIL))
    .then(function(r){ return r.json(); })
    .then(function(data){
      if(!data.customer) return;
      var c = data.customer;
      el('lp-sym').textContent  = data.currencySymbol || sym;
      el('lp-bal').textContent  = fmt(c.pointsBalance);
      el('lp-ptsLabel').textContent = data.pointsNamePlural || ptsPlural;
      if(c.tierName){ el('lp-tier').hidden=false; el('lp-tierName').textContent=c.tierName; }
      el('loyalty-hero').removeAttribute('data-loading');

      ${showReferral ? `
      if(c.referralLink){
        var rb = el('lp-referral-box'); if(rb) rb.hidden=false;
        var ri = el('lp-referral-input'); if(ri) ri.value=c.referralLink;
      }
      if(c.referralCode){
        var rh=el('lp-referral-code-hint'); if(rh) rh.hidden=false;
        var rc=el('lp-referral-code'); if(rc) rc.textContent=c.referralCode;
      }
      ` : ""}

      ${showHistory ? `
      if(data.history){
        el('lp-history-loading').hidden=true;
        var hEl=el('lp-history-list'); hEl.hidden=false;
        if(data.history.length){
          hEl.innerHTML='<ul class="loyalty-history-list">'+data.history.map(function(e){
            var pos=e.points>=0;
            return '<li class="loyalty-history-item">'+
              '<div class="history-item__info">'+
                '<span class="history-item__desc">'+esc(e.description)+'</span>'+
                '<span class="history-item__date">'+fmtDate(e.createdAt)+'</span>'+
              '</div>'+
              '<span class="history-item__points '+(pos?'positive':'negative')+'">'+(pos?'+':'')+e.points+'</span>'+
            '</li>';
          }).join('')+'</ul>';
        } else {
          hEl.innerHTML='<p class="loyalty-empty">No points activity yet.</p>';
        }
      }
      ` : ""}
    });

  ${showReferral ? `
  /* ── Copy referral link ── */
  var copyBtn = el('lp-copy-btn');
  if(copyBtn){
    copyBtn.addEventListener('click', function(){
      var input = el('lp-referral-input');
      navigator.clipboard && navigator.clipboard.writeText(input.value).then(function(){
        copyBtn.textContent='Copied!';
        setTimeout(function(){ copyBtn.textContent='Copy Link'; }, 2000);
      });
    });
  }
  ` : ""}
})();
</script>
{%- endif -%}
`.trim();

  return new Response(liquid, {
    headers: { "Content-Type": "application/liquid" },
  });
}

// ─── Sub-tab HTML helpers ─────────────────────────────────────────────────

function referralTabHtml() {
  return `
  {%- comment -%} REFERRAL TAB {%- endcomment -%}
  <div id="lp-refer" class="loyalty-tab-panel hidden" role="tabpanel">
    <div class="loyalty-referral-card loyalty-card">
      <h2 class="loyalty-card__title">Share the love</h2>
      <p class="loyalty-card__body">
        Give your friends a discount and earn points when they make their first purchase.
      </p>
      <div class="referral-link-box" id="lp-referral-box" hidden>
        <input type="text" id="lp-referral-input" class="loyalty-input" readonly aria-label="Your referral link">
        <button class="btn btn--primary btn--medium" id="lp-copy-btn" type="button">Copy Link</button>
      </div>
      <p class="loyalty-hint" id="lp-referral-code-hint" hidden>
        Your referral code: <strong id="lp-referral-code"></strong>
      </p>
    </div>
  </div>`;
}

function historyTabHtml() {
  return `
  {%- comment -%} HISTORY TAB {%- endcomment -%}
  <div id="lp-history" class="loyalty-tab-panel hidden" role="tabpanel">
    <div class="loyalty-loading" id="lp-history-loading">
      <div class="loyalty-spinner"></div>
    </div>
    <div id="lp-history-list" hidden></div>
  </div>`;
}

// ─── Card renderers ────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, string> = {
  cart: "🛒", person: "👤", gift: "🎁", share: "🔗",
  star: "⭐", sparkles: "✨", heart: "❤️",
};

function renderEarnCard(r: YotpoEarningRule) {
  return `<div class="loyalty-earn-card loyalty-card">
  <div class="earn-card__icon">${ACTION_ICONS[r.icon] ?? "⭐"}</div>
  <div class="earn-card__info">
    <h3 class="earn-card__name">${escHtml(r.name)}</h3>
    <p class="earn-card__desc">${escHtml(r.description)}</p>
  </div>
  <div class="earn-card__points">
    <span class="earn-card__pts-value">${r.points > 0 ? "+" : ""}${r.points}</span>
    <span class="earn-card__pts-label">pts</span>
  </div>
</div>`;
}

function renderRewardCard(r: YotpoReward, shop: string, appUrl: string) {
  // Redeem via a native form POST — works without JS
  return `{%- if customer -%}
<div class="loyalty-reward-card loyalty-card">
  <div class="reward-card__header">
    <div class="reward-card__icon">🎁</div>
    <div class="reward-card__badge">${r.pointsCost.toLocaleString()} pts</div>
  </div>
  <h3 class="reward-card__name">${escHtml(r.name)}</h3>
  <p class="reward-card__desc">${escHtml(r.description)}</p>
  <form method="post" action="/apps/loyalty">
    <input type="hidden" name="intent" value="redeem">
    <input type="hidden" name="email" value="{{ customer.email | escape }}">
    <input type="hidden" name="redemptionOptionId" value="${escHtml(r.id)}">
    <button type="submit" class="btn btn--primary btn--medium btn--full-mobile">Redeem</button>
  </form>
</div>
{%- else -%}
<div class="loyalty-reward-card loyalty-card">
  <div class="reward-card__header">
    <div class="reward-card__icon">🎁</div>
    <div class="reward-card__badge">${r.pointsCost.toLocaleString()} pts</div>
  </div>
  <h3 class="reward-card__name">${escHtml(r.name)}</h3>
  <p class="reward-card__desc">${escHtml(r.description)}</p>
  <a href="{{ routes.account_login_url }}" class="btn btn--secondary btn--medium btn--full-mobile">Sign In to Redeem</a>
</div>
{%- endif -%}`;
}

function escHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
