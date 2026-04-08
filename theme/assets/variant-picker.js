import { Component } from "@theme/component";
import { VariantSelectedEvent, VariantUpdateEvent } from "@theme/events";
import { morph } from "@theme/morph";
import { requestIdleCallback, requestYieldCallback } from "@theme/utilities";

/**
 * Global cache shared across all variant picker instances
 * This allows cache to persist when switching between products in combined listings
 *
 * HYBRID APPROACH:
 * - Cache preloaded variants for instant switching (no network delay)
 * - Fetch lightweight JSON for uncached variants (faster than full HTML)
 * - Fallback to full HTML when variant ID not available
 */
const globalVariantsCache = new Map();
const globalMediaCache = new Map();

/**
 * A custom element that manages a variant picker.
 *
 * @template {import('@theme/component').Refs} [Refs = {}]
 *
 * @extends Component<Refs>
 */
export default class VariantPicker extends Component {
  /** @type {string | undefined} */
  #pendingRequestUrl;

  /** @type {AbortController | undefined} */
  #abortController;

  /** @type {string | undefined} */
  #lastProductId;

  connectedCallback() {
    super.connectedCallback();

    // Store initial product ID
    this.#lastProductId = this.dataset.productId;

    // HYBRID: Load and cache preloaded variants for instant switching
    this.#loadVariantsCache();

    this.addEventListener("change", this.variantChanged.bind(this));
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    // Abort any pending fetch requests to prevent memory leaks
    this.#abortController?.abort();
    this.removeEventListener("change", this.variantChanged.bind(this));
  }

  updatedCallback() {
    super.updatedCallback?.();

    // When product changes (combine listing), re-load cache for new product
    const currentProductId = this.dataset.productId;
    if (currentProductId !== this.#lastProductId) {
      this.#lastProductId = currentProductId;
      // HYBRID: Re-load cache for new product
      this.#loadVariantsCache();
    }
  }

  /**
   * Handles the variant change event.
   * @param {Event} event - The variant change event.
   */
  variantChanged(event) {
    if (!(event.target instanceof HTMLElement)) return;

    const selectedOption =
      event.target instanceof HTMLSelectElement ? event.target.options[event.target.selectedIndex] : event.target;

    if (!selectedOption) return;

    this.updateSelectedOption(event.target);
    this.dispatchEvent(
      new VariantSelectedEvent({
        id: selectedOption.dataset.optionValueId ?? "",
      })
    );

    const isOnProductPage =
      this.dataset.templateProductMatch === "true" &&
      !event.target.closest("product-card") &&
      !event.target.closest("quick-add-dialog");

    // Morph the entire main content for combined listings child products, because changing the product
    // might also change other sections depending on recommendations, metafields, etc.
    const currentUrl = this.dataset.productUrl?.split("?")[0];
    const newUrl = selectedOption.dataset.connectedProductUrl;
    const loadsNewProduct = isOnProductPage && !!newUrl && newUrl !== currentUrl;

    // HYBRID APPROACH: Cache first, then JSON fetch, then full HTML fallback
    const variantId = selectedOption.dataset.variantId;
    const cachedVariant = this.#getCachedVariant();

    if (cachedVariant) {
      // ⚡ CACHE HIT: Instant update with no network delay
      this.#updateCriticalUI(cachedVariant, true);

      // Detect if product changed (for combine listings in quick-add drawer, product cards, etc.)
      const newProductUrl = selectedOption.dataset.connectedProductUrl;
      const currentProductUrl = this.dataset.productUrl?.split("?")[0];
      const hasProductChanged = newProductUrl && currentProductUrl !== newProductUrl;

      // Dispatch event immediately for other components
      if (this.selectedOptionId) {
        this.dispatchEvent(
          new VariantUpdateEvent(cachedVariant, this.selectedOptionId, {
            html: null, // No HTML yet
            productId: this.dataset.productId ?? "",
            newProduct: hasProductChanged ? { id: null, url: newProductUrl } : undefined,
            fromCache: true, // Flag to indicate this is from cache
          })
        );
      }

      // Still fetch HTML in background for morph (custom elements, etc.)
      requestIdleCallback(() => {
        this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), loadsNewProduct, true);
      });
    } else if (variantId) {
      // CACHE MISS: Fetch lightweight JSON (faster than full HTML)
      // Detect if product changed (for combine listings in quick-add drawer, product cards, etc.)
      const newProductUrl = selectedOption.dataset.connectedProductUrl;
      const currentProductUrl = this.dataset.productUrl?.split("?")[0];
      const hasProductChanged = newProductUrl && currentProductUrl !== newProductUrl;

      this.#fetchVariantJson(variantId)
        .then((variantData) => {
          if (variantData) {
            // Update UI with fetched JSON data
            this.#updateCriticalUI(variantData, true);

            // Dispatch event immediately for other components
            if (this.selectedOptionId) {
              this.dispatchEvent(
                new VariantUpdateEvent(variantData, this.selectedOptionId, {
                  html: null, // No HTML yet
                  productId: this.dataset.productId ?? "",
                  newProduct: hasProductChanged ? { id: null, url: newProductUrl } : undefined,
                  fromCache: true, // Treated as cache hit for UI logic
                })
              );
            }
          }
        })
        .catch((error) => {
          console.warn("Failed to fetch variant JSON:", error);
        });

      // Fetch full HTML in background for morph (custom elements, etc.)
      requestIdleCallback(() => {
        this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), loadsNewProduct, true);
      });
    } else {
      // FALLBACK: No variant ID - fetch full HTML as fallback
      this.fetchUpdatedSection(this.buildRequestUrl(selectedOption), loadsNewProduct, false);
    }

    const url = new URL(window.location.href);

    if (isOnProductPage) {
      if (variantId) {
        url.searchParams.set("variant", variantId);
      } else {
        url.searchParams.delete("variant");
      }
    }

    // Change the path if the option is connected to another product via combined listing.
    if (loadsNewProduct) {
      url.pathname = newUrl;
    }

    if (url.href !== window.location.href) {
      requestYieldCallback(() => {
        history.replaceState({}, "", url.toString());
      });
    }
  }

  /**
   * Updates the selected option.
   * @param {string | Element} target - The target element.
   */
  updateSelectedOption(target) {
    if (typeof target === "string") {
      const targetElement = this.querySelector(`[data-option-value-id="${target}"]`);

      if (!targetElement) throw new Error("Target element not found");

      target = targetElement;
    }

    if (target instanceof HTMLInputElement) {
      target.checked = true;
    }

    if (target instanceof HTMLSelectElement) {
      const newValue = target.value;
      const newSelectedOption = Array.from(target.options).find((option) => option.value === newValue);

      if (!newSelectedOption) throw new Error("Option not found");

      for (const option of target.options) {
        option.removeAttribute("selected");
      }

      newSelectedOption.setAttribute("selected", "selected");
    }
  }

  /**
   * Builds the request URL.
   * @param {HTMLElement} selectedOption - The selected option.
   * @param {string | null} [source] - The source.
   * @param {string[]} [sourceSelectedOptionsValues] - The source selected options values.
   * @returns {string} The request URL.
   */
  buildRequestUrl(selectedOption, source = null, sourceSelectedOptionsValues = []) {
    // this productUrl and pendingRequestUrl will be useful for the support of combined listing. It is used when a user changes variant quickly and those products are using separate URLs (combined listing).
    // We create a new URL and abort the previous fetch request if it's still pending.
    let productUrl = selectedOption.dataset.connectedProductUrl || this.#pendingRequestUrl || this.dataset.productUrl;
    this.#pendingRequestUrl = productUrl;
    const params = [];

    if (this.selectedOptionsValues.length && !source) {
      params.push(`option_values=${this.selectedOptionsValues.join(",")}`);
    } else if (source === "product-card") {
      if (this.selectedOptionsValues.length) {
        params.push(`option_values=${sourceSelectedOptionsValues.join(",")}`);
      } else {
        params.push(`option_values=${selectedOption.dataset.optionValueId}`);
      }
    }

    // If variant-picker is a child of quick-add-component or swatches-variant-picker-component, we need to append section_id=section-rendering-product-card to the URL
    if (this.closest("quick-add-dialog") || this.closest("swatches-variant-picker")) {
      let sectionId = this.quickAddDrawerId;
      if (this.closest("swatches-variant-picker")) {
        sectionId = "section-rendering-product-card";
      }
      if (productUrl?.includes("?")) {
        productUrl = productUrl.split("?")[0];
      }
      return `${productUrl}?section_id=${sectionId}&${params.join("&")}`;
    }
    return `${productUrl}?${params.join("&")}`;
  }

  /**
   * Fetches the updated section.
   * @param {string} requestUrl - The request URL.
   * @param {boolean} shouldMorphMain - If the entire main content should be morphed. By default, only the variant picker is morphed.
   * @param {boolean} isBackgroundSync - If this is a background sync after cache hit (don't dispatch events again)
   */
  fetchUpdatedSection(requestUrl, shouldMorphMain = false, isBackgroundSync = false) {
    // We use this to abort the previous fetch request if it's still pending.
    this.#abortController?.abort();
    this.#abortController = new AbortController();

    fetch(requestUrl, { signal: this.#abortController.signal })
      .then((response) => response.text())
      .then((responseText) => {
        this.#pendingRequestUrl = undefined;

        const html = new DOMParser().parseFromString(responseText, "text/html");
        const variantData = this.#extractVariantData(html);

        if (variantData) {
          if (!isBackgroundSync) {
            // Update critical UI immediately (only if not from cache)
            // Note: Media is NOT updated here - will be replaced via HTML morph
            this.#updateCriticalUI(variantData, false);
          }
        } else {
          console.warn("No variant data extracted - dispatching without optimistic update");
        }

        // Morph HTML (will happen after critical UI update)
        if (shouldMorphMain) {
          this.updateMain(html);
        } else {
          const newProduct = this.updateVariantPicker(html);

          // Always dispatch event with HTML (even without variantData or for background sync)
          // Components need HTML to morph elements (button text, inventory, badge)
          if (this.selectedOptionId) {
            this.dispatchEvent(
              new VariantUpdateEvent(variantData || null, this.selectedOptionId, {
                html,
                productId: this.dataset.productId ?? "",
                newProduct,
                fromCache: false, // Explicitly set to false for HTML fetch
                isBackgroundSync, // Flag to indicate this is background sync
              })
            );
          }
        }
      })
      .catch((error) => {
        if (error.name === "AbortError") {
          console.warn("Fetch aborted by user");
        } else {
          console.error(error);
        }
      });
  }

  /**
   * Fetch lightweight JSON data for a specific variant
   * This is faster than fetching full HTML (smaller payload)
   *
   * @param {string} variantId - The variant ID to fetch
   * @returns {Promise<Object|null>} The variant data or null
   */
  async #fetchVariantJson(variantId) {
    if (!variantId) return null;

    try {
      // Build URL to fetch variant-data section
      const productUrl = this.dataset.productUrl || window.location.pathname;
      const url = new URL(productUrl, window.location.origin);
      url.searchParams.set("sections", "variant-data");
      url.searchParams.set("variant", variantId);

      // Abort previous JSON fetch if still pending (rapid clicking)
      this.#abortController?.abort();
      this.#abortController = new AbortController();

      // Fetch section (Shopify wraps in HTML, not pure JSON)
      const response = await fetch(url.toString(), { signal: this.#abortController.signal });

      if (!response.ok) {
        console.warn(`Variant JSON fetch failed: ${response.status}`);
        return null;
      }

      // Section Rendering API returns: { "variant-data": "HTML string" }
      const data = await response.json();
      const htmlString = data["variant-data"];

      if (!htmlString) {
        console.warn("No variant-data in response");
        return null;
      }

      // Parse HTML to extract JSON from section content
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = htmlString;
      const sectionDiv = tempDiv.querySelector("#shopify-section-variant-data");

      if (!sectionDiv?.textContent) {
        console.warn("Could not extract JSON from section");
        return null;
      }

      // Parse the JSON from section content
      const variantData = JSON.parse(sectionDiv.textContent);

      return variantData;
    } catch (error) {
      // Silent abort errors (user clicked another variant)
      if (error.name === "AbortError") return null;

      console.error("Error fetching variant JSON:", error);
      return null;
    }
  }

  /**
   * Extract variant data from HTML response
   * @param {Document} html - The parsed HTML document
   * @returns {Object | null} The variant data or null if not found
   */
  #extractVariantData(html) {
    const scriptTag = html.querySelector('variant-picker script[type="application/json"]');

    if (!scriptTag?.textContent) {
      console.warn("No variant data found in response");
      return null;
    }

    try {
      return JSON.parse(scriptTag.textContent);
    } catch (e) {
      console.error("Failed to parse variant data:", e);
      return null;
    }
  }

  /**
   * Update critical UI elements immediately with variant data
   * @param {Object} variantData - The variant object from JSON
   * @param {boolean} isFromCache - Whether this update is from cache (true) or from server (false)
   */
  #updateCriticalUI(variantData, isFromCache = false) {
    // 1. Update price immediately
    this.#updatePriceOptimistic(variantData);

    // 2. Update media gallery (only for cache, server fetch will replace entire gallery)
    if (isFromCache) {
      this.#updateMediaOptimistic(variantData);
    }

    // 3. Update button state
    this.#updateButtonStateOptimistic(variantData);
  }

  /**
   * Update price optimistically from variant data
   * @param {Object} variant - The variant object
   */
  #updatePriceOptimistic(variant) {
    // IMPORTANT: Scope to product-card first to avoid affecting other cards in the same section
    const scope = this.closest("product-card") || this.closest(".shopify-section, dialog");
    const priceComponent = scope?.querySelector("product-price");

    if (!priceComponent) return;

    // Dispatch optimistic update event
    priceComponent.dispatchEvent(
      new CustomEvent("price:update-optimistic", {
        detail: { variant },
        bubbles: false,
      })
    );
  }

  /**
   * Update media gallery optimistically
   * @param {Object} variant - The variant object
   */
  #updateMediaOptimistic(variant) {
    if (!variant.featured_media) return;

    // IMPORTANT: Scope to product-card first to avoid affecting other cards in the same section
    const scope = this.closest("product-card") || this.closest(".shopify-section, dialog");
    const mediaGallery = scope?.querySelector("media-gallery");

    if (!mediaGallery) return;

    // Dispatch optimistic media switch event
    mediaGallery.dispatchEvent(
      new CustomEvent("media:switch-optimistic", {
        detail: { variant },
        bubbles: false,
      })
    );
  }

  /**
   * Update button state optimistically
   * @param {Object} variant - The variant object
   */
  #updateButtonStateOptimistic(variant) {
    // IMPORTANT: Scope to product-card first to avoid affecting other cards in the same section
    const scope = this.closest("product-card") || this.closest(".shopify-section, dialog");
    const productForm = scope?.querySelector("product-form-component");

    if (!productForm) return;

    const addToCartButton = productForm.querySelector('[ref="addToCartButton"]');

    if (!addToCartButton) return;

    // Update button state based on availability
    addToCartButton.disabled = !variant.available;
  }

  /**
   * @typedef {Object} NewProduct
   * @property {string} id
   * @property {string} url
   */

  /**
   * Re-renders the variant picker.
   * @param {Document} newHtml - The new HTML.
   * @returns {NewProduct | undefined} Information about the new product if it has changed, otherwise undefined.
   */
  updateVariantPicker(newHtml) {
    if (!newHtml) return;

    /** @type {NewProduct | undefined} */
    let newProduct;

    const newVariantPickerSource = newHtml.querySelector(this.tagName.toLowerCase());

    if (!newVariantPickerSource) {
      throw new Error("No new variant picker source found");
    }

    // For combined listings, the product might have changed, so update the related data attribute.
    if (newVariantPickerSource instanceof HTMLElement) {
      const newProductId = newVariantPickerSource.dataset.productId;
      const newProductUrl = newVariantPickerSource.dataset.productUrl;

      if (newProductId && newProductUrl && this.dataset.productId !== newProductId) {
        newProduct = { id: newProductId, url: newProductUrl };
      }

      this.dataset.productId = newProductId;
      this.dataset.productUrl = newProductUrl;
    }

    morph(this, newVariantPickerSource);

    return newProduct;
  }

  /**
   * Re-renders the entire main content.
   * @param {Document} newHtml - The new HTML.
   */
  updateMain(newHtml) {
    const main = document.querySelector("main");
    const newMain = newHtml.querySelector("main");

    if (!main || !newMain) {
      throw new Error("No new main source found");
    }

    morph(main, newMain);
  }

  /**
   * Gets the selected option.
   * @returns {HTMLInputElement | HTMLOptionElement | undefined} The selected option.
   */
  get selectedOption() {
    const selectedOption = this.querySelector("select option[selected], .variant-option--fieldset input:checked");

    if (!(selectedOption instanceof HTMLInputElement || selectedOption instanceof HTMLOptionElement)) {
      return undefined;
    }

    return selectedOption;
  }

  /**
   * Gets the selected option ID.
   * @returns {string | undefined} The selected option ID.
   */
  get selectedOptionId() {
    const { selectedOption } = this;
    if (!selectedOption) return undefined;
    const { optionValueId } = selectedOption.dataset;

    if (!optionValueId) {
      throw new Error("No option value ID found");
    }

    return optionValueId;
  }

  /**
   * Gets the selected options values.
   * @returns {string[]} The selected options values.
   */
  get selectedOptionsValues() {
    /** @type HTMLElement[] */
    const selectedOptions = Array.from(
      this.querySelectorAll("select option[selected], .variant-option--fieldset input:checked")
    );

    return selectedOptions.map((option) => {
      const { optionValueId } = option.dataset;

      if (!optionValueId) throw new Error("No option value ID found");

      return optionValueId;
    });
  }

  get quickAddDrawerId() {
    const quickAddDrawer = document.getElementById("quick-add-drawer");
    return quickAddDrawer?.dataset.sectionId;
  }

  /**
   * HYBRID APPROACH: Load and cache preloaded variants for instant switching
   * Variants are preloaded in the initial HTML for zero-latency updates
   */
  #loadVariantsCache() {
    const cacheScript = this.querySelector("script[data-variants-cache]");

    if (!cacheScript?.textContent) {
      console.warn("⚠️ No variants cache found - will fetch from server");
      return;
    }

    const productId = this.dataset.productId;
    if (!productId) {
      console.warn("No productId found - cannot cache variants");
      return;
    }

    try {
      const data = JSON.parse(cacheScript.textContent);

      // Cache variants indexed by productId + option values for fast lookup
      if (data.variants && Array.isArray(data.variants)) {
        data.variants.forEach((variant) => {
          // Create cache key from productId + option values
          const key = this.#buildCacheKey(variant);
          globalVariantsCache.set(key, variant);
        });
      }

      // Cache media for quick reference (with productId prefix)
      if (data.media && Array.isArray(data.media)) {
        data.media.forEach((media) => {
          const mediaKey = `${productId}|${media.id}`;
          globalMediaCache.set(mediaKey, media);
        });
      }
    } catch (e) {
      console.error("Failed to load variants cache:", e);
    }
  }

  #buildCacheKey(variant) {
    const productId = this.dataset.productId;
    if (!productId) {
      console.warn("No productId for cache key");
      return "";
    }

    // Build key from productId + available options (option1, option2, option3)
    const parts = [productId];
    if (variant.option1) parts.push(variant.option1);
    if (variant.option2) parts.push(variant.option2);
    if (variant.option3) parts.push(variant.option3);
    return parts.join("|");
  }

  #getCachedVariant() {
    const productId = this.dataset.productId;
    if (!productId) {
      console.warn("No productId - cannot get cached variant");
      return null;
    }

    // Get currently selected option values (scoped to this variant-picker instance)
    const selectedOptions = Array.from(
      this.querySelectorAll("select option[selected], .variant-option--fieldset input:checked")
    );

    if (selectedOptions.length === 0) return null;

    // Build cache key from productId + selected values
    const optionValues = selectedOptions.map((el) => el.value).join("|");
    const key = `${productId}|${optionValues}`;

    return globalVariantsCache.get(key) || null;
  }
}

if (!customElements.get("variant-picker")) {
  customElements.define("variant-picker", VariantPicker);
}
