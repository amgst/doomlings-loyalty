import { fetchConfig } from "@theme/utilities";

const APP_URL = window.FoxTheme?.upsale?.appUrl || "https://upsale-cyan.vercel.app";
const SHOP_DOMAIN = window.FoxTheme?.routes?.shop_url ? new URL(window.FoxTheme.routes.shop_url).hostname : "";

let rulesCache = Array.isArray(window.FoxTheme?.upsale?.cartQuantityRules?.rules)
  ? window.FoxTheme.upsale.cartQuantityRules.rules
  : [];
let loadPromise = null;
let syncRunning = false;
let syncQueued = false;

function setRules(rules) {
  const nextRules = Array.isArray(rules) ? rules.filter((rule) => rule && rule.enabled !== false) : [];
  window.FoxTheme = window.FoxTheme || {};
  window.FoxTheme.upsale = window.FoxTheme.upsale || {};
  window.FoxTheme.upsale.cartQuantityRules = { rules: nextRules };
  rulesCache = nextRules;
  document.dispatchEvent(new CustomEvent("upsale:cart-limits-loaded", { detail: { rules: nextRules } }));
}

function getRuleByProductId(productId) {
  return rulesCache.find((rule) => String(rule.productId) === String(productId)) || null;
}

async function safeJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadRules() {
  if (rulesCache.length > 0) return rulesCache;
  if (loadPromise) return loadPromise;
  if (!SHOP_DOMAIN) return [];

  loadPromise = fetch(`${APP_URL}/api/public/cart-limits?shop=${encodeURIComponent(SHOP_DOMAIN)}`, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
  })
    .then(async (response) => ((await safeJson(response))?.rules) || [])
    .then((rules) => {
      setRules(rules);
      return rulesCache;
    })
    .catch(() => [])
    .finally(() => {
      loadPromise = null;
    });

  return loadPromise;
}

function lockSelector(selector, quantity) {
  if (!(selector instanceof HTMLElement)) return;
  selector.dataset.lockedQuantity = String(quantity);

  const input = selector.querySelector('input[ref="quantityInput"], .quantity-input');
  const buttons = selector.querySelectorAll('button[ref="quantityButtons[]"], .quantity-button');

  if (input instanceof HTMLInputElement) {
    input.value = String(quantity);
    input.min = String(quantity);
    input.readOnly = true;
    input.disabled = true;
  }

  buttons.forEach((button) => {
    if (button instanceof HTMLButtonElement) {
      button.disabled = true;
      button.hidden = true;
    }
  });
}

function lockCartRow(productId, quantity, maxQuantity) {
  document.querySelectorAll(`tr[data-product-id="${productId}"]`).forEach((row) => {
    if (row instanceof HTMLElement) {
      row.dataset.lockedQuantity = String(quantity);
      row.dataset.maxQuantity = String(maxQuantity);
    }
  });
}

function applySelectorLocks() {
  document.querySelectorAll("quantity-selector-component[data-product-id]").forEach((selector) => {
    if (!(selector instanceof HTMLElement)) return;
    const rule = getRuleByProductId(selector.dataset.productId);
    if (!rule) return;
    selector.dataset.maxQuantity = String(Number(rule.quantity || 1));

    if (selector.dataset.context !== "cart-items") return;

    const input = selector.querySelector('input[ref="quantityInput"], .quantity-input');
    const currentQuantity = input instanceof HTMLInputElement ? Number(input.value || 0) : 0;
    const lockedQuantity = Math.max(currentQuantity, 1);

    lockSelector(selector, lockedQuantity);
    lockCartRow(selector.dataset.productId, lockedQuantity, Number(rule.quantity || 1));
  });
}

async function fetchCart() {
  const response = await fetch(FoxTheme.routes.cart, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return safeJson(response);
}

async function updateCartLine(line, quantity) {
  const response = await fetch(
    FoxTheme.routes.cart_change_url,
    fetchConfig("json", {
      body: JSON.stringify({
        line,
        quantity,
        sections_url: window.location.pathname,
      }),
    }),
  );
  return safeJson(response);
}

async function syncCartLockedQuantities() {
  if (syncRunning) {
    syncQueued = true;
    return;
  }

  syncRunning = true;

  try {
    await loadRules();
    applySelectorLocks();

    if (!rulesCache.length) return;

    const cart = await fetchCart();
    if (!cart?.items?.length) return;

    for (let index = 0; index < cart.items.length; index += 1) {
      const item = cart.items[index];
      const rule = getRuleByProductId(item.product_id);
      if (!rule) continue;

      const maxQuantity = Number(rule.quantity || 1);
      if (Number(item.quantity || 0) <= maxQuantity) continue;

      await updateCartLine(index + 1, maxQuantity);
    }

    applySelectorLocks();
  } catch (error) {
    console.error("[cart-limits] sync failed", error);
  } finally {
    syncRunning = false;
    if (syncQueued) {
      syncQueued = false;
      window.setTimeout(syncCartLockedQuantities, 60);
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadRules().then(() => {
    applySelectorLocks();
    syncCartLockedQuantities();
  });
});

document.addEventListener("shopify:section:load", () => {
  loadRules().then(() => {
    applySelectorLocks();
    syncCartLockedQuantities();
  });
});

document.addEventListener("cart:updated", () => {
  window.setTimeout(syncCartLockedQuantities, 80);
});

document.addEventListener("cart:refresh", () => {
  window.setTimeout(syncCartLockedQuantities, 80);
});
