import { Component } from "@theme/component";
import { QuantitySelectorUpdateEvent } from "@theme/events";

/**
 * A custom element that allows the user to select a quantity.
 *
 * @typedef {Object} Refs
 * @property {HTMLInputElement} quantityInput
 *
 * @extends {Component<Refs>}
 */
class QuantitySelectorComponent extends Component {
  /** @type {boolean} */
  #hasValueChanged = false;

  connectedCallback() {
    super.connectedCallback();

    // Track when user actually types in the input
    this.refs.quantityInput.addEventListener("input", () => {
      this.#hasValueChanged = true;
    });

    this.#syncLockedQuantity();
  }
  /**
   * Handles the quantity increase event.
   * @param {Event} event - The event.
   */
  increaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    this.refs.quantityInput.stepUp();
    this.#hasValueChanged = true;
    this.#onQuantityChange();
  }

  /**
   * Handles the quantity decrease event.
   * @param {Event} event - The event.
   */
  decreaseQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    this.refs.quantityInput.stepDown();
    this.#hasValueChanged = true;
    this.#onQuantityChange();
  }

  /**
   * When our input gets focused, we want to fully select the value.
   * @param {FocusEvent} event
   */
  selectInputValue(event) {
    const { quantityInput } = this.refs;
    if (!(event.target instanceof HTMLInputElement) || document.activeElement !== quantityInput)
      return;

    // Use setTimeout to avoid interfering with focus management
    setTimeout(() => {
      quantityInput.select();
    }, 0);

    // Reset the change flag when focusing (user might just be navigating)
    this.#hasValueChanged = false;
  }

  /**
   * Handles the quantity set event.
   * @param {Event} event - The event.
   */
  setQuantity(event) {
    if (!(event.target instanceof HTMLElement)) return;

    event.preventDefault();
    if (event.target instanceof HTMLInputElement) {
      const oldValue = this.refs.quantityInput.value;
      const newValue = event.target.value;

      // Only trigger change if value actually changed or was changed by user interaction
      if (oldValue !== newValue || this.#hasValueChanged) {
        this.refs.quantityInput.value = newValue;
        this.#onQuantityChange();
      }

      // Reset the flag after processing
      this.#hasValueChanged = false;
    }
  }

  /**
   * Handles the quantity change event.
   */
  #onQuantityChange() {
    const { quantityInput } = this.refs;

    this.#checkQuantityRules();
    const newValue = parseInt(quantityInput.value);

    quantityInput.dispatchEvent(
      new QuantitySelectorUpdateEvent(newValue, Number(quantityInput.dataset.cartLine))
    );
  }

  /**
   * Checks the quantity rules are met
   */
  #checkQuantityRules = () => {
    const { quantityInput } = this.refs;
    const { min, max, value: newValue } = quantityInput;

    if (newValue < min && min) quantityInput.value = min;
    if (newValue > max && max) quantityInput.value = max;
  };

  #syncLockedQuantity() {
    const lockedQuantity = Number(this.dataset.lockedQuantity || 0);
    if (!lockedQuantity) return;

    const { quantityInput } = this.refs;
    const currentQuantity = Number(quantityInput.value || 0);
    quantityInput.value = String(lockedQuantity);

    if (quantityInput.dataset.cartLine && currentQuantity !== lockedQuantity) {
      window.setTimeout(() => {
        this.#onQuantityChange();
      }, 0);
    }
  }

  /**
   * Gets the quantity input.
   * @returns {HTMLInputElement} The quantity input.
   */
  get quantityInput() {
    if (!this.refs.quantityInput) {
      throw new Error(
        'Missing <input ref="quantityInput" /> inside <quantity-selector-component />'
      );
    }

    return this.refs.quantityInput;
  }
}

if (!customElements.get("quantity-selector-component")) {
  customElements.define("quantity-selector-component", QuantitySelectorComponent);
}
