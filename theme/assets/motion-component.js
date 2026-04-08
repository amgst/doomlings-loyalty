import { Component } from "@theme/component";
import { animate, inView } from "@theme/animation";
import { prefersReducedMotion, coordinatedInView } from "@theme/utilities";
import { motionCoordinator } from "@theme/motion-coordinator";

/**
 * <motion-component>
 * Declarative animations powered by Motion library using data attributes:
 * - data-motion: "fade-in" | "fade-up" | "slide-in-left" | "slide-in-right" | "zoom-in" | "zoom-out"
 * - data-motion-delay: number (milliseconds)
 * - data-instantly: flag to bypass waiting media
 * - data-motion-hold: flag to hold/prestage only
 */
export class MotionComponent extends Component {
  #inViewStop = null;

  connectedCallback() {
    super.connectedCallback();
    if (prefersReducedMotion() || this.#isDisabled()) return;
    // this.#prestage();
    this.#bindInView();
  }

  updatedCallback() {
    super.updatedCallback();
    if (prefersReducedMotion() || this.#isDisabled()) return;
    // Reset animation state to allow re-animation after morph
    this.removeAttribute("data-initialized");
    this.#unbindInView();
    this.#prestage();
    this.#bindInView(true);
  }

  disconnectedCallback() {
    this.#unbindInView();
    super.disconnectedCallback();
  }

  get type() {
    return this.dataset.motion || "fade-up";
  }

  get delay() {
    return this.hasAttribute("data-motion-delay") ? parseInt(this.getAttribute("data-motion-delay")) / 1000 : 0;
  }

  get isHold() {
    return this.hasAttribute("data-motion-hold");
  }

  get isInstant() {
    return this.hasAttribute("data-instantly");
  }

  get media() {
    return Array.from(this.querySelectorAll("img, iframe, svg"));
  }

  #prestage() {
    if (this.isHold) return;

    switch (this.type) {
      case "fade-in":
        animate(this, { opacity: 0 }, { duration: 0 });
        break;

      case "fade-up":
        animate(this, { transform: "translateY(2.5rem)", opacity: 0 }, { duration: 0 });
        break;

      case "slide-in-left":
        animate(this, { transform: "translateX(-2.5rem)", opacity: 0 }, { duration: 0 });
        break;

      case "slide-in-right":
        animate(this, { transform: "translateX(2.5rem)", opacity: 0 }, { duration: 0 });
        break;

      case "zoom-in":
        animate(this, { transform: "scale(0.8)" }, { duration: 0 });
        break;

      case "zoom-out":
        animate(this, { transform: "scale(1.15)" }, { duration: 0 });
        break;
    }
  }

  async #enter() {
    if (this.isHold) return;

    const easing = [0.16, 1, 0.3, 1]; // cubic-bezier format for Motion

    switch (this.type) {
      case "fade-in":
        await animate(this, { opacity: 1 }, { duration: 1.5, delay: this.delay, easing }).finished;
        break;

      case "fade-up":
        await animate(this, { transform: "translateY(0)", opacity: 1 }, { duration: 1.5, delay: this.delay, easing })
          .finished;
        break;

      case "slide-in-left":
        await animate(this, { transform: "translateX(0)", opacity: 1 }, { duration: 1.5, delay: this.delay, easing })
          .finished;
        break;

      case "slide-in-right":
        await animate(this, { transform: "translateX(0)", opacity: 1 }, { duration: 1.5, delay: this.delay, easing })
          .finished;
        break;

      case "zoom-in":
        await animate(this, { transform: "scale(1)" }, { duration: 1.3, delay: this.delay, easing }).finished;
        break;

      case "zoom-out":
        await animate(this, { transform: "scale(1)" }, { duration: 1.3, delay: this.delay, easing }).finished;
        break;
    }

    this.setAttribute("data-initialized", "true");
    this.style.willChange = "auto";
  }

  #bindInView(forceImmediate = false) {
    // Cleanup previous observer if exists
    this.#unbindInView();

    if (forceImmediate) {
      // Bypass coordinator for immediate playback (e.g., slider replay)
      // Check if in viewport and trigger immediately
      const rect = this.getBoundingClientRect();
      const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;

      if (isInViewport) {
        // Trigger animation immediately
        (async () => {
          if (!this.isInstant && this.media.length) {
            await this.#waitForMediaSmart(this.media);
          }
          this.#enter();
        })();
        return;
      }
    }

    // Use coordinatedInView for better performance (1 shared observer vs N observers)
    // Drop-in replacement for inView() - same API, better performance
    this.#inViewStop = coordinatedInView(this, async () => {
      if (!this.isInstant && this.media.length) {
        // Smart media waiting: event-based for ResponsiveImage, fallback for others
        await this.#waitForMediaSmart(this.media);
      }
      this.#enter();
    });
  }

  /**
   * Smart waiting for media elements
   * Uses event-based approach for ResponsiveImage, fallback to polling for others
   * @param {Element[]} mediaElements
   * @returns {Promise<void>}
   */
  async #waitForMediaSmart(mediaElements) {
    const promises = mediaElements.map((el) => {
      // Handle ResponsiveImage with event-based approach
      if (el instanceof HTMLImageElement && el.getAttribute("is") === "responsive-image") {
        // Check if already ready
        if (el.isReady || (el.complete && el.naturalWidth > 0)) {
          return Promise.resolve();
        }

        // Use ready promise if available (preferred)
        if (el.ready instanceof Promise) {
          return el.ready;
        }

        // Fallback: listen for image:ready event
        return new Promise((resolve) => {
          const timeout = setTimeout(resolve, 5000); // 5s max wait

          el.addEventListener(
            "image:ready",
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true }
          );

          // Also listen for native load event as fallback
          if (!el.complete) {
            el.addEventListener(
              "load",
              () => {
                clearTimeout(timeout);
                resolve();
              },
              { once: true }
            );
          }
        });
      }

      // Standard handling for other images
      if (el instanceof HTMLImageElement) {
        if (el.complete && el.naturalWidth > 0) {
          return Promise.resolve();
        }
        return new Promise((resolve) => {
          el.addEventListener("load", resolve, { once: true });
          el.addEventListener("error", resolve, { once: true });
        });
      }

      // Best-effort for other media types
      return Promise.resolve();
    });

    await Promise.allSettled(promises);
  }

  #unbindInView() {
    if (this.#inViewStop) {
      this.#inViewStop();
      this.#inViewStop = null;
    }
  }

  replay() {
    if (prefersReducedMotion() || this.#isDisabled()) return;

    // Cleanup existing registration
    this.#unbindInView();

    // Clear from coordinator's completed set to allow re-animation
    motionCoordinator.clearCompleted(this);

    // Reset animation state
    this.removeAttribute("data-motion-hold");
    this.removeAttribute("data-initialized");

    // Prestage animation
    this.#prestage();

    // Bind with forceImmediate flag to bypass coordinator limits
    // This ensures slider animations always replay
    this.#bindInView(true);
  }

  #isDisabled() {
    return this.hasAttribute("data-motion-off") || this.closest("[data-motion-disabled]") !== null;
  }
}

customElements.define("motion-component", MotionComponent);
