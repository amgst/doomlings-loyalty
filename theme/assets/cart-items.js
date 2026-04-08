import { Component } from "@theme/component";
import { fetchConfig, debounce, resetLoading } from "@theme/utilities";
import { morphSection, sectionRenderer } from "@theme/section-renderer";
import {
  ThemeEvents,
  CartUpdateEvent,
  QuantitySelectorUpdateEvent,
  CartAddEvent,
  DiscountUpdateEvent,
} from "@theme/events";

/** @typedef {import('./utilities').TextComponent} TextComponent */

/**
 * A custom element that displays a cart items component.
 *
 * @typedef {object} Refs
 * @property {HTMLElement[]} quantitySelectors - The quantity selector elements.
 * @property {HTMLTableRowElement[]} cartItemRows - The cart item rows.
 * @property {TextComponent} cartTotal - The cart total.
 *
 * @extends {Component<Refs>}
 */
class CartItemsComponent extends Component {
  #debouncedOnChange = debounce(this.#onQuantityChange, 300).bind(this);
  #timeout = 5000;

  connectedCallback() {
    super.connectedCallback();

    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.discountUpdate, this.handleDiscountUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#debouncedOnChange);
  }

  /**
   * Handles QuantitySelectorUpdateEvent change event.
   * @param {QuantitySelectorUpdateEvent} event - The event.
   */
  #onQuantityChange(event) {
    const { quantity, cartLine: line } = event.detail;

    if (!line) return;

    const lineItemRow = this.refs.cartItemRows[line - 1];
    const lockedQuantity = this.#getLockedQuantity(lineItemRow);

    if (lockedQuantity !== null && quantity !== lockedQuantity) {
      this.#resetLineQuantity(line, lockedQuantity);
      this.#showLockedQuantityError(line, lockedQuantity);
      return;
    }

    if (quantity === 0) {
      return this.onLineItemRemove(line);
    }

    this.updateQuantity({
      line,
      quantity,
      action: "change",
    });
    if (!lineItemRow) return;

    const removeButtons = /** @type {TextComponent | undefined} */ (
      lineItemRow.querySelectorAll(".cart-items__remove-button")
    );
    removeButtons?.forEach((button) => {
      button?.classList.add("btn--loading");
    });
  }

  /**
   * Handles the line item removal.
   * @param {number} line - The line item index.
   */
  onLineItemRemove(line, event) {
    event?.preventDefault();

    this.updateQuantity({
      line,
      quantity: 0,
      action: "clear",
    });

    const cartItemRowToRemove = this.refs.cartItemRows[line - 1];

    if (!cartItemRowToRemove) return;

    const removeButtons = /** @type {TextComponent | undefined} */ (
      cartItemRowToRemove.querySelectorAll(".cart-items__remove-button")
    );
    removeButtons.forEach((button) => {
      button?.classList.add("btn--loading");
    });
  }

  /**
   * Updates the quantity.
   * @param {Object} config - The config.
   * @param {number} config.line - The line.
   * @param {number} config.quantity - The quantity.
   * @param {string} config.action - The action.
   */
  updateQuantity(config) {
    this.#disableCartItems();

    const { line, quantity } = config;

    const cartItemsComponents = document.querySelectorAll("cart-items-component");
    const sectionsToUpdate = new Set([this.sectionId]);
    cartItemsComponents.forEach((item) => {
      if (item instanceof HTMLElement && item.dataset.sectionId) {
        sectionsToUpdate.add(item.dataset.sectionId);
      }
    });

    const body = JSON.stringify({
      line: line,
      quantity: quantity,
      sections: Array.from(sectionsToUpdate).join(","),
      sections_url: window.location.pathname,
    });

    fetch(`${FoxTheme.routes.cart_change_url}`, fetchConfig("json", { body }))
      .then((response) => {
        return response.text();
      })
      .then(async (responseText) => {
        const parsedResponseText = JSON.parse(responseText);

        resetLoading(this);

        // Even with errors, backend may have updated cart to max available
        // Update UI and cart count if we have sections
        if (parsedResponseText.sections && parsedResponseText.sections[this.sectionId]) {
          const newSectionHTML = new DOMParser().parseFromString(
            parsedResponseText.sections[this.sectionId],
            "text/html"
          );

          // Grab the new cart item count from a hidden element
          const newCartHiddenItemCount = newSectionHTML.querySelector('[ref="cartItemCount"]')?.textContent;
          const newCartItemCount = newCartHiddenItemCount ? parseInt(newCartHiddenItemCount, 10) : 0;

          this.dispatchEvent(
            new CartUpdateEvent({}, this.sectionId, {
              itemCount: newCartItemCount,
              source: "cart-items-component",
              sections: parsedResponseText.sections,
            })
          );

          morphSection(this.sectionId, parsedResponseText.sections[this.sectionId]);
        } else if (parsedResponseText.errors) {
          // No sections in error response - fetch cart.js for accurate count and quantity

          const cartSectionsData = {};
          let cartJson = null;
          const cartSectionsPromises = Array.from(sectionsToUpdate).map(async (sectionId) => {
            const sectionUrl = `${window.location.pathname.split("?")[0]}?section_id=${sectionId}`;

            const res = await fetch(sectionUrl);
            const html = await res.text();

            cartSectionsData[sectionId] = html;
          });

          const cartJsonPromises = fetch(FoxTheme.routes.cart)
            .then((res) => res.json())
            .then((data) => {
              cartJson = data;
            });

          await Promise.all([...cartSectionsPromises, cartJsonPromises]);

          cartJson["sections"] = cartSectionsData;

          this.dispatchEvent(
            new CartUpdateEvent(cartJson, "", {
              itemCount: cartJson.item_count || 0,
              sections: cartJson.sections,
            })
          );

          morphSection(this.sectionId, cartJson.sections[this.sectionId]);
        }

        /**
         * Show error message if exists (e.g. quantity exceeds available)
         * Call after morph section to avoid message disappear
         */
        if (parsedResponseText.errors) {
          this.#handleCartError(line, parsedResponseText);
        }
      })
      .catch((error) => {
        console.error(error);
      })
      .finally(() => {
        this.#enableCartItems();
        // cartPerformance.measureFromMarker(cartPerformaceUpdateMarker);
      });
  }

  /**
   * Handles the discount update.
   * @param {DiscountUpdateEvent} event - The event.
   */
  handleDiscountUpdate = (event) => {
    if (event?.detail?.sourceId === this.sectionId) return;
    this.#handleCartUpdate(event);
  };

  /**
   * Handles the cart error.
   * @param {number} line - The line.
   * @param {Object} parsedResponseText - The parsed response text.
   * @param {string} parsedResponseText.errors - The errors.
   */
  #handleCartError = (line, parsedResponseText) => {
    const cartItemError = this.refs[`cartItemError-${line}`];
    const cartItemErrorContainer = this.refs[`cartItemErrorContainer-${line}`];

    if (!(cartItemError instanceof HTMLElement)) throw new Error("Cart item error not found");
    if (!(cartItemErrorContainer instanceof HTMLElement)) throw new Error("Cart item error container not found");

    cartItemError.textContent = parsedResponseText.errors;
    cartItemErrorContainer.classList.remove("hidden");

    setTimeout(() => {
      cartItemErrorContainer.classList.add("hidden");
    }, this.#timeout);
  };

  #showLockedQuantityError = (line, quantity) => {
    const lineItemRow = this.refs.cartItemRows[line - 1];
    const maxQuantity = this.#getMaxQuantity(lineItemRow) || quantity;
    this.#handleCartError(line, {
      errors: `Only ${maxQuantity} of this item can be added to your cart.`,
    });
  };

  /**
   * Handles the cart update.
   *
   * @param {DiscountUpdateEvent | CartUpdateEvent | CartAddEvent} event
   */
  #handleCartUpdate = (event) => {
    if (event instanceof DiscountUpdateEvent) {
      if (event?.detail?.sourceId === this.sectionId) return;
      sectionRenderer.renderSection(this.sectionId, { cache: false });
      return;
    }

    if (event.target === this) return;

    const cartItemsHtml = event.detail.data.sections?.[this.sectionId];
    if (cartItemsHtml) {
      morphSection(this.sectionId, cartItemsHtml);
    } else {
      sectionRenderer.renderSection(this.sectionId, { cache: false });
    }
  };

  /**
   * Disables the cart items.
   */
  #disableCartItems() {
    this.classList.add("cart-items-disabled");
  }

  /**
   * Enables the cart items.
   */
  #enableCartItems() {
    this.classList.remove("cart-items-disabled");
  }

  #getLockedQuantity(lineItemRow) {
    if (!(lineItemRow instanceof HTMLElement)) return null;
    const value = Number(lineItemRow.dataset.lockedQuantity || "");
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  #getMaxQuantity(lineItemRow) {
    if (!(lineItemRow instanceof HTMLElement)) return null;
    const value = Number(lineItemRow.dataset.maxQuantity || "");
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  #resetLineQuantity(line, quantity) {
    const selector = this.refs.quantitySelectors?.[line - 1];
    if (!(selector instanceof HTMLElement)) return;

    selector.dataset.lockedQuantity = String(quantity);

    const input = selector.querySelector('input[ref="quantityInput"], .quantity-input');
    if (input instanceof HTMLInputElement) {
      input.value = String(quantity);
    }
  }

  /**
   * Gets the section id.
   * @returns {string} The section id.
   */
  get sectionId() {
    const { sectionId } = this.dataset;

    if (!sectionId) throw new Error("Section id missing");

    return sectionId;
  }
}

if (!customElements.get("cart-items-component")) {
  customElements.define("cart-items-component", CartItemsComponent);
}
