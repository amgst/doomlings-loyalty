import { Component } from "@theme/component";
import { fetchConfig } from "@theme/utilities";
import { ThemeEvents, CartAddEvent, CartUpdateEvent, CartErrorEvent, VariantUpdateEvent } from "@theme/events";

function getCartQuantityRules() {
  const rules = window.FoxTheme?.upsale?.cartQuantityRules?.rules;
  return Array.isArray(rules) ? rules.filter((rule) => rule && rule.enabled !== false) : [];
}

async function ensureCartQuantityRulesLoaded() {
  const existingRules = getCartQuantityRules();
  if (existingRules.length > 0) return existingRules;

  const appUrl = window.FoxTheme?.upsale?.appUrl || "https://upsale-cyan.vercel.app";
  const shopUrl = window.FoxTheme?.routes?.shop_url;
  if (!shopUrl) return [];

  try {
    const shop = new URL(shopUrl).hostname;
    const response = await fetch(`${appUrl}/api/public/cart-limits?shop=${encodeURIComponent(shop)}`, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    const data = await response.json();
    const rules = Array.isArray(data?.rules) ? data.rules : [];
    window.FoxTheme = window.FoxTheme || {};
    window.FoxTheme.upsale = window.FoxTheme.upsale || {};
    window.FoxTheme.upsale.cartQuantityRules = { rules };
    return getCartQuantityRules();
  } catch (error) {
    console.error("Failed to load cart quantity rules:", error);
    return [];
  }
}

function getCartQuantityRuleByProductId(productId) {
  return getCartQuantityRules().find((rule) => String(rule.productId) === String(productId)) || null;
}

function buildCartQuantityLimitMessage(rule) {
  return `Only ${rule.quantity} of this item can be added to your cart.`;
}

/**
 * A custom element that manages an add to cart button.
 *
 * @typedef {object} AddToCartRefs
 * @property {HTMLButtonElement} addToCartButton - The add to cart button.
 * @extends Component<AddToCartRefs>
 */
export class AddToCartComponent extends Component {
  requiredRefs = ["addToCartButton"];

  connectedCallback() {
    // Listen for cart add events to remove loading state
    document.addEventListener(CartAddEvent.eventName, this.#onCartAddDone.bind(this));

    // Listen for cart error events to remove loading state
    document.addEventListener(CartErrorEvent.eventName, this.#onCartAddDone.bind(this));

    super.connectedCallback();
  }

  disconnectedCallback() {
    // Remove event listeners
    document.removeEventListener(CartAddEvent.eventName, this.#onCartAddDone.bind(this));
    document.removeEventListener(CartErrorEvent.eventName, this.#onCartAddDone.bind(this));
    super.disconnectedCallback();
  }

  /**
   * Disables the add to cart button.
   */
  disable() {
    this.refs.addToCartButton.disabled = true;
  }

  /**
   * Enables the add to cart button.
   */
  enable() {
    this.refs.addToCartButton.disabled = false;
  }

  /**
   * Adds loading class to the add to cart button.
   */
  addLoading() {
    this.refs.addToCartButton.classList.add("btn--loading");
    this.refs.addToCartSpinner.classList.remove("hidden");
  }

  /**
   * Removes loading class from the add to cart button.
   */
  removeLoading() {
    this.refs.addToCartButton.classList.remove("btn--loading");
    this.refs.addToCartSpinner.classList.add("hidden");
  }

  /**
   * Handles cart add completion (success or error).
   * Removes loading state from the button.
   */
  #onCartAddDone() {
    this.removeLoading();
  }
}

if (!customElements.get("add-to-cart-component")) {
  customElements.define("add-to-cart-component", AddToCartComponent);
}

/**
 * A custom element that manages a product form.
 *
 * @typedef {object} ProductFormRefs
 * @property {HTMLInputElement} variantId - The form input for submitting the variant ID.
 * @property {AddToCartComponent | undefined} addToCartButtonContainer - The add to cart button container element.
 * @property {HTMLElement | undefined} addToCartTextError - The add to cart text error.
 * @property {HTMLElement | undefined} acceleratedCheckoutButtonContainer - The accelerated checkout button container element.
 * @property {HTMLElement} liveRegion - The live region.
 *
 * @extends Component<ProductFormRefs>
 */
class ProductFormComponent extends Component {
  requiredRefs = ["variantId", "liveRegion"];
  #abortController = new AbortController();

  /** @type {number | undefined} */
  #timeout;

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const target = this.closest(".shopify-section, dialog, product-card");
    target?.addEventListener(ThemeEvents.variantUpdate, this.#onVariantUpdate, {
      signal,
    });
    target?.addEventListener(ThemeEvents.variantSelected, this.#onVariantSelected, { signal });
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
  }

  /**
   * Handles the submit event for the product form.
   *
   * @param {Event} event - The submit event.
   */
  async handleSubmit(event) {
    const { addToCartTextError } = this.refs;
    // Stop default behaviour from the browser
    event.preventDefault();

    if (this.#timeout) clearTimeout(this.#timeout);

    // Check if the add to cart button is disabled and do an early return if it is
    if (this.refs.addToCartButtonContainer?.refs.addToCartButton?.getAttribute("disabled") === "true") return;

    // Add loading state to the add to cart button
    this.refs.addToCartButtonContainer?.addLoading();

    // Send the add to cart information to the cart
    const form = this.querySelector("form");

    if (!form) throw new Error("Product form element missing");

    const formData = new FormData(form);
    const limitResult = await this.#enforceCartQuantityRule(formData);

    if (!limitResult.allowed) {
      return;
    }

    // Request sections for cart-items components
    const cartItemsComponents = document.querySelectorAll("cart-items-component");
    const cartItemComponentsSectionIds = [];
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        cartItemComponentsSectionIds.push(item.dataset.sectionId);
      }
    });

    if (cartItemComponentsSectionIds.length > 0) {
      formData.append("sections", cartItemComponentsSectionIds.join(","));
    }

    const fetchCfg = fetchConfig("javascript", { body: formData });

    fetch(FoxTheme.routes.cart_add_url, {
      ...fetchCfg,
      headers: {
        ...fetchCfg.headers,
        Accept: "text/html",
      },
    })
      .then((response) => response.json())
      .then((response) => {
        if (response.status) {
          this.dispatchEvent(
            new CartErrorEvent(form.getAttribute("id") || "", response.message, response.description, response.errors)
          );

          this.refs.addToCartButtonContainer?.removeLoading();

          this.#showFormError(response.description || response.message);

          // When error occurs (e.g. adding more items than available),
          // backend still adds the max allowed amount to cart.
          // Dispatch CartUpdateEvent with actual count for cart count sync.
          if (response.sections) {
            let actualItemCount = 0;
            let foundCount = false;

            for (const section of Object.values(response.sections)) {
              const tempDiv = document.createElement("div");
              tempDiv.innerHTML = section;

              // Try cart-items ref first, fallback to cart-count bubble
              let itemCountElement = tempDiv.querySelector('[ref="cartItemCount"]');
              if (!itemCountElement) {
                itemCountElement = tempDiv.querySelector(".cart-bubble__text-count");
              }

              if (itemCountElement) {
                actualItemCount = parseInt(itemCountElement.textContent || "0", 10);
                foundCount = true;
                break;
              }
            }
            if (foundCount) {
              this.dispatchEvent(
                new CartUpdateEvent({}, this.id, {
                  itemCount: actualItemCount,
                  source: "product-form-component",
                  productId: this.dataset.productId,
                  sections: response.sections,
                })
              );
            }
          } else {
            // Shopify doesn't return sections on 422 errors
            // Fetch cart.js to get actual count (edge case: add more than available)
            fetch(FoxTheme.routes.cart)
              .then((res) => res.json())
              .then((cart) => {
                this.dispatchEvent(
                  new CartUpdateEvent({}, this.id, {
                    itemCount: cart.item_count || 0,
                    source: "product-form-component",
                    productId: this.dataset.productId,
                  })
                );
              })
              .catch((error) => {
                console.error("Failed to fetch cart count:", error);
              });
          }

          return;
        } else {
          const id = formData.get("id");

          if (addToCartTextError) {
            addToCartTextError.classList.add("hidden");
            addToCartTextError.removeAttribute("aria-live");
          }

          if (!id) throw new Error("Form ID is required");

          // Add aria-live region to inform screen readers that the item was added
          if (this.refs.addToCartButtonContainer?.refs.addToCartButton) {
            const addedText = FoxTheme.translations.added;
            this.#setLiveRegionText(addedText);

            setTimeout(() => {
              this.#clearLiveRegionText();
            }, 5000);
          }

          this.dispatchEvent(
            new CartAddEvent({}, id.toString(), {
              source: "product-form-component",
              itemCount: Number(formData.get("quantity")) || Number(this.dataset.quantityDefault),
              productId: this.dataset.productId,
              sections: response.sections,
            })
          );
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        // add more thing to do in here if needed.
        // cartPerformance.measureFromEvent("add:user-action", event);
      });
  }

  async #enforceCartQuantityRule(formData) {
    await ensureCartQuantityRulesLoaded();
    const rule = getCartQuantityRuleByProductId(this.dataset.productId);
    if (!rule) {
      return { allowed: true };
    }

    const requestedQuantity = Math.max(
      1,
      Number(formData.get("quantity")) || Number(this.dataset.quantityDefault) || 1
    );

    try {
      const response = await fetch(FoxTheme.routes.cart, {
        headers: {
          Accept: "application/json",
        },
      });
      const cart = await response.json();
      const currentQuantity = Array.isArray(cart.items)
        ? cart.items.reduce((sum, item) => {
            return String(item.product_id) === String(this.dataset.productId) ? sum + Number(item.quantity || 0) : sum;
          }, 0)
        : 0;
      const remainingAllowedQuantity = Math.max(Number(rule.quantity || 1) - currentQuantity, 0);

      if (remainingAllowedQuantity <= 0) {
        this.refs.addToCartButtonContainer?.removeLoading();
        this.#showFormError(buildCartQuantityLimitMessage(rule));
        return { allowed: false };
      }

      if (requestedQuantity > remainingAllowedQuantity) {
        formData.set("quantity", String(remainingAllowedQuantity));
        this.#showFormError(buildCartQuantityLimitMessage(rule));
      }
    } catch (error) {
      console.error("Failed to validate cart quantity rule:", error);
    }

    return { allowed: true };
  }

  #showFormError(message) {
    const { addToCartTextError } = this.refs;

    if (this.#timeout) {
      clearTimeout(this.#timeout);
    }

    if (addToCartTextError) {
      addToCartTextError.textContent = message;
      addToCartTextError.classList.remove("hidden");
    }

    this.#setLiveRegionText(message);

    this.#timeout = setTimeout(() => {
      if (addToCartTextError) {
        addToCartTextError.classList.add("hidden");
      }

      this.#clearLiveRegionText();
    }, 10000);
  }

  /**
   * @param {*} text
   */
  #setLiveRegionText(text) {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = text;
  }

  #clearLiveRegionText() {
    const liveRegion = this.refs.liveRegion;
    liveRegion.textContent = "";
  }

  /**
   * @param {VariantUpdateEvent} event
   */
  #onVariantUpdate = (event) => {
    if (event.detail.data.newProduct) {
      this.dataset.productId = event.detail.data.newProduct.id;
    } else if (event.detail.data.productId !== this.dataset.productId) {
      return;
    }

    const { variantId, addToCartButtonContainer } = this.refs;

    const currentAddToCartButton = addToCartButtonContainer?.refs.addToCartButton;

    if (!currentAddToCartButton) return;

    // Update the button state and text optimistically (always do this, even from cache)
    const variant = event.detail.resource;
    const isAvailable = variant?.available ?? false;

    // Determine correct unavailable state
    // Sold out: Has inventory management (shopify) → inventory = 0
    // Unavailable: No inventory management OR variant is null/undefined → other reasons
    const isSoldOut = !isAvailable && variant && variant.inventory_management === "shopify";

    if (!isAvailable) {
      addToCartButtonContainer.disable();
      this.refs.acceleratedCheckoutButtonContainer?.setAttribute("hidden", "true");
    } else {
      addToCartButtonContainer.enable();
      this.refs.acceleratedCheckoutButtonContainer?.removeAttribute("hidden");
    }

    // Update button text optimistically (works for both available and unavailable)
    // This handles ALL cases: cache hit, JSON fetch, and HTML fallback
    this.#updateButtonTextOptimistic(currentAddToCartButton, isAvailable, isSoldOut);

    // Update the variant ID (always do this)
    if (event.detail.resource?.id) {
      variantId.value = event.detail.resource.id ?? "";
    } else {
      variantId.value = "";
    }
  };

  /**
   * Updates button text optimistically based on variant availability
   * @param {HTMLElement} button - The add to cart button element
   * @param {boolean} isAvailable - Whether the variant is available
   * @param {boolean} isSoldOut - Whether the variant is sold out (has inventory_management = "shopify")
   */
  #updateButtonTextOptimistic(button, isAvailable, isSoldOut = false) {
    if (!button) return;

    const textElement = button.querySelector(".add-to-cart-text__content");
    const iconTextElement = button.querySelector(".btn__icon-text");

    if (!textElement) return;

    // Get text from data attributes (translations from Liquid)
    const availableText = button.dataset.addToCartText || "Add to cart";
    const soldOutText = button.dataset.soldOutText || "Sold out";
    const unavailableText = button.dataset.unavailableText || "Unavailable";

    // Determine correct text based on state
    // - Available: variant.available = true → "Add to cart"
    // - Sold out: variant.available = false + inventory_management = "shopify" → "Sold out"
    // - Unavailable: variant.available = false + no inventory_management → "Unavailable"
    let newText;
    if (isAvailable) {
      newText = availableText;
    } else if (isSoldOut) {
      newText = soldOutText;
    } else {
      newText = unavailableText;
    }

    // Update both text content and icon text (if present)
    textElement.textContent = newText;
    if (iconTextElement) {
      iconTextElement.textContent = newText;
    }
  }

  /**
   * Disable the add to cart button while the UI is updating before #onVariantUpdate is called.
   * Accelerated checkout button is also disabled via its own event listener not exposed to the theme.
   */
  #onVariantSelected = () => {
    this.refs.addToCartButtonContainer?.disable();
  };
}

if (!customElements.get("product-form-component")) {
  customElements.define("product-form-component", ProductFormComponent);
}
