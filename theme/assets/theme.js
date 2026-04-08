import { Component } from "@theme/component";
import {
  isMobileBreakpoint,
  mediaBreakpointMobile,
  mediaBreakpointTablet,
  getLenis,
  fetchConfig,
  mediaQueryMobile,
  debounce,
  throttle,
  prefersReducedMotion,
  isTouch,
  mediaHoverFine,
  waitForEvent,
  removeScrollLockClass,
  onDocumentReady,
  getFocusableElements,
} from "@theme/utilities";
import { inView, animate, scroll } from "@theme/animation";
import { ResizeNotifier } from "@theme/critical";
import { CarouselComponent } from "@theme/carousel";
import { AccordionComponent } from "@theme/modules";
import { morph } from "@theme/morph";
import { ThemeEvents, VariantUpdateEvent, CartGroupedSections, CartUpdateEvent } from "@theme/events";

class BasicHeader extends HTMLElement {
  constructor() {
    super();
  }

  get headerSection() {
    return document.querySelector(".header-section");
  }

  get enableTransparent() {
    return this.dataset.enableTransparent === "true";
  }

  connectedCallback() {
    this.#init();

    new ResizeNotifier(this.#setHeight.bind(this)).observe(this);

    if (Shopify.designMode) {
      const section = this.closest(".shopify-section");
      section.addEventListener("shopify:section:load", this.#init.bind(this));
      section.addEventListener("shopify:section:unload", this.#init.bind(this));
      section.addEventListener("shopify:section:reorder", this.#init.bind(this));
    }
  }

  #init() {
    this.#setHeight();

    if (this.enableTransparent) {
      this.headerSection.classList.add("header-transparent");
    }
  }

  #setHeight() {
    // Defer ALL layout reads to next frame to avoid force reflow on page load
    requestAnimationFrame(() => {
      // Batch reads and writes together in the same frame
      const offsetHeight = Math.round(this.offsetHeight);
      document.documentElement.style.setProperty("--header-height", `${offsetHeight}px`);
    });
  }
}
customElements.define("basic-header", BasicHeader, { extends: "header" });

class StickyHeader extends BasicHeader {
  // Private fields for cleanup
  #boundHandleScroll = null;
  #resizeObserver = null;

  constructor() {
    super();

    this.classes = {
      pinned: "header-pinned",
      headerScrolled: "header-scrolled",
      headerSticky: "header-sticky",
    };

    this.currentScrollTop = 0;
    this.scrollThreshold = 200;
    this.scrollDirection = "none";
    this.scrollDistance = 0;
    this.lenis = null; // Lenis instance for smooth scrolling
    this.hasScrolledPastThreshold = false; // Track if user has scrolled past threshold
  }

  get isAlwaysSticky() {
    return this.dataset.stickyType === "always";
  }

  connectedCallback() {
    super.connectedCallback();

    this.#cacheInitialHeaderPosition();
    this.#initStickyHeader();
    this.#checkInitialScrollState();

    // Re-cache header position on resize (header height might change)
    if (!this.#resizeObserver) {
      this.#resizeObserver = new ResizeObserver(() => {
        this.#cacheInitialHeaderPosition();
      });
      this.#resizeObserver.observe(this.headerSection);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();

    if (this.#boundHandleScroll) {
      if (this.lenis) {
        // Remove Lenis scroll listener
        this.lenis.off("scroll", this.#boundHandleScroll);
      } else {
        // Remove native scroll listener
        window.removeEventListener("scroll", this.#boundHandleScroll);
      }
      this.#boundHandleScroll = null;
    }

    if (this.#resizeObserver) {
      this.#resizeObserver.disconnect();
      this.#resizeObserver = null;
    }
  }

  #cacheInitialHeaderPosition() {
    // Defer layout measurements to next frame to avoid force reflow on page load
    requestAnimationFrame(() => {
      const headerElement = this.headerSection?.querySelector(".header");
      const headerBounds = headerElement?.getBoundingClientRect() || this.headerSection.getBoundingClientRect();
      // Use Lenis scroll position if available, otherwise fallback to native scroll
      const scrollY = this.lenis ? this.lenis.scroll : window.scrollY;

      this.initialHeaderTop = headerBounds.top + scrollY;
      this.initialHeaderHeight = headerBounds.height;

      // Calculate scroll threshold: if header has offset from top (e.g., top: 3rem),
      // stick when scroll reaches that offset. Otherwise, stick when scroll passes header bottom.
      const headerOffsetFromTop = headerBounds.top;

      if (headerOffsetFromTop > 0) {
        this.stickThreshold = headerOffsetFromTop;
      } else {
        this.stickThreshold = this.initialHeaderTop + this.initialHeaderHeight;
      }

      // Ensure stickThreshold is valid
      if (this.stickThreshold <= 0 || !this.initialHeaderHeight) {
        this.stickThreshold = Math.max(this.initialHeaderHeight || 0, 1);
      }
    });
  }

  #initStickyHeader() {
    this.headerSection.classList.add(this.classes.headerSticky);
    this.headerSection.dataset.stickyType = this.dataset.stickyType;
    this.#boundHandleScroll = this.#handleScroll.bind(this);

    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    if (this.lenis) {
      // Listen to Lenis scroll events (shared instance with other sections)
      this.lenis.on("scroll", this.#boundHandleScroll);
    } else {
      // Fallback to native scroll if Lenis not available yet
      window.addEventListener("scroll", this.#boundHandleScroll, { passive: true });
    }
  }

  #checkInitialScrollState() {
    requestAnimationFrame(() => {
      // Use Lenis scroll position if available, otherwise fallback to native scroll
      const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;

      if (!this.stickThreshold || this.stickThreshold <= 0) {
        this.#cacheInitialHeaderPosition();
      }

      const shouldStick = scrollTop >= this.stickThreshold;

      if (shouldStick) {
        this.hasScrolledPastThreshold = true;
        this.headerSection.classList.add(this.classes.headerScrolled);
        document.body.classList.add(this.classes.pinned);
      } else {
        this.hasScrolledPastThreshold = false;
        this.headerSection.classList.remove(this.classes.headerScrolled);
        document.body.classList.remove(this.classes.pinned);
      }

      this.currentScrollTop = scrollTop;
    });
  }

  #handleScroll() {
    // Try to get Lenis again if not available (in case it loaded after init)
    if (!this.lenis) {
      const retryLenis = getLenis();
      if (retryLenis) {
        this.lenis = retryLenis;
        window.removeEventListener("scroll", this.#boundHandleScroll);
        this.lenis.on("scroll", this.#boundHandleScroll);
      }
    }

    // Use Lenis scroll position if available, otherwise fallback to native scroll
    const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;

    if (!this.stickThreshold || this.stickThreshold <= 0) {
      this.#cacheInitialHeaderPosition();
    }

    const shouldStick = scrollTop >= this.stickThreshold;

    // Move layout read into rAF to avoid force reflow in scroll handler
    requestAnimationFrame(() => {
      const currentBounds = this.headerSection.getBoundingClientRect();
      const headerBoundsBottom = this.initialHeaderTop + currentBounds.height;

      this.#updateScrollMetrics(scrollTop);

      // For always sticky, preserve header-scrolled if user has scrolled past threshold before
      // This prevents removing the class when mega menu opens and causes layout shift
      if (shouldStick) {
        this.#handleScrolledPastHeader(scrollTop, headerBoundsBottom);
      } else if (this.isAlwaysSticky && this.hasScrolledPastThreshold) {
        // Keep header-scrolled class even if shouldStick is false due to layout shift
        // Only remove when scrollTop is actually at the top
        // Use threshold < 1 to account for Lenis floating point precision
        if (scrollTop < 1) {
          this.#handleScrolledBeforeHeader();
        }
      } else {
        this.#handleScrolledBeforeHeader();
      }

      this.currentScrollTop = scrollTop;
    });
  }

  #updateScrollMetrics(scrollTop) {
    const newDirection = scrollTop > this.currentScrollTop ? "down" : "up";

    if (newDirection !== this.scrollDirection) {
      this.scrollDistance = 0;
      this.scrollDirection = newDirection;
    } else {
      this.scrollDistance += Math.abs(scrollTop - this.currentScrollTop);
    }
  }

  #handleScrolledPastHeader(scrollTop, headerBoundsBottom) {
    this.hasScrolledPastThreshold = true;
    this.headerSection.classList.add(this.classes.headerScrolled);

    if (this.isAlwaysSticky) {
      document.body.classList.add(this.classes.pinned);
    } else {
      const isScrollingUp = this.scrollDirection === "up";
      const isNearHeader = scrollTop < headerBoundsBottom + 100;
      const hasScrolledEnough = this.scrollDistance >= this.scrollThreshold;

      if (isScrollingUp || isNearHeader) {
        document.body.classList.add(this.classes.pinned);
      } else if (hasScrolledEnough) {
        document.body.classList.remove(this.classes.pinned);
      }
    }
  }

  #handleScrolledBeforeHeader() {
    // For always sticky, only remove header-scrolled if user actually scrolled back to top
    // This prevents removing the class when mega menu opens and causes layout shift
    if (this.isAlwaysSticky && this.hasScrolledPastThreshold) {
      // Keep header-scrolled class if user has scrolled past threshold before
      // Only remove it when scrollTop is actually at the top
      // Use threshold < 1 to account for Lenis floating point precision
      const scrollTop = this.lenis ? this.lenis.scroll : window.scrollY;
      if (scrollTop < 1) {
        this.hasScrolledPastThreshold = false;
        this.headerSection.classList.remove(this.classes.headerScrolled);
        document.body.classList.remove(this.classes.pinned);
      }
    } else {
      // For "on-scroll-up" type, always remove classes when scrolled before header
      this.hasScrolledPastThreshold = false;
      this.headerSection.classList.remove(this.classes.headerScrolled);
      document.body.classList.remove(this.classes.pinned);
    }
  }
}
customElements.define("sticky-header", StickyHeader, { extends: "header" });

const lockDropdownCount = new WeakMap();
// Animation timing constants
const ANIMATION_TIMING = {
  hoverEnterDelay: 100,
  hoverLeaveDelay: 150,
  contentOpenDelay: 100,
};

class DetailsDropdown extends HTMLDetailsElement {
  constructor() {
    super();
    // Initialize properties
    this.classes = { bodyClass: "has-dropdown-menu" };
    this.events = {
      handleAfterHide: "menu:handleAfterHide",
      handleAfterShow: "menu:handleAfterShow",
    };

    // Reference to first and last child elements
    this.summaryElement = this.firstElementChild;
    this.contentElement = this.lastElementChild;

    // Initial state based on attributes
    this._open = this.hasAttribute("open");

    // Setup hover detection with debouncing
    this.hoverEnterTimer = null;
    this.hoverLeaveTimer = null;
    this.isHoveringItem = false;
    this.isHoveringContent = false;

    // Cache for performance optimization
    this._cachedTrigger = null;
    this._cachedTranslateY = null;

    // Binding methods to ensure 'this' context is correct when they are called
    this.handleSummaryClick = this.handleSummaryClick.bind(this);
    this.handleOutsideClick = this.handleOutsideClick.bind(this);
    this.handleEscKeyPress = this.handleEscKeyPress.bind(this);
    this.handleFocusOut = this.handleFocusOut.bind(this);
    this.handleMouseEnter = this.handleMouseEnter.bind(this);
    this.handleMouseLeave = this.handleMouseLeave.bind(this);
    this.handleContentMouseEnter = this.handleContentMouseEnter.bind(this);
    this.handleContentMouseLeave = this.handleContentMouseLeave.bind(this);
  }

  connectedCallback() {
    // Event listeners for summary element
    this.summaryElement.addEventListener("click", this.handleSummaryClick);

    if (this.trigger === "hover") {
      this.summaryElement.addEventListener("focusin", this.#handleFocusIn);
      this.summaryElement.addEventListener("focusout", this.#handleFocusOutInternal);

      // Setup hover detection on dropdown content to prevent closing when moving to dropdown
      this.contentElement.addEventListener("mouseenter", this.handleContentMouseEnter);
      this.contentElement.addEventListener("mouseleave", this.handleContentMouseLeave);
    }

    // Setup hover detection with debouncing
    this.addEventListener("mouseenter", this.handleMouseEnter);
    this.addEventListener("mouseleave", this.handleMouseLeave);
  }

  disconnectedCallback() {
    // Cleanup timers first to prevent any pending callbacks
    this.#clearHoverTimers();

    // Remove event listeners
    this.summaryElement.removeEventListener("click", this.handleSummaryClick);
    if (this.trigger === "hover") {
      this.summaryElement.removeEventListener("focusin", this.#handleFocusIn);
      this.summaryElement.removeEventListener("focusout", this.#handleFocusOutInternal);
      this.contentElement.removeEventListener("mouseenter", this.handleContentMouseEnter);
      this.contentElement.removeEventListener("mouseleave", this.handleContentMouseLeave);
    }
    this.removeEventListener("mouseenter", this.handleMouseEnter);
    this.removeEventListener("mouseleave", this.handleMouseLeave);

    // Cleanup document-level listeners (prevent memory leak)
    // These might have been added in #setupOpenState
    document.removeEventListener("click", this.handleOutsideClick);
    document.removeEventListener("keydown", this.handleEscKeyPress);
    document.removeEventListener("focusout", this.handleFocusOut);

    // Clear cached values
    this._cachedTrigger = null;
    this._cachedTranslateY = null;
    this._cachedChildEl = null;
  }

  #handleFocusIn = (event) => {
    if (event.target === this.summaryElement) {
      this.open = true;
    }
  };

  #handleFocusOutInternal = (event) => {
    if (!this.contentElement.contains(event.relatedTarget)) {
      this.open = false;
    }
  };

  handleMouseEnter() {
    this.isHoveringItem = true;
    this.#clearHoverTimer("leave");
    this.hoverEnterTimer = setTimeout(() => {
      this.detectHover({ type: "mouseenter" });
    }, ANIMATION_TIMING.hoverEnterDelay);
  }

  handleMouseLeave(event) {
    this.isHoveringItem = false;
    this.#clearHoverTimer("enter");

    // Only start close timer if menu is open and not hovering over dropdown content
    if (this.open && !this.isHoveringContent) {
      this.hoverLeaveTimer = setTimeout(() => {
        // Double-check menu is still open before closing (prevent race condition)
        if (this.open) {
          this.detectHover({ type: "mouseleave" });
        }
      }, ANIMATION_TIMING.hoverLeaveDelay);
    }
  }

  handleContentMouseEnter() {
    this.isHoveringContent = true;
    // Cancel close timer when entering dropdown content
    this.#clearHoverTimer("leave");
  }

  handleContentMouseLeave() {
    this.isHoveringContent = false;
    // Only start close timer if menu is open and not hovering over item
    if (this.open && !this.isHoveringItem) {
      this.hoverLeaveTimer = setTimeout(() => {
        // Double-check menu is still open before closing (prevent race condition)
        if (this.open) {
          this.detectHover({ type: "mouseleave" });
        }
      }, ANIMATION_TIMING.hoverLeaveDelay);
    }
  }

  #clearHoverTimer(type) {
    const timer = type === "enter" ? this.hoverEnterTimer : this.hoverLeaveTimer;
    if (timer) {
      clearTimeout(timer);
      if (type === "enter") {
        this.hoverEnterTimer = null;
      } else {
        this.hoverLeaveTimer = null;
      }
    }
  }

  #clearHoverTimers() {
    if (this.hoverEnterTimer) {
      clearTimeout(this.hoverEnterTimer);
      this.hoverEnterTimer = null;
    }
    if (this.hoverLeaveTimer) {
      clearTimeout(this.hoverLeaveTimer);
      this.hoverLeaveTimer = null;
    }
  }

  set open(value) {
    // Check if the new value is different from the current value
    if (value !== this._open) {
      // Update the internal state
      this._open = value;

      // Perform actions based on whether the element is connected to the DOM
      if (this.isConnected) {
        // If connected, perform a transition
        this.transition(value);
      } else {
        // If not connected, directly manipulate the 'open' attribute
        if (value) {
          this.setAttribute("open", "");
        } else {
          this.removeAttribute("open");
        }
      }
    }
  }

  get open() {
    return this._open;
  }

  get trigger() {
    // Cache trigger value to avoid repeated media queries and DOM reads
    if (this._cachedTrigger === null) {
      // For touch devices, always use click events
      if (!mediaHoverFine()) {
        this._cachedTrigger = "click";
      } else {
        // For non-touch devices, check for custom trigger attribute
        this._cachedTrigger = this.getAttribute("trigger") || "click";
      }
    }
    return this._cachedTrigger;
  }

  handleSummaryClick(event) {
    // Prevent the default action of the event
    event.preventDefault();

    // Check if the device is not touch-enabled and the trigger type is 'hover'
    if (mediaHoverFine() && this.trigger === "hover" && this.summaryElement.hasAttribute("data-link")) {
      // If conditions are met, navigate to the URL specified in 'data-link'
      window.location.href = this.summaryElement.getAttribute("data-link");
    } else {
      // Otherwise, toggle the 'open' state
      this.open = !this.open;
    }
  }

  beforeOpen() {}

  beforeClose() {}

  get level() {
    return this.hasAttribute("level") ? this.getAttribute("level") : "top";
  }

  async transition(value) {
    if (value) {
      this.beforeOpen();
      this.#incrementDropdownCount();
      this.#setupOpenState();
      await this.showWithTransition();
      this.needsReverse();
      return waitForEvent(this, this.events.handleAfterShow);
    } else {
      this.beforeClose();
      this.#decrementDropdownCount();
      this.#cleanupOpenState();
      await this.hideWithTransition();
      if (!this.open) {
        this.removeAttribute("open");
      }
      return waitForEvent(this, this.events.handleAfterHide);
    }
  }

  #incrementDropdownCount() {
    lockDropdownCount.set(DetailsDropdown, (lockDropdownCount.get(DetailsDropdown) || 0) + 1);
  }

  #decrementDropdownCount() {
    const count = (lockDropdownCount.get(DetailsDropdown) || 0) - 1;
    lockDropdownCount.set(DetailsDropdown, count);

    if (count > 0) {
      document.body.classList.add(this.classes.bodyClass);
    } else {
      // Use helper with callback to check count (prevents race condition)
      removeScrollLockClass(document.body, this.classes.bodyClass, () => {
        // Only remove if no other dropdowns are open
        return (lockDropdownCount.get(DetailsDropdown) || 0) === 0;
      });
    }
  }

  #setupOpenState() {
    document.body.classList.add(this.classes.bodyClass);
    if (document.body.classList.contains("search-open")) {
      document.body.classList.remove("search-open");
    }
    this.setAttribute("open", "");
    this.summaryElement.setAttribute("open", "");
    setTimeout(() => {
      this.contentElement.setAttribute("open", "");
    }, ANIMATION_TIMING.contentOpenDelay);
    document.addEventListener("click", this.handleOutsideClick);
    document.addEventListener("keydown", this.handleEscKeyPress);
    document.addEventListener("focusout", this.handleFocusOut);
  }

  #cleanupOpenState() {
    this.summaryElement.removeAttribute("open");
    this.contentElement.removeAttribute("open");
    // Clear any pending hover timers when closing
    this.#clearHoverTimers();
    document.removeEventListener("click", this.handleOutsideClick);
    document.removeEventListener("keydown", this.handleEscKeyPress);
    document.removeEventListener("focusout", this.handleFocusOut);
  }

  get parentEl() {
    return this.contentElement;
  }

  get childEl() {
    // Cache child element reference
    if (!this._cachedChildEl) {
      this._cachedChildEl = this.parentEl.firstElementChild;
    }
    return this._cachedChildEl;
  }

  #getTranslateY() {
    // Cache translateY calculation to avoid repeated level checks
    if (this._cachedTranslateY === null) {
      this._cachedTranslateY = this.level === "top" ? "-3rem" : "2rem";
    }
    return this._cachedTranslateY;
  }

  async showWithTransition() {
    const reducedMotion = prefersReducedMotion();
    animate(
      this.parentEl,
      { opacity: [0, 1], visibility: "visible" },
      { duration: reducedMotion ? 0 : 0.3, easing: "ease-in-out" },
      { delay: reducedMotion ? 0 : 0.2 }
    );
    const translateY = this.#getTranslateY();
    return animate(
      this.childEl,
      { transform: [`translateY(${translateY})`, "translateY(0)"] },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.3, 1, 0.3, 1] }
    ).finished;
  }

  async hideWithTransition() {
    const reducedMotion = prefersReducedMotion();
    animate(
      this.parentEl,
      { opacity: 0, visibility: "hidden" },
      { duration: reducedMotion ? 0 : 0.2, easing: "ease-in-out" }
    );
    const translateY = this.#getTranslateY();
    return animate(
      this.childEl,
      { transform: `translateY(${translateY})` },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.3, 1, 0.3, 1] }
    ).finished;
  }

  handleOutsideClick(event) {
    const isClickInside = this.contains(event.target);
    const isClickOnDetailsDropdown = event.target.closest("details") instanceof DetailsDropdown;

    if (!isClickInside && !isClickOnDetailsDropdown) {
      this.open = false;
    }
  }

  handleEscKeyPress(event) {
    if (event.code === "Escape") {
      const targetMenu = event.target.closest("details[open]");
      if (targetMenu) {
        targetMenu.open = false;
      } else if (this.open) {
        this.open = false;
      }
    }
  }

  handleFocusOut(event) {
    if (event.relatedTarget && !this.contains(event.relatedTarget)) {
      this.open = false;
    }
  }

  detectHover(event) {
    // Only process hover events if trigger is hover and element is still connected
    if (this.trigger === "hover" && this.isConnected) {
      const shouldOpen = event.type === "mouseenter";
      // Only update if state actually changes (prevent unnecessary transitions)
      if (this.open !== shouldOpen) {
        this.open = shouldOpen;
      }
    }
  }

  needsReverse() {
    // Called after 'await showWithTransition()' - animation already finished
    // Layout is stable, no rAF needed
    if (!this.contentElement || this.contentElement.clientWidth === 0) {
      return;
    }

    // Batch all layout reads first
    const clientWidth = this.contentElement.clientWidth;
    const offsetLeft = this.contentElement.offsetLeft;
    const windowWidth = window.innerWidth;

    // Calculate
    const totalWidth = offsetLeft + clientWidth * 2;

    // Then write
    if (totalWidth > windowWidth) {
      this.contentElement.classList.add("needs-reverse");
    } else {
      // Remove class if no longer needed (handle window resize)
      this.contentElement.classList.remove("needs-reverse");
    }
  }
}
customElements.define("details-dropdown", DetailsDropdown, { extends: "details" });
lockDropdownCount.set(DetailsDropdown, 0);

const lockMegaCount = new WeakMap();
let megaMenuZIndexCounter = 1;

class DetailsMega extends DetailsDropdown {
  constructor() {
    super();

    if (Shopify.designMode) {
      this.addEventListener("shopify:block:select", () => {
        this.open = true;
      });

      this.addEventListener("shopify:block:deselect", () => {
        this.open = false;
      });
    }
  }

  get additionalBodyClass() {
    return "has-mega-menu";
  }

  #incrementMegaCount() {
    lockMegaCount.set(DetailsMega, (lockMegaCount.get(DetailsMega) || 0) + 1);
  }

  #decrementMegaCount() {
    const count = Math.max((lockMegaCount.get(DetailsMega) || 0) - 1, 0);
    lockMegaCount.set(DetailsMega, count);
    return count;
  }

  async showWithTransition() {
    this.#incrementMegaCount();
    document.body.classList.remove("mega-menu-closing");
    document.body.classList.add(this.additionalBodyClass);

    // Set higher z-index for opening menu to ensure it appears above closing ones
    megaMenuZIndexCounter += 1;
    this.contentElement.style.zIndex = megaMenuZIndexCounter.toString();

    const reducedMotion = prefersReducedMotion();
    return animate(
      this.childEl,
      { visibility: "visible", transform: ["translateY(-100%)", "translateY(0)"] },
      { duration: reducedMotion ? 0 : 0.6, easing: [0.7, 0, 0.2, 1] }
    ).finished;
  }

  async hideWithTransition() {
    const reducedMotion = prefersReducedMotion();
    const animationDuration = reducedMotion ? 0 : 0.6;

    document.documentElement.style.setProperty("--mega-menu-close-delay", reducedMotion ? "0s" : "0.6s");

    // CSS variables apply immediately, single rAF is sufficient for class addition
    await new Promise((resolve) => {
      requestAnimationFrame(() => {
        document.body.classList.add("mega-menu-closing");
        resolve();
      });
    });

    // Set lower z-index immediately so opening menu appears above
    this.contentElement.style.zIndex = "0";

    // Decrement count and only remove class if no other mega menus are open
    this.#decrementMegaCount();

    // Use helper with callback to check count (prevents race condition)
    removeScrollLockClass(document.body, this.additionalBodyClass, () => {
      // Only remove if no other mega menus are open
      return lockMegaCount.get(DetailsMega) === 0;
    });

    const animation = animate(
      this.childEl,
      { visibility: "hidden", transform: "translateY(-100%)" },
      { duration: animationDuration, easing: [0.7, 0, 0.2, 1] }
    );
    await animation.finished;
    // Remove closing class after animation completes
    document.body.classList.remove("mega-menu-closing");
  }
}
customElements.define("details-mega", DetailsMega, { extends: "details" });
lockMegaCount.set(DetailsMega, 0);

class MenuSidebar extends HTMLElement {
  #intersectionObserver = null;

  constructor() {
    super();

    this.classes = {
      visible: "is-visible",
    };

    this.handleSidenavMenuToggle = this.handleSidenavMenuToggle.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.updateHeight = this.updateHeight.bind(this);
  }

  get summarys() {
    return this.querySelectorAll("summary");
  }

  get containerEl() {
    return (this._containerEl = this._containerEl || this.closest(".mega-menu__wrapper"));
  }

  connectedCallback() {
    this.#setupAriaAttributes();

    onDocumentReady(this.setInitialMinHeight.bind(this));

    this.summarys.forEach((summary) => {
      summary.addEventListener("mouseenter", this.handleSidenavMenuToggle);
      summary.addEventListener("keydown", this.handleKeyDown);
      summary.addEventListener("click", (e) => {
        // Prevent default for mouse clicks to avoid toggling details element
        // Keyboard activation (Enter/Space) is handled in handleKeyDown
        e.preventDefault();

        const summaryEl = e.target.closest("summary");
        this.#goToLink(summaryEl);
      });
    });

    this.setupIntersectionObserver();
  }

  setInitialMinHeight() {
    requestAnimationFrame(() => {
      this.setPromotionsHeight();
    });
  }

  setPromotionsHeight() {
    if (!this.containerEl) return;

    const promotionsEl = this.containerEl.querySelector(".mega-menu__promotions");
    if (!promotionsEl) return;

    const promotionsHeight = promotionsEl.offsetHeight;
    this.containerEl.style.setProperty("--promotions-height", `${promotionsHeight}px`);
  }

  #setupAriaAttributes() {
    this.summarys.forEach((summary, index) => {
      const contentEl = summary.nextElementSibling;
      if (!contentEl) return;

      const summaryId = summary.id || `menu-sidebar-item-${index}`;
      const contentId = contentEl.id || `menu-sidebar-content-${index}`;

      summary.id = summaryId;
      contentEl.id = contentId;

      summary.setAttribute("role", "menuitem");
      summary.setAttribute("aria-controls", contentId);
      summary.setAttribute("aria-expanded", "false");
      contentEl.setAttribute("role", "menu");
      contentEl.setAttribute("aria-labelledby", summaryId);
    });
  }

  setupIntersectionObserver() {
    this.#intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setTimeout(() => {
            this.updateHeight();
            this.setPromotionsHeight();
          }, 100);
        }
      });
    });

    this.#intersectionObserver.observe(this);
  }

  updateHeight() {
    const activeSummary = this.querySelector(`.${this.classes.visible}`);
    if (!activeSummary) return;

    const contentEl = activeSummary.nextElementSibling;

    if (!this.containerEl || !contentEl) return;

    // Called from IntersectionObserver + setTimeout(100ms), layout is stable
    // No rAF needed - 50-100ms reflow timing is acceptable
    const contentHeight = contentEl.offsetHeight;
    this.containerEl.style.setProperty("--sidebar-height", `${contentHeight}px`);
  }

  setActiveItem(summaryEl, isUpdateHeight = true) {
    const lastSidenavEl = this.querySelector(`.${this.classes.visible}`);
    if (lastSidenavEl) {
      lastSidenavEl.classList.remove(this.classes.visible);
      lastSidenavEl.setAttribute("aria-expanded", "false");
    }

    summaryEl.classList.add(this.classes.visible);
    summaryEl.setAttribute("aria-expanded", "true");

    isUpdateHeight && this.updateHeight();
  }

  handleSidenavMenuToggle(event) {
    const summaryEl = event.target.closest("summary");
    if (summaryEl) {
      this.setActiveItem(summaryEl);
    }
  }

  handleKeyDown(event) {
    const summaryEl = event.target.closest("summary");
    if (!summaryEl) return;

    const summaries = Array.from(this.summarys);
    const currentIndex = summaries.indexOf(summaryEl);
    if (currentIndex === -1) return;

    const key = event.key;
    let targetIndex = currentIndex;

    switch (key) {
      case "ArrowDown":
        event.preventDefault();
        targetIndex = currentIndex + 1;
        if (targetIndex >= summaries.length) targetIndex = 0;
        summaries[targetIndex].focus();
        this.setActiveItem(summaries[targetIndex]);
        break;

      case "ArrowUp":
        event.preventDefault();
        targetIndex = currentIndex - 1;
        if (targetIndex < 0) targetIndex = summaries.length - 1;
        summaries[targetIndex].focus();
        this.setActiveItem(summaries[targetIndex]);
        break;

      case "Home":
        event.preventDefault();
        summaries[0].focus();
        this.setActiveItem(summaries[0]);
        break;

      case "End":
        event.preventDefault();
        summaries[summaries.length - 1].focus();
        this.setActiveItem(summaries[summaries.length - 1]);
        break;

      case "Enter":
        event.preventDefault();
        this.setActiveItem(summaryEl);
        this.#goToLink(summaryEl);
        break;

      case " ":
        event.preventDefault();
        this.setActiveItem(summaryEl);
        break;

      default:
        return;
    }
  }

  #goToLink(summaryEl) {
    const linkUrl = summaryEl.dataset.linkUrl;
    if (linkUrl) {
      window.location.href = linkUrl;
    }
  }

  disconnectedCallback() {
    this.summarys.forEach((el) => {
      el.removeEventListener("mouseenter", this.handleSidenavMenuToggle);
      el.removeEventListener("keydown", this.handleKeyDown);
    });

    if (this.#intersectionObserver) {
      this.#intersectionObserver.disconnect();
      this.#intersectionObserver = null;
    }
  }
}
customElements.define("menu-sidebar", MenuSidebar);

class MenuDrawerDetails extends HTMLDetailsElement {
  #abortController = new AbortController();
  #animationFrameId = null;
  #boundHandleKeyDown = null;
  #boundHandleToggle = null;
  /** @type {Array<{ element: HTMLDetailsElement; tabindex: string | null }>} */
  #detailsOutsideRestore = [];
  /** @type {HTMLElement[]} - focusable inside .menu-drawer__submenu, filled in #setDetailsTabindex, used in #setupFocusTrap */
  #focusableElements = [];
  /** @type {((event: KeyboardEvent) => void) | null} */
  #focusTrapHandler = null;

  constructor() {
    super();

    this.onSummaryClick = this.onSummaryClick.bind(this);
    this.onCloseButtonClick = this.onCloseButtonClick.bind(this);
    this.onOpenSubmenuButtonClick = this.onOpenSubmenuButtonClick.bind(this);
    this.#boundHandleKeyDown = this.#handleKeyDown.bind(this);
    this.#boundHandleToggle = this.#handleToggle.bind(this);
  }

  get parent() {
    return this.closest("[data-parent]");
  }

  get summary() {
    return this.querySelector("summary");
  }

  get closeButton() {
    return this.querySelector(".menu-drawer__item-link-back");
  }

  get openSubmenuButton() {
    return this.querySelector(".menu-drawer__item-link-arrow");
  }

  connectedCallback() {
    const summary = this.summary;
    const closeButton = this.closeButton;
    const openSubmenuButton = this.openSubmenuButton;
    const { signal } = this.#abortController;

    if (summary) {
      summary.addEventListener("click", this.onSummaryClick, { signal });
      this.#setupAriaAttributes();
    }

    if (openSubmenuButton) {
      openSubmenuButton.addEventListener("click", this.onOpenSubmenuButtonClick, { signal });
    }

    if (closeButton) {
      closeButton.addEventListener("click", this.onCloseButtonClick, { signal });
    }

    // Handle Escape key to close drawer
    document.addEventListener("keydown", this.#boundHandleKeyDown);

    this.addEventListener("toggle", this.#boundHandleToggle, { signal });

    // Sync aria-expanded with open attribute
    this.#syncAriaExpanded();
  }

  disconnectedCallback() {
    this.#abortController.abort();

    document.removeEventListener("keydown", this.#boundHandleKeyDown);

    this.#removeFocusTrap();
    this.#restoreDetailsTabindex();

    // Cancel any pending animation
    if (this.#animationFrameId) {
      window.cancelAnimationFrame(this.#animationFrameId);
      this.#animationFrameId = null;
    }
  }

  #handleToggle() {
    if (this.open) {
      this.#setDetailsTabindex();
      this.#setupFocusTrap();
    } else {
      this.#removeFocusTrap();
      this.#restoreDetailsTabindex();
    }
  }

  #setupFocusTrap() {
    if (this.#focusableElements.length === 0) return;

    const firstElement = this.#focusableElements[0];
    const lastElement = this.#focusableElements[this.#focusableElements.length - 1];

    const handleTabKey = (event) => {
      if (event.key !== "Tab") return;

      const activeElement = document.activeElement;
      const isFocusInDrawer = this.#focusableElements.includes(activeElement);

      if (event.shiftKey) {
        if (activeElement === firstElement || !isFocusInDrawer) {
          event.preventDefault();
          event.stopPropagation();
          lastElement.focus();
        }
      } else {
        if (activeElement === lastElement || !isFocusInDrawer) {
          event.preventDefault();
          event.stopPropagation();
          firstElement.focus();
        }
      }
    };

    this.closeButton && this.closeButton.focus();
    this.addEventListener("keydown", handleTabKey, true);
    this.#focusTrapHandler = handleTabKey;
  }

  #removeFocusTrap() {
    if (this.#focusTrapHandler) {
      this.removeEventListener("keydown", this.#focusTrapHandler, true);
      this.#focusTrapHandler = null;
    }
    this.#focusableElements = [];
  }

  #setDetailsTabindex() {
    this.#restoreDetailsTabindex();

    const dialog = this.closest(".dialog");
    const dialogHeader = dialog?.querySelector(".dialog__header");
    const submenu = this.querySelector(".menu-drawer__submenu");
    const focusableElements = getFocusableElements(dialog);

    this.#focusableElements = [];

    focusableElements.forEach((el) => {
      if (submenu?.contains(el) || dialogHeader?.contains(el)) {
        this.#focusableElements.push(el);
        return;
      }

      const tabindex = el.getAttribute("tabindex");
      this.#detailsOutsideRestore.push({ element: el, tabindex });
      el.setAttribute("tabindex", "-1");
    });
  }

  #restoreDetailsTabindex() {
    for (const { element, tabindex } of this.#detailsOutsideRestore) {
      if (tabindex === null) {
        element.removeAttribute("tabindex");
      } else {
        element.setAttribute("tabindex", tabindex);
      }
    }
    this.#detailsOutsideRestore.length = 0;
  }

  #setupAriaAttributes() {
    const summary = this.summary;
    if (!summary) return;

    const contentId = summary.id || `${this.tagName.toLowerCase()}-content`;
    summary.id = summary.id || contentId;

    summary.setAttribute("aria-expanded", this.hasAttribute("open") ? "true" : "false");
  }

  #syncAriaExpanded() {
    const summary = this.summary;
    if (!summary) return;

    summary.setAttribute("aria-expanded", this.hasAttribute("open") ? "true" : "false");
  }

  #handleKeyDown(event) {
    if (event.key !== "Escape" || !this.hasAttribute("open")) return;

    // Only close if the event target is within this component
    const closestDrawer = event.target.closest("menu-drawer-details");
    if (!closestDrawer || closestDrawer !== this) return;

    event.preventDefault();
    this.onCloseButtonClick();
  }

  onSummaryClick(event) {
    const summary = this.summary;
    const href = summary.dataset.linkUrl;

    if (href) {
      event.preventDefault();
      window.location.href = href;

      return;
    }
  }

  onOpenSubmenuButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const parent = this.parent;
    const summary = this.summary;

    setTimeout(() => {
      if (!parent || !summary) return;

      if (!this.open) {
        this.open = true;
      }
      parent.classList.add("active");
      this.classList.add("active");
      this.#syncAriaExpanded();
    }, 100);
  }

  onCloseButtonClick() {
    const parent = this.parent;
    const summary = this.summary;

    if (!parent || !summary) return;

    parent.classList.remove("active");
    this.classList.remove("active");
    this.#syncAriaExpanded();

    this.#closeAnimation();
  }

  #closeAnimation() {
    // Cancel any existing animation
    if (this.#animationFrameId) {
      window.cancelAnimationFrame(this.#animationFrameId);
    }

    let animationStart;

    const handleAnimation = (time) => {
      if (animationStart === undefined) {
        animationStart = time;
      }

      const elapsedTime = time - animationStart;

      if (elapsedTime < 400) {
        this.#animationFrameId = window.requestAnimationFrame(handleAnimation);
      } else {
        this.removeAttribute("open");
        this.#animationFrameId = null;
        this.#syncAriaExpanded();
      }
    };

    this.#animationFrameId = window.requestAnimationFrame(handleAnimation);
  }
}
customElements.define("menu-drawer-details", MenuDrawerDetails, { extends: "details" });

class MenuDrawerSubmenu extends AccordionComponent {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();
  }

  onSummaryClick(event) {
    event.preventDefault();

    const { target } = event;
    const summary = target.closest("summary");

    if (summary) {
      const href = summary.dataset.linkUrl;

      if (href) {
        window.location.href = href;
        return;
      }
    }
  }

  onArrowClick(event) {
    event.preventDefault();
    event.stopPropagation();

    super.onSummaryClick(event);
  }
}
customElements.define("menu-drawer-submenu", MenuDrawerSubmenu);

/**
 * @typedef {Object} ShowMoreRefs
 * @property {HTMLElement} showMoreButton - The button to toggle visibility of the items
 * @property {HTMLElement[]} showMoreItems - The hidden items to show and hide
 * @property {HTMLElement} showMoreContent - The content container to measure and animate
 */

/**
 * A custom element that manages the showing and hiding excess content items
 *
 * @extends {Component<ShowMoreRefs>}
 */

class ShowMoreComponent extends Component {
  requiredRefs = ["showMoreButton", "showMoreItems", "showMoreContent"];

  /**
   * @type {boolean}
   */
  #expanded = false;

  /**
   * @type {boolean}
   */
  #disableOnDesktop = false;

  /**
   * @type {number}
   */
  #collapsedHeight = 0;

  /**
   * @type {'mobile:hidden' | 'hidden'}
   */
  #disabledClass = "hidden";

  /**
   * @type {'MOBILE' | 'DESKTOP'}
   */
  get #currentBreakpoint() {
    return isMobileBreakpoint() ? "MOBILE" : "DESKTOP";
  }

  /**
   * @type {Animation | undefined}
   */
  #animation;

  /**
   * @constant {number}
   */
  #animationSpeed = 300;

  connectedCallback() {
    super.connectedCallback();
    this.#updateBreakpointState();
  }

  /**
   * Updates the current breakpoint and apprpropriate disabled class
   */
  #updateBreakpointState = () => {
    this.#disableOnDesktop = this.dataset.disableOnDesktop === "true";
    this.#disabledClass = this.#disableOnDesktop ? "mobile:hidden" : "hidden";
  };

  /**
   * Handles expanding the content
   * @returns {{startHeight: number, endHeight: number}}
   */
  #expand = () => {
    const { showMoreItems, showMoreContent } = this.refs;

    this.#collapsedHeight = showMoreContent.offsetHeight;
    const startHeight = this.#collapsedHeight;

    showMoreItems?.forEach((item) => item.classList.remove(this.#disabledClass));

    return {
      startHeight,
      endHeight: showMoreContent.scrollHeight,
    };
  };

  /**
   * Handles collapsing the content
   * @returns {{startHeight: number, endHeight: number}}
   */
  #collapse = () => {
    const { showMoreContent } = this.refs;
    const startHeight = showMoreContent.offsetHeight;
    const endHeight = this.#collapsedHeight;

    return { startHeight, endHeight };
  };

  /**
   * Initializes a height transition
   * @param {number} startHeight
   * @param {number} endHeight
   */
  #animateHeight = (startHeight, endHeight) => {
    const { showMoreContent } = this.refs;

    showMoreContent.style.overflow = "hidden";
    this.#animation?.cancel();

    this.#animation = showMoreContent.animate(
      {
        height: [`${startHeight}px`, `${endHeight}px`],
      },
      {
        duration: this.#animationSpeed,
        easing: "ease-in-out",
      }
    );

    this.#animation.onfinish = () => this.#onAnimationFinish();
  };

  /**
   * Handles the animation finish event.
   */
  #onAnimationFinish() {
    const { showMoreContent, showMoreItems } = this.refs;

    if (this.#expanded) {
      showMoreItems.forEach((item) => item.classList.add(this.#disabledClass));
    }

    showMoreContent.style.removeProperty("height");
    showMoreContent.style.overflow = "";
    this.#expanded = !this.#expanded;
  }

  /**
   * Toggles the expansion state of the content.
   *
   * @param {Event} event - The click event
   */
  toggle = (event) => {
    event.preventDefault();

    this.#updateBreakpointState();

    if (this.#currentBreakpoint === "DESKTOP" && this.#disableOnDesktop) return;

    const { startHeight, endHeight } = !this.#expanded ? this.#expand() : this.#collapse();

    this.dataset.expanded = this.#expanded ? "false" : "true";
    this.refs.showMoreButton.setAttribute("aria-expanded", this.dataset.expanded);

    this.#animateHeight(startHeight, endHeight);
  };
}

if (!customElements.get("show-more-component")) {
  customElements.define("show-more-component", ShowMoreComponent);
}

class HighlightText extends HTMLElement {
  constructor() {
    super();
    this.hasAnimated = false;
  }

  connectedCallback() {
    this.#bindInView();
  }

  #bindInView() {
    inView(
      this,
      async () => {
        if (!this.hasAnimated) {
          this.hasAnimated = true;
          await this.#enter();
        }
      },
      { rootMargin: "0px 0px -50px 0px" }
    );
  }

  #enter() {
    this.classList.add("animate");
  }
}

if (!customElements.get("highlight-text")) {
  customElements.define("highlight-text", HighlightText, { extends: "em" });
}

class ReadMore extends Component {
  /** @type {string[]} */
  requiredRefs = ["readMoreButton", "readMoreButtonText", "readMoreContent"];

  constructor() {
    super();

    this.classes = {
      isDisabled: "is-disabled",
      isCollapsed: "is-collapsed",
    };

    this.toggleClass = this.dataset.toggleClass;
    this.showText = this.dataset.showText;
    this.hideText = this.dataset.hideText;
    this.lineClamp = parseInt(this.dataset.lineClamp);
  }

  connectedCallback() {
    super.connectedCallback();

    this.init();
  }

  init() {
    const { readMoreButton: button, readMoreContent: content } = this.refs;

    const lineHeight = parseFloat(window.getComputedStyle(content).lineHeight);
    const contentHeight = content.scrollHeight;
    const maxHeight = lineHeight * this.lineClamp;

    if (contentHeight <= maxHeight) {
      button.style.display = "none";
      return;
    }

    this.classList.remove(this.classes.isDisabled);
    content.classList.remove(this.toggleClass);
    this.showLess();
  }

  showMore() {
    const { readMoreContent: content, readMoreButtonText: buttonText } = this.refs;

    this.classList.remove(this.classes.isCollapsed);
    content.classList.remove(this.toggleClass);
    buttonText.textContent = this.hideText;
    this.resetHeight();
  }

  showLess() {
    const { readMoreContent: content, readMoreButtonText: buttonText } = this.refs;

    this.classList.add(this.classes.isCollapsed);
    content.classList.add(this.toggleClass);
    buttonText.textContent = this.showText;
    this.setHeight();
  }

  setHeight() {
    const { readMoreContent: content } = this.refs;

    const contentStyle = window.getComputedStyle(content);

    const lineHeight = parseFloat(contentStyle.lineHeight);
    const lines = parseInt(contentStyle.getPropertyValue("--line-clamp"));
    const maxHeight = lineHeight * lines;
    content.style.setProperty("max-height", maxHeight + "px");
  }

  resetHeight() {
    const { readMoreContent: content } = this.refs;

    content.style.removeProperty("max-height");
  }

  onToggleClick(event) {
    event.preventDefault();

    const { readMoreContent: content } = this.refs;

    if (content.classList.contains(this.toggleClass)) {
      this.showMore();
    } else {
      this.showLess();
    }
  }
}

if (!customElements.get("read-more")) {
  customElements.define("read-more", ReadMore);
}

class SwipeComponent extends HTMLDivElement {
  #resizer = null;
  #mutationObserver = null;
  #previousActiveElement = null;
  #isActive = false;

  constructor() {
    super();

    this.swipeEl = null;
    this.swipeInner = null;

    this.scrollHandler = this.updateScrollClasses.bind(this);
    ``;
    this.classes = {
      active: "is--active",
      begin: "is--beginning",
      end: "is--end",
    };
  }

  connectedCallback() {
    this.swipeEl = this.querySelector(".swipe__element");
    if (!this.swipeEl) return;

    this.swipeInner = this.swipeEl.querySelector(".swipe__inner");

    this.init();

    this.swipeEl.addEventListener("scroll", this.scrollHandler, { passive: true });
    if (this.swipeEl.offsetParent !== null) {
      this.updateScrollClasses();
    }

    this.#resizer = new ResizeNotifier(() => {
      // Check if element is visible and measurable
      this.swipeEl.offsetParent !== null && this.updateScrollClasses();
    });
    this.#resizer.observe(this.swipeEl);

    if (this.#isActive) {
      this.#startObservingActiveChanges();
    }
  }

  disconnectCallback() {
    if (this.swipeEl) {
      this.swipeEl.removeEventListener("scroll", this.scrollHandler, { passive: true });
    }
    if (this.#resizer) {
      this.#resizer.disconnect();
    }
    if (this.#mutationObserver) {
      this.#mutationObserver.disconnect();
    }
  }

  #startObservingActiveChanges() {
    if (!this.swipeInner || this.#mutationObserver) return;

    const observedAttributes = ["aria-current", "aria-selected"];

    this.#mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        // Handle attribute changes on direct children
        if (mutation.type === "attributes") {
          const target = /** @type {HTMLElement} */ (mutation.target);
          const attributeName = mutation.attributeName;

          if (observedAttributes.includes(attributeName) && target.getAttribute(attributeName) === "true") {
            this.#scrollToActiveElement(target);
          }
        }

        // Handle new children being added
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.#mutationObserver.observe(node, {
                attributes: true,
                attributeFilter: observedAttributes,
              });
            }
          }
        }
      }
    });

    // Observe .swipe__inner for child list changes and observe all existing direct children
    this.#mutationObserver.observe(this.swipeInner, {
      childList: true,
    });

    // Observe all existing direct children for aria-current and aria-selected changes
    const children = Array.from(this.swipeInner.children);
    for (const child of children) {
      this.#mutationObserver.observe(child, {
        attributes: true,
        attributeFilter: observedAttributes,
      });
    }
  }

  #stopObservingActiveChanges() {
    if (this.#mutationObserver) {
      this.#mutationObserver.disconnect();
      this.#mutationObserver = null;
    }
  }

  #scrollToActiveElement(activeElement) {
    if (!this.swipeEl || !activeElement || !this.swipeInner) return;

    // Skip if the same element is already active (prevents duplicate scrolls)
    if (this.#previousActiveElement === activeElement) return;

    const scrollRect = activeElement.getBoundingClientRect();
    const boxRect = this.swipeEl.getBoundingClientRect();
    const scrollLeft = this.swipeEl.scrollLeft;
    const containerGap = 16;

    // Determine scroll direction by comparing indices
    const children = Array.from(this.swipeInner.children);
    const currentIndex = children.indexOf(activeElement);
    const previousIndex = this.#previousActiveElement ? children.indexOf(this.#previousActiveElement) : -1;

    let scrollOffset;

    // If scrolling right
    if (previousIndex < currentIndex) {
      scrollOffset = scrollRect.x + scrollLeft - boxRect.x - containerGap;
    } else {
      // Scrolling left
      scrollOffset = scrollRect.x + scrollLeft - boxRect.x - boxRect.width + scrollRect.width + containerGap;
    }

    this.#previousActiveElement = activeElement;

    this.swipeEl.scrollTo({
      left: scrollOffset,
      behavior: "smooth",
    });
  }

  init() {
    if (this.swipeEl.classList.contains("swipe-all")) {
      this.setActive(true);
      return;
    }

    const setupResponsive = (className, mediaQuery) => {
      if (!this.swipeEl.classList.contains(className)) return;
      const mql = window.matchMedia(mediaQuery);
      const update = () => this.setActive(mql.matches);
      update();
      mql.addEventListener("change", update);
    };

    setupResponsive("swipe-mobile", mediaBreakpointMobile);
    setupResponsive("swipe-tablet", mediaBreakpointTablet);
  }

  setActive(isActive = true) {
    this.#isActive = isActive;
    this.classList.toggle(this.classes.active, isActive);

    if (isActive) {
      this.#startObservingActiveChanges();
    } else {
      this.#stopObservingActiveChanges();
    }
  }

  updateScrollClasses() {
    const scrollLeft = this.swipeEl.scrollLeft;
    const clientWidth = this.swipeEl.clientWidth;
    const scrollWidth = this.swipeEl.scrollWidth;

    const atStart = scrollLeft <= 0;
    const atEnd = Math.ceil(scrollLeft + clientWidth) >= scrollWidth;

    this.classList.toggle(this.classes.begin, atStart);
    this.classList.toggle(this.classes.end, atEnd);
  }
}
customElements.define("swipe-component", SwipeComponent, { extends: "div" });

export class NewsletterForm extends Component {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    this.init();
  }

  /**
   * Show message when user re-subscribe with exists email.
   */
  init() {
    const { input, messageDialog } = this.refs;
    const messageDialogRefs = messageDialog?.refs ?? {};
    const { alert, messageErrorSubscribed } = messageDialogRefs;

    const liveUrl = window.location.href;
    const result = liveUrl.includes("form_type=customer");
    const isSubscribed = result && input.value.length != 0;

    if (isSubscribed && messageErrorSubscribed && !alert) {
      messageErrorSubscribed.classList.remove("hidden");
    }

    if (isSubscribed || alert) {
      if (!window.isMessageDialogShow) {
        messageDialog && messageDialog.showDialog();
        window.isMessageDialogShow = true;
      }
    }
  }
}

if (!customElements.get("newsletter-form")) {
  customElements.define("newsletter-form", NewsletterForm);
}

class SlideshowComponent extends CarouselComponent {
  #resizeObserver;

  constructor() {
    super();
    this.selectedIndex = this.selectedIndex;
  }

  get sectionId() {
    return this.getAttribute("data-section-id");
  }

  get controlType() {
    return this.getAttribute("data-control-type");
  }

  static get observedAttributes() {
    return ["selected-index"];
  }

  get selectedIndex() {
    return parseInt(this.getAttribute("selected-index")) || 0;
  }

  set selectedIndex(index) {
    this.setAttribute("selected-index", `${index}`);
  }

  connectedCallback() {
    super.connectedCallback();

    // Wait for parent CarouselComponent to finish Swiper initialization
    // Check if already initialized (in case event fired before our connectedCallback)
    if (this.swiperInstance) {
      this.#initAfterSwiperReady();
    } else {
      // Listen for carousel:ready event
      this.addEventListener(
        "carousel:ready",
        () => {
          this.#initAfterSwiperReady();
        },
        { once: true }
      );
    }
  }

  #initAfterSwiperReady() {
    this.#init();
    this.#updateControlsScheme(this.refs.slides[0]);
    // requestAnimationFrame(() => {
    //   this.#updateControlHeight();
    // });

    // ResizeObserver callback is already batched by browser, no rAF needed
    this.#resizeObserver = new ResizeObserver(() => this.#updateControlHeight());
    this.#resizeObserver.observe(this.refs.controls);
  }

  disconnectedCallback() {
    this.#resizeObserver?.disconnect();
  }

  #init() {
    if (typeof this.swiperInstance !== "object") return;
    const { slides, activeIndex } = this.swiperInstance;

    if (slides[activeIndex]) {
      const motionEls = slides[activeIndex].querySelectorAll("motion-component[data-motion-hold]");
      motionEls &&
        motionEls.forEach((el) => {
          el.replay();
        });
    }

    this.swiperInstance.on("realIndexChange", this.#handleChange);
  }

  #handleChange = (swiper) => {
    const { slides, realIndex, activeIndex } = swiper;
    this.selectedIndex = realIndex;

    this.#updateControlsScheme(slides[activeIndex]);
  };

  #updateControlsScheme(activeSlide) {
    if (this.refs.controls) {
      const classesToRemove = Array.from(this.refs.controls.classList).filter((className) =>
        className.startsWith("color-")
      );
      classesToRemove.forEach((className) => this.refs.controls.classList.remove(className));
      const colorScheme = activeSlide.dataset.colorScheme;
      if (colorScheme) this.refs.controls.classList.add(colorScheme);
    }
  }

  #updateControlHeight() {
    // Batch read and write to avoid force reflow
    // Safe in ResizeObserver callback but also ensures proper batching
    const height = this.refs.controls.offsetHeight;
    this.style.setProperty("--control-height", `${height}px`);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "selected-index" && oldValue !== null && oldValue !== newValue) {
      const prevSlide = this.querySelectorAll(`[data-swiper-slide-index="${oldValue}"]`);
      const currentSlide = this.querySelectorAll(`[data-swiper-slide-index="${newValue}"]`);

      prevSlide.forEach((slide) => {
        const deferredMedia = slide.querySelector("deferred-media");
        if (deferredMedia) deferredMedia.pauseMedia();
      });

      currentSlide.forEach((slide) => {
        const deferredMedia = slide.querySelector("deferred-media");
        if (deferredMedia) deferredMedia.playMedia();

        if (!document.body.hasAttribute("data-motion-disabled")) {
          const motionEls = slide.querySelectorAll("motion-component");
          motionEls &&
            motionEls.forEach((el) => {
              el.replay();
            });
        }
      });
    }
  }
}

if (!customElements.get("slideshow-component")) {
  customElements.define("slideshow-component", SlideshowComponent);
}

class CollectionHighlight extends Component {
  /** @type {AbortController | undefined} */
  #shopifyAbortController;

  connectedCallback() {
    super.connectedCallback();

    this.#registerDesignModeEvents();
  }

  disconnectedCallback() {
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();
  }

  #registerDesignModeEvents() {
    // Only in Theme Editor and when explicitly opted-in
    if (!(window.Shopify && Shopify.designMode)) return;

    // Recreate controller to drop old listeners if any
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (e.detail.sectionId != this.sectionId) return;

        const titleEl = this.getBlockEl(e);
        const index = Number(titleEl.dataset.index);

        this.setActiveTab(index);
      },
      { signal }
    );
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

  isActive(el) {
    return el.getAttribute("aria-current") === "true";
  }

  getBlockEl(event) {
    const { target } = event;

    return target.closest(".collection-highlight__part");
  }

  getTitleEl(event) {
    const { target } = event;

    return target.closest(".collection-highlight__part-title");
  }

  handleNavigationKeys(event) {
    const { key } = event;
    const { titles } = this.refs;

    if (!titles?.length) return;

    const titleEl = this.getTitleEl(event);
    if (!titleEl) return;

    const currentIndex = titles.indexOf(titleEl);
    if (currentIndex === -1) return;

    // Handle Enter/Space to navigate to link
    if (key === "Enter" || key === " ") {
      const linkUrl = titleEl.dataset.linkUrl;
      if (linkUrl) {
        event.preventDefault();
        window.location.href = linkUrl;
      }
      return;
    }

    // Handle navigation keys
    let nextIndex = currentIndex;
    switch (key) {
      case "ArrowDown":
        nextIndex = currentIndex + 1;
        break;
      case "ArrowUp":
        nextIndex = currentIndex - 1;
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = titles.length - 1;
        break;
      default:
        return;
    }

    // Clamp index to valid range
    nextIndex = Math.max(0, Math.min(nextIndex, titles.length - 1));

    if (nextIndex !== currentIndex) {
      event.preventDefault();
      titles[nextIndex]?.focus();
    }
  }
}

class CollectionHighlightWithImageCard extends CollectionHighlight {
  #abortController = new AbortController();
  #hoverTracker = null;
  #preventClick = false;
  #initialPreviewHeight = false;
  #currentActiveIndex = 0;

  connectedCallback() {
    super.connectedCallback();

    const { titles, preview } = this.refs;
    const { signal } = this.#abortController;

    if (titles) {
      requestAnimationFrame(() => {
        this.setPreviewHeight();
        this.setActiveTab(0);
      });

      this.onTouchChangeHandler = this.onTouchChange.bind(this);
      this.onClickHandler = this.onClick.bind(this);
      this.onKeydownHandler = this.handleNavigationKeys.bind(this);
      this.onMouseOverHandler = this.onMouseOver.bind(this);
      this.textsWrapMouseOverHandler = this.#onTextsWrapMouseOver.bind(this);

      if ("ontouchstart" in window) {
        titles.forEach((item) => {
          item.addEventListener("touchstart", this.onTouchChangeHandler, { signal, passive: true });
          item.addEventListener("click", this.onClickHandler, { signal });
        });
      } else {
        titles.forEach((item) => {
          item.addEventListener("mouseover", this.onMouseOverHandler, { signal });
          item.addEventListener("focus", this.onMouseOverHandler, { signal });
        });

        this.addEventListener("keydown", this.onKeydownHandler, { signal });

        preview.addEventListener("mouseover", this.textsWrapMouseOverHandler, { signal });
      }

      const mqlMobile = window.matchMedia(mediaBreakpointMobile);
      mqlMobile.onchange = () => this.updatePreviewHeight.bind(this);
    }
  }

  disconnectedCallback() {
    this.#abortController.abort();
    super.disconnectedCallback();
  }

  setPreviewHeight() {
    const { preview, texts } = this.refs;

    if (preview && texts.length > 0) {
      preview.style.setProperty("height", texts[0].offsetHeight + "px");
    }
  }

  updatePreviewHeight() {
    const { preview, texts } = this.refs;
    if (!preview || !texts || texts.length === 0) return;

    requestAnimationFrame(() => {
      let maxHeight = 0;
      texts.forEach((el) => {
        maxHeight = Math.max(maxHeight, el.offsetHeight);
      });

      preview.style.setProperty("height", maxHeight + "px");
      this.#initialPreviewHeight = true;
    });
  }

  setActiveTab(newIndex) {
    const { titles, images, texts } = this.refs;

    const newTitle = titles[newIndex];
    const newImage = images[newIndex];
    const newText = texts[newIndex];

    this.#currentActiveIndex = newIndex;

    texts.forEach((el) => el.classList.toggle("is-active", el === newText));
    titles.forEach((el) => {
      const index = Number(el.dataset.index);
      el.setAttribute("aria-current", el === newTitle);
      el.setAttribute("tabindex", index == newIndex ? "0" : "-1");
    });
    images.forEach((el) => {
      el.classList.toggle("is-active", el === newImage);
    });
  }

  onMouseOver(event) {
    if (!this.#initialPreviewHeight) {
      this.updatePreviewHeight();
    }

    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    if (event.type === "mouseover") {
      clearTimeout(this.#hoverTracker);
      this.#hoverTracker = setTimeout(() => {
        if (this.isActive(titleEl)) return;

        this.setActiveTab(index);
      }, 100);
    } else {
      if (this.isActive(titleEl)) return;
      this.setActiveTab(index);
    }
  }

  onTouchChange(event) {
    const titleEl = this.getTitleEl(event);
    const index = Number(titleEl.dataset.index);

    if (this.isActive(titleEl)) {
      this.#preventClick = false;
      return;
    } else {
      this.#preventClick = true;
    }

    this.setActiveTab(index);
  }

  onClick(event) {
    if (this.#preventClick) {
      event.preventDefault();
    }
  }

  #onTextsWrapMouseOver() {
    clearTimeout(this.#hoverTracker);
  }
}

if (!customElements.get("collection-highlight-with-image-card")) {
  customElements.define("collection-highlight-with-image-card", CollectionHighlightWithImageCard);
}

class LocalPickup extends Component {
  /** @type {AbortController | undefined} */
  #activeFetch;

  connectedCallback() {
    super.connectedCallback();

    const closestSection = this.closest(`.shopify-section, dialog`);

    /** @type {(event: VariantUpdateEvent) => void} */
    const variantUpdated = (event) => {
      if (event.detail.data.newProduct) {
        this.dataset.productUrl = event.detail.data.newProduct.url;
      }

      const variantId = event.detail.resource ? event.detail.resource.id : null;
      const variantAvailable = event.detail.resource ? event.detail.resource.available : null;
      if (variantId !== this.dataset.variantId) {
        if (variantId && variantAvailable) {
          this.classList.remove("hidden");
          this.dataset.variantId = variantId;
          this.#fetchAvailability(variantId);
        } else {
          this.classList.add("hidden");
        }
      }
    };

    closestSection?.addEventListener(ThemeEvents.variantUpdate, variantUpdated);

    this.disconnectedCallback = () => {
      closestSection?.removeEventListener(ThemeEvents.variantUpdate, variantUpdated);
    };
  }

  #createAbortController() {
    if (this.#activeFetch) this.#activeFetch.abort();
    this.#activeFetch = new AbortController();
    return this.#activeFetch;
  }

  /**
   * Fetches the availability of a variant.
   * @param {string} variantId - The ID of the variant to fetch availability for.
   */
  #fetchAvailability = (variantId) => {
    if (!variantId) return;

    const abortController = this.#createAbortController();

    const url = this.dataset.productUrl;
    fetch(`${url}?variant=${variantId}&section_id=${this.dataset.sectionId}`, {
      signal: abortController.signal,
    })
      .then((response) => response.text())
      .then((text) => {
        if (abortController.signal.aborted) return;

        const html = new DOMParser().parseFromString(text, "text/html");
        const wrapper = html.querySelector(`local-pickup[data-variant-id="${variantId}"]`);
        if (wrapper) {
          this.classList.remove("hidden");
          morph(this, wrapper);
        } else this.classList.add("hidden");
      })
      .catch((_e) => {
        if (abortController.signal.aborted) return;
        this.classList.add("hidden");
      });
  };
}

if (!customElements.get("local-pickup")) {
  customElements.define("local-pickup", LocalPickup);
}

class ScrollingCards extends Component {
  #shopifyAbortController;

  constructor() {
    super();
    this.desktopScrollHandler = null;
    this.resizeHandler = null;
    this.rafId = null;
    this.resizeTimeout = null;
    this.lenis = null;
    this.intersectionObserver = null;
    this.resizeObserver = null;
    this.isInViewport = false;
    // Cache positions to avoid getBoundingClientRect() on every scroll
    this.cachedStartPoint = null;
    this.cachedEndPoint = null;
    this.cachedScrollRange = null;
    this.needsRecalculation = true;
    // Track last scroll position to detect significant changes
    this.lastScrollTop = 0;
    // Track cached element heights to detect layout changes
    this.cachedFirstColumnHeight = null;
    this.cachedLastColumnHeight = null;
  }

  connectedCallback() {
    super.connectedCallback();

    this.scrollHandler = this.animateHeadings.bind(this);

    const updateLayout = (isMobile) => {
      const { headingWrap, headings, scrollEl } = this.refs;

      if (!headings || !scrollEl) {
        return;
      }

      const firstTextEl = headings.querySelector(".text-block");
      if (!firstTextEl) return;

      // Batch all layout reads first
      const firstTextStyle = window.getComputedStyle(firstTextEl);
      const lineHeight = parseFloat(firstTextStyle.lineHeight);
      const contentHeight = headings.offsetHeight;

      // Then perform calculations
      const doubleLineHeight = lineHeight * this.headingLinesToShow;
      const wrapHeight = Math.min(doubleLineHeight, contentHeight);

      // Finally, batch all writes
      headingWrap.style.height = `${wrapHeight}px`;

      if (wrapHeight >= contentHeight) {
        // Reset transform if no animation needed
        headings.style.transform = "translateY(0)";
        this.cleanup();
        return;
      }

      this.headingsTranslateY = 0 - (contentHeight - wrapHeight);

      // Mark positions as needing recalculation after layout change
      this.needsRecalculation = true;

      // Clean up previous handlers
      this.cleanup();

      if (isMobile) {
        this.initMobileAnimation();
      } else {
        this.initDesktopAnimation();
      }

      // Update animation position immediately after layout change
      this.updateAnimationPosition();
    };

    // Defer entire initialization to avoid force reflow in connectedCallback
    requestAnimationFrame(() => {
      updateLayout(mediaQueryMobile.matches);
    });

    mediaQueryMobile.onchange = (event) => {
      requestAnimationFrame(() => {
        updateLayout(event.matches);
      });
    };

    // Setup resize handler to recalculate layout
    this.setupResizeHandler(updateLayout, mediaQueryMobile);
    this.#registerDesignModeEvents();

    this.boundFocusinHandler = this.#handleHeadingFocusin.bind(this);
    this.addEventListener("focusin", this.boundFocusinHandler);
  }

  setupResizeHandler(updateLayout, mqlMobile) {
    // Throttle resize handler to avoid excessive recalculations
    this.resizeHandler = () => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }

      // Use RAF + timeout for smooth resize handling
      this.resizeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
          updateLayout(mqlMobile.matches);
        });
      }, 150);
    };

    window.addEventListener("resize", this.resizeHandler, { passive: true });
  }

  updateAnimationPosition() {
    // Update animation position based on current scroll state
    const { headings, cards } = this.refs;

    if (!headings || !cards || cards.length === 0) {
      return;
    }

    if (isMobileBreakpoint()) {
      // Mobile: update based on horizontal scroll
      this.animateHeadings();
    } else {
      // Desktop: update based on window scroll
      const firstColumn = cards[0];
      const lastColumn = cards[cards.length - 1];
      // Force recalculation when explicitly updating position after layout change
      this.needsRecalculation = true;
      this.updateDesktopAnimation(firstColumn, lastColumn, headings);
    }
  }

  get headingLinesToShow() {
    return 2;
  }

  initDesktopAnimation() {
    const { headings, cards } = this.refs;

    if (!headings || !cards || cards.length === 0) {
      return;
    }

    const firstColumn = cards[0];
    const lastColumn = cards[cards.length - 1];

    // Setup IntersectionObserver to pause animation when component is out of viewport
    // This prevents unnecessary calculations and layout thrashing on Safari
    this.setupIntersectionObserver(firstColumn, lastColumn);

    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    if (this.lenis) {
      // Lenis is available, use it for smooth scrolling
      this.desktopScrollHandler = () => {
        // Skip if not in viewport to avoid unnecessary calculations
        if (!this.isInViewport) {
          return;
        }

        // Cancel previous RAF to avoid multiple updates
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
        }

        // Use RAF to sync with browser's render cycle
        this.rafId = requestAnimationFrame(() => {
          this.updateDesktopAnimation(firstColumn, lastColumn, headings);
          this.rafId = null;
        });
      };

      // Listen to Lenis scroll events (shared instance with other sections)
      this.lenis.on("scroll", this.desktopScrollHandler);
    } else {
      // Fallback to native scroll if Lenis not available yet
      // Note: Lenis is initialized early globally, but may not be ready if component init is very early
      // Retry logic ensures we switch to Lenis once it's available
      this.desktopScrollHandler = () => {
        // Skip if not in viewport to avoid unnecessary calculations
        if (!this.isInViewport) {
          return;
        }

        // Try to get Lenis again (in case it finished loading after component init)
        if (!this.lenis) {
          const retryLenis = getLenis();
          if (retryLenis) {
            this.lenis = retryLenis;
            window.removeEventListener("scroll", this.desktopScrollHandler);
            this.lenis.on("scroll", this.desktopScrollHandler);
            return;
          }
        }

        // Cancel previous RAF to avoid multiple updates
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
        }

        // Use RAF to sync with browser's render cycle
        this.rafId = requestAnimationFrame(() => {
          this.updateDesktopAnimation(firstColumn, lastColumn, headings);
          this.rafId = null;
        });
      };

      window.addEventListener("scroll", this.desktopScrollHandler, { passive: true });
    }

    // Initial update
    requestAnimationFrame(() => {
      this.updateDesktopAnimation(firstColumn, lastColumn, headings);
    });
  }

  setupIntersectionObserver(firstColumn, lastColumn) {
    // Use IntersectionObserver to detect when component enters/leaves viewport
    // This helps pause calculations when component is not visible, reducing layout thrashing
    const options = {
      root: null,
      rootMargin: "50% 0px", // Start observing before component enters viewport
      threshold: 0,
    };

    this.intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        this.isInViewport = entry.isIntersecting;
        // If component enters viewport, mark positions as needing recalculation
        if (this.isInViewport) {
          this.needsRecalculation = true;
        }
      });
    }, options);

    // Observe the container element (this) to detect when it enters/leaves viewport
    this.intersectionObserver.observe(this);

    // Setup ResizeObserver to detect when columns change size (layout shifts from other sections)
    // This is critical for Safari when scrolling between sections
    this.resizeObserver = new ResizeObserver(() => {
      // Invalidate cache when layout changes
      this.needsRecalculation = true;
      // Reset cached heights to force recalculation
      this.cachedFirstColumnHeight = null;
      this.cachedLastColumnHeight = null;
    });

    // Observe both columns to detect layout changes
    if (firstColumn) {
      this.resizeObserver.observe(firstColumn);
    }
    if (lastColumn) {
      this.resizeObserver.observe(lastColumn);
    }
  }

  updateDesktopAnimation(firstColumn, lastColumn, headings) {
    // Early return if not in viewport to avoid unnecessary calculations
    if (!this.isInViewport) {
      return;
    }

    // Use Lenis scroll position if available, otherwise fallback to native scroll
    const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
    const viewportHeight = window.innerHeight;

    // Detect significant scroll position changes (e.g., when scrolling between sections)
    // This helps invalidate cache when layout might have shifted
    const scrollDelta = Math.abs(scrollTop - this.lastScrollTop);
    const significantScrollChange = scrollDelta > viewportHeight * 0.5; // More than half viewport

    // Only recalculate positions when needed (layout change, resize, first time, or significant scroll change)
    // This avoids calling getBoundingClientRect() on every scroll, which causes layout thrashing on Safari
    if (this.needsRecalculation || this.cachedStartPoint === null || significantScrollChange) {
      // Batch layout reads together to minimize forced reflows
      // Read offsetHeight first (cheaper), then getBoundingClientRect (more expensive)
      const firstColumnHeight = firstColumn.offsetHeight;
      const lastColumnHeight = lastColumn.offsetHeight;
      const firstRect = firstColumn.getBoundingClientRect();
      const lastRect = lastColumn.getBoundingClientRect();

      // Calculate absolute positions from document top
      const firstTop = firstRect.top + scrollTop;
      const lastBottom = lastRect.bottom + scrollTop;

      // ScrollTrigger equivalent:
      // start: "top top" = when firstColumn top reaches viewport top
      // end: "bottom bottom" = when lastColumn bottom reaches viewport bottom

      // Start point: scrollTop when firstColumn top is at viewport top
      this.cachedStartPoint = firstTop;

      // End point: scrollTop when lastColumn bottom is at viewport bottom
      this.cachedEndPoint = lastBottom - viewportHeight;

      this.cachedScrollRange = this.cachedEndPoint - this.cachedStartPoint;

      // Cache element heights for change detection (used by ResizeObserver)
      this.cachedFirstColumnHeight = firstColumnHeight;
      this.cachedLastColumnHeight = lastColumnHeight;

      // Mark as calculated
      this.needsRecalculation = false;
    }

    // Update last scroll position for change detection
    this.lastScrollTop = scrollTop;

    if (this.cachedScrollRange <= 0) {
      // No scroll range, set to initial position
      headings.style.transform = "translateY(0)";
      return;
    }

    // Calculate progress: 0 at start, 1 at end
    const progress = Math.max(0, Math.min(1, (scrollTop - this.cachedStartPoint) / this.cachedScrollRange));
    const y = this.headingsTranslateY * progress;

    // Set transform directly for immediate sync with scroll (scrub behavior)
    headings.style.transform = `translateY(${y}px)`;
  }

  initMobileAnimation() {
    const { scrollEl } = this.refs;

    if (!scrollEl) {
      return;
    }

    // For mobile, use horizontal scroll event listener
    scrollEl.addEventListener("scroll", this.scrollHandler, { passive: true });
  }

  cleanup() {
    // Clean up desktop scroll listener
    if (this.desktopScrollHandler) {
      if (this.lenis) {
        // Remove Lenis scroll listener
        this.lenis.off("scroll", this.desktopScrollHandler);
      } else {
        // Remove native scroll listener
        window.removeEventListener("scroll", this.desktopScrollHandler);
      }
      this.desktopScrollHandler = null;
    }

    // Clean up IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    // Clean up ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Cancel pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Cancel pending resize timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    // Clean up mobile scroll listener
    if (this.refs.scrollEl) {
      this.refs.scrollEl.removeEventListener("scroll", this.scrollHandler);
    }

    // Reset cached values
    this.cachedStartPoint = null;
    this.cachedEndPoint = null;
    this.cachedScrollRange = null;
    this.needsRecalculation = true;
    this.lastScrollTop = 0;
    this.cachedFirstColumnHeight = null;
    this.cachedLastColumnHeight = null;
  }

  animateHeadings() {
    const { scrollEl, headings } = this.refs;

    if (!scrollEl || !headings) {
      return;
    }

    // Batch all layout reads together
    const scrollLeft = Math.ceil(scrollEl.scrollLeft);
    const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;

    // Early return if no scroll needed.
    if (maxScroll <= 0) {
      headings.style.transform = "translateY(0)";
      return;
    }

    // Calculations
    const scrolledRatio = scrollLeft / maxScroll;
    const y = Math.ceil(this.headingsTranslateY * scrolledRatio);

    // Set transform directly for immediate sync with scroll (scrub behavior)
    headings.style.transform = `translate3d(0, ${y}px, 0)`;
  }

  disconnectedCallback() {
    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = undefined;
    super.disconnectedCallback();

    if (this.boundFocusinHandler) {
      this.removeEventListener("focusin", this.boundFocusinHandler);
      this.boundFocusinHandler = null;
    }

    this.cleanup();
  }

  get sectionId() {
    return this.dataset.sectionId || "";
  }

  #handleHeadingFocusin(e) {
    const { target } = e;
    if (target.closest(".block-scrolling__headings")) {
      this.#scrollToHeadingBlock(target);
    }
  }

  #registerDesignModeEvents() {
    if (!(window.Shopify && Shopify.designMode)) return;

    this.#shopifyAbortController?.abort();
    this.#shopifyAbortController = new AbortController();
    const { signal } = this.#shopifyAbortController;

    document.addEventListener(
      "shopify:block:select",
      (e) => {
        if (e.detail.sectionId != this.sectionId) return;

        const { target } = e;

        // Heading block selected.
        const headingsContainer = target.closest(".block-scrolling__headings");
        if (headingsContainer) {
          this.#scrollToHeadingBlock(target);
          return;
        }

        // Card block selected.
        const cardEl = target.closest(".scrolling-cards__card");
        if (isMobileBreakpoint() && cardEl) {
          const { cards, scrollEl } = this.refs;
          const index = Array.from(cards).indexOf(cardEl);
          if (index >= 0) {
            const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
            if (maxScroll > 0) {
              const targetLeft = cardEl.offsetLeft - (scrollEl.clientWidth - cardEl.offsetWidth) / 2;
              scrollEl.scrollTo({
                left: Math.max(0, Math.min(targetLeft, maxScroll)),
                behavior: "smooth",
              });
            }
            this.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        }
      },
      { signal }
    );
  }

  #scrollToHeadingBlock(target) {
    const { headings: headingsContainer, cards, scrollEl } = this.refs;
    const selectedTextBlock = target.closest(".text-block");
    const index = selectedTextBlock ? Array.from(headingsContainer.children).indexOf(selectedTextBlock) : 0;
    const N = Math.max(1, headingsContainer.children.length);

    if (isMobileBreakpoint()) {
      if (scrollEl) {
        const maxScroll = scrollEl.scrollWidth - scrollEl.clientWidth;
        if (maxScroll > 0) {
          let ratio;
          if (index === 0) {
            ratio = 1;
          } else if (index === N - 1) {
            ratio = 0;
          } else {
            const containerRect = headingsContainer.getBoundingClientRect();
            const textRect = selectedTextBlock.getBoundingClientRect();
            const offsetTop = containerRect.height - (textRect.top - containerRect.top + textRect.height / 2);
            ratio = offsetTop / containerRect.height;
          }

          ratio = 1 - Math.max(0, Math.min(1, ratio));
          const targetLeft = Math.max(0, Math.min(maxScroll * ratio, maxScroll));

          scrollEl.scrollTo({
            left: targetLeft,
            behavior: "smooth",
          });
        }
      }
    } else {
      if (cards && cards.length > 0) {
        const firstColumn = cards[0];
        const lastColumn = cards[cards.length - 1];
        const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
        const firstRect = firstColumn.getBoundingClientRect();
        const lastRect = lastColumn.getBoundingClientRect();
        const firstTop = firstRect.top + scrollTop;
        const lastBottom = lastRect.bottom + scrollTop;
        const viewportHeight = window.innerHeight;
        const startPoint = firstTop;
        const endPoint = lastBottom - viewportHeight;
        const scrollRange = endPoint - startPoint;
        if (scrollRange > 0) {
          const progress = N > 1 ? index / (N - 1) : 0;
          const targetScrollTop = startPoint + progress * scrollRange;
          const lenis = getLenis();
          if (lenis) {
            lenis.scrollTo(targetScrollTop, { lerp: 0.1 });
          } else {
            window.scrollTo({ top: targetScrollTop, behavior: "smooth" });
          }
        }
      } else {
        this.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }
}

if (!customElements.get("scrolling-cards")) {
  customElements.define("scrolling-cards", ScrollingCards);
}

class ScrollingCardLayered extends Component {
  constructor() {
    super();
    this.scrollHandler = null;
    this.resizeHandler = null;
    this.rafId = null;
    this.resizeTimeout = null;
    this.lastScrollTop = 0; // Track last scroll position to detect scroll stop
    this.cardData = null; // Store card widths and scale ratios
    this.previousTransforms = new Map(); // Cache previous transform values to avoid unnecessary DOM writes
  }

  connectedCallback() {
    super.connectedCallback();

    const mqlMobile = window.matchMedia("screen and (max-width: 767px)");
    const init = () => {
      // Defer all layout reads to avoid force reflow during page load
      // Use double RAF to ensure refs are ready (Component updates refs in requestIdleCallback)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const style = getComputedStyle(this);
          this.stickySpacing = parseFloat(style.getPropertyValue("--sticky-spacing")) * 10;
          this.widthReduced = parseFloat(style.getPropertyValue("--width-reduced")) * 10;

          this.cleanup();
          this.initAnimation();
        });
      });
    };

    init(mqlMobile.matches);
    mqlMobile.onchange = (event) => init(event.matches);
  }

  initAnimation() {
    const { cards } = this.refs;

    if (!Array.isArray(cards) || cards.length === 0) {
      // Ensure cardData is null if initialization fails
      this.cardData = null;
      return;
    }

    const cardCount = cards.length;
    const lastCard = cards[cardCount - 1];
    const headerHeight =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) +
      20 +
      (cards.length - 1) * this.stickySpacing;

    // Batch all layout reads before loop to avoid force reflow
    const cardWidths = [];
    const scaleRatios = [];

    for (let index = 0; index < cardCount; index++) {
      cardWidths[index] = cards[index].offsetWidth;

      if (index < cardCount - 1) {
        // Skip last card
        const cardWidth = cardWidths[index];
        const newWidth = cardWidth - (cardCount - index - 1) * this.widthReduced;
        scaleRatios[index] = newWidth / cardWidth;
      }
    }

    // Calculate and cache absolute position of lastCard (for sticky calculation)
    // This needs to be recalculated on resize, but stable during scroll
    const lastCardRect = lastCard.getBoundingClientRect();
    // Use Lenis scroll position if available, otherwise fallback to native scroll
    const lenisInstance = getLenis();
    const currentScrollTop = lenisInstance
      ? lenisInstance.scroll
      : window.pageYOffset || document.documentElement.scrollTop;
    const lastCardTopAbsolute = lastCardRect.top + currentScrollTop;

    // Store card data for resize handling
    // IMPORTANT: Set cardData BEFORE setting up scroll handler to avoid race condition
    this.cardData = {
      cards,
      cardCount,
      lastCard,
      lastCardTopAbsolute, // Cache absolute position
      headerHeight,
      cardWidths,
      scaleRatios,
    };

    // Setup scroll handler AFTER cardData is set
    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    if (this.lenis) {
      // Lenis is available, use it for smooth scrolling
      // With Lenis, we can simplify scroll handling - it already handles smooth scrolling
      // Throttle to 30fps (32ms) instead of 60fps to reduce layout reads by 50%
      this.scrollHandler = throttle(() => {
        if (!this.cardData) return;
        // Update lastScrollTop to track scroll position
        this.lastScrollTop = this.lenis.scroll;
        // Start RAF loop if not already running
        if (!this.rafId) {
          this.#rafLoop();
        }
      }, 32);
      this.lenis.on("scroll", this.scrollHandler);
    } else {
      // Fallback to native scroll if Lenis not available yet
      // Note: Lenis is initialized early globally, but may not be ready if component init is very early
      // Retry logic ensures we switch to Lenis once it's available
      // Throttle to reduce performance impact
      this.scrollHandler = throttle(() => {
        if (!this.cardData) return;
        // Try to get Lenis again (in case it finished loading after component init)
        if (!this.lenis) {
          const retryLenis = getLenis();
          if (retryLenis) {
            this.lenis = retryLenis;
            window.removeEventListener("scroll", this.scrollHandler);
            // Re-create throttled handler for Lenis
            this.scrollHandler = throttle(() => {
              if (!this.cardData) return;
              this.lastScrollTop = this.lenis.scroll;
              if (!this.rafId) {
                this.#rafLoop();
              }
            }, 32);
            this.lenis.on("scroll", this.scrollHandler);
            return;
          }
        }
        // Update lastScrollTop to track scroll position
        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
        this.lastScrollTop = currentScrollTop;
        // Start RAF loop if not already running
        if (!this.rafId) {
          this.#rafLoop();
        }
      }, 32);
      window.addEventListener("scroll", this.scrollHandler, { passive: true });
    }
    // Initial update - ensure it runs even on Safari old versions
    // Use double RAF + timeout fallback to ensure updateAnimation runs
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.cardData) {
          this.#recalculateLastCardPosition();
          this.updateAnimation();
        }
      });
    });
    // Fallback timeout for Safari old versions
    setTimeout(() => {
      if (this.cardData && !this.rafId) {
        this.#recalculateLastCardPosition();
        this.updateAnimation();
      }
    }, 100);

    // Setup resize handler
    this.setupResizeHandler();
  }

  // RAF loop for smooth animation updates during scroll
  // Simplified with Lenis - it handles smooth scrolling, we just need to update animations
  #rafLoop() {
    if (!this.cardData) {
      this.rafId = null;
      return;
    }

    this.updateAnimation();

    // Continue loop only if scroll is active (Lenis will stop when scroll stops)
    // This prevents unnecessary RAF calls when idle
    const currentScrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
    const lastScrollTop = this.lastScrollTop || currentScrollTop;
    const scrollDiff = Math.abs(currentScrollTop - lastScrollTop);
    const isScrolling = scrollDiff > 0.1;

    if (isScrolling) {
      this.lastScrollTop = currentScrollTop;
      this.rafId = requestAnimationFrame(() => {
        this.#rafLoop();
      });
    } else {
      // Scroll stopped, but ensure one final update to catch any layout changes
      // This is important when scrolling between sections to prevent jank
      this.updateAnimation();
      this.rafId = null;
      this.lastScrollTop = currentScrollTop;
    }
  }

  updateAnimation() {
    if (!this.cardData) return;

    const { cards, cardCount, lastCard, headerHeight, scaleRatios } = this.cardData;
    // Use Lenis scroll position if available, otherwise fallback to native scroll
    const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;

    // Use stable viewport height
    const viewportHeight = window.visualViewport
      ? window.visualViewport.height
      : document.documentElement.clientHeight || window.innerHeight;

    // Batch ALL layout reads before any writes to avoid forced reflow
    // Read all getBoundingClientRect() once, outside the loop
    const cardRects = [];
    for (let index = 0; index < cardCount; index++) {
      cardRects[index] = cards[index].getBoundingClientRect();
    }

    const lastCardRect = cardRects[cardCount - 1];
    const lastCardTopRelative = lastCardRect.top;

    // Calculate lastCard absolute position from current layout (most accurate)
    // This ensures accuracy when scrolling between sections
    const lastCardTopAbsolute = lastCardRect.top + scrollTop;

    // Update cached lastCardTopAbsolute immediately for sticky calculation
    // Force update every frame to prevent jank when scrolling between sections
    this.cardData.lastCardTopAbsolute = lastCardTopAbsolute;

    // Early exit: check if we're completely outside animation range
    // Calculate sticky range first (cheaper than getBoundingClientRect)
    const stickyStartPoint = lastCardTopAbsolute - headerHeight;
    const stickyEndPoint = lastCardTopAbsolute;
    const isInStickyRange = scrollTop >= stickyStartPoint && scrollTop <= stickyEndPoint;

    // Early exit optimization: if scroll is way before or after all animations, skip expensive reads
    // Use a wider range for early exit to account for fast scrolling
    const firstCardAnimationStart = lastCardTopAbsolute - headerHeight - viewportHeight * 3;
    const lastCardAnimationEnd = lastCardTopAbsolute + viewportHeight * 2;
    if (scrollTop < firstCardAnimationStart || scrollTop > lastCardAnimationEnd) {
      // Way outside range, reset all transforms and exit early
      for (let index = 0; index < cardCount - 1; index++) {
        const card = cards[index];
        const previousTransform = this.previousTransforms.get(card);
        if (previousTransform !== "scale3d(1, 1, 1)") {
          card.style.transform = "scale3d(1, 1, 1)";
          this.previousTransforms.set(card, "scale3d(1, 1, 1)");
        }
      }
      // Clean up offset-top if exists
      for (let index = 0; index < cardCount - 1; index++) {
        const card = cards[index];
        if (card.style.getPropertyValue("--offset-top")) {
          card.style.removeProperty("--offset-top");
        }
      }
      return;
    }

    // Cache absolute positions for all cards (calculated once per frame)
    const cardTopsAbsolute = [];
    for (let index = 0; index < cardCount; index++) {
      cardTopsAbsolute[index] = cardRects[index].top + scrollTop;
    }

    // Update scale animations for each card (except last)
    // Use transform3d for GPU acceleration
    for (let index = 0; index < cardCount - 1; index++) {
      const card = cards[index];
      const scaleRatio = scaleRatios[index];

      // Use cached absolute positions instead of recalculating
      const nextCardTop = cardTopsAbsolute[index + 1];
      const lastCardTop = lastCardTopAbsolute;
      const endPoint = lastCardTop - headerHeight;

      // Start point: when nextCard top is at viewport bottom
      const startPoint = nextCardTop - viewportHeight;
      const scrollRange = endPoint - startPoint;

      let newTransform;
      if (scrollRange <= 0) {
        // Before animation range, set to initial scale (1)
        newTransform = "scale3d(1, 1, 1)";
      } else {
        // Calculate progress: 0 at start, 1 at end
        const progress = Math.max(0, Math.min(1, (scrollTop - startPoint) / scrollRange));
        const scale = 1 + (scaleRatio - 1) * progress;
        newTransform = `scale3d(${scale}, ${scale}, 1)`;
      }

      // Only update if transform changed (avoid unnecessary DOM writes)
      const previousTransform = this.previousTransforms.get(card);
      if (previousTransform !== newTransform) {
        card.style.transform = newTransform;
        this.previousTransforms.set(card, newTransform);
      }
    }

    // Update sticky last card and offset-top for other cards
    if (isInStickyRange) {
      const currentLastCardTop = Math.max(lastCardTopRelative, 0);
      for (let index = 0; index < cardCount - 1; index++) {
        const card = cards[index];
        const newValue = `${currentLastCardTop - (cardCount - index - 1) * this.stickySpacing}px`;
        const currentValue = card.style.getPropertyValue("--offset-top");
        if (currentValue !== newValue) {
          card.style.setProperty("--offset-top", newValue);
        }
      }
    } else {
      for (let index = 0; index < cardCount - 1; index++) {
        const card = cards[index];
        if (card.style.getPropertyValue("--offset-top")) {
          card.style.removeProperty("--offset-top");
        }
      }
    }
  }

  setupResizeHandler() {
    this.resizeHandler = () => {
      if (this.resizeTimeout) {
        clearTimeout(this.resizeTimeout);
      }

      // Recalculate on resize
      this.resizeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
          // Recalculate card widths and scale ratios
          if (this.cardData) {
            const { cards, cardCount } = this.cardData;
            const cardWidths = [];
            const scaleRatios = [];

            for (let index = 0; index < cardCount; index++) {
              cardWidths[index] = cards[index].offsetWidth;

              if (index < cardCount - 1) {
                const cardWidth = cardWidths[index];
                const newWidth = cardWidth - (cardCount - index - 1) * this.widthReduced;
                scaleRatios[index] = newWidth / cardWidth;
              }
            }

            this.cardData.cardWidths = cardWidths;
            this.cardData.scaleRatios = scaleRatios;

            // Recalculate headerHeight
            this.cardData.headerHeight =
              parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) +
              20 +
              (cardCount - 1) * this.stickySpacing;

            // Recalculate lastCard absolute position
            // Force recalculation on resize to prevent jank when sections change
            const lastCardRect = this.cardData.lastCard.getBoundingClientRect();
            const currentScrollTop = this.lenis
              ? this.lenis.scroll
              : window.pageYOffset || document.documentElement.scrollTop;
            this.cardData.lastCardTopAbsolute = lastCardRect.top + currentScrollTop;

            // Reset lastScrollTop to force RAF loop restart if needed
            this.lastScrollTop = currentScrollTop;

            // Update animation immediately
            this.updateAnimation();
          }
        });
      }, 150);
    };

    window.addEventListener("resize", this.resizeHandler, { passive: true });
  }

  #recalculateLastCardPosition() {
    if (!this.cardData) return;
    const lastCardRect = this.cardData.lastCard.getBoundingClientRect();
    const currentScrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
    this.cardData.lastCardTopAbsolute = lastCardRect.top + currentScrollTop;
  }

  cleanup() {
    // Clean up scroll listener
    if (this.scrollHandler) {
      if (this.lenis) {
        // Remove Lenis scroll listener
        this.lenis.off("scroll", this.scrollHandler);
      } else {
        // Remove native scroll listener
        window.removeEventListener("scroll", this.scrollHandler);
      }
      this.scrollHandler = null;
    }

    // Clean up resize handler
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }

    // Cancel pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Cancel pending resize timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    // Reset card data and cache
    this.cardData = null;
    this.previousTransforms.clear();
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.cleanup();
  }
}

if (!customElements.get("scrolling-card-layered")) {
  customElements.define("scrolling-card-layered", ScrollingCardLayered);
}

class ProductsBundle extends Component {
  #abortController = new AbortController();

  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { signal } = this.#abortController;
    const { hotspots } = this.refs;
    this.onHoverHandler = this.#handleHover.bind(this);

    if (hotspots) {
      hotspots.forEach((hotspot) => {
        ["mouseover", "mouseleave", "focus", "focusout"].forEach((eventName) => {
          hotspot.addEventListener(eventName, this.onHoverHandler, { signal });
        });
      });
    }

    this.#setButtonDisable();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#abortController.abort();
  }

  #handleHover(event) {
    const { type, target } = event;
    const { productList } = this.refs;
    const { products } = productList.refs;
    const hotspot = target.closest('[ref="hotspots[]"]');
    const hotspotIndex = Number(hotspot.dataset.index);
    const isEnter = "mouseover" === type || "focus" === type;

    hotspot.classList.toggle("is-selected", isEnter);
    if (!isMobileBreakpoint()) {
      this.classList.toggle("is-hover", isEnter);
    }

    let activeProduct = null;
    products.forEach((product) => {
      const productIndex = Number(product.dataset.index);
      product.classList.toggle("is-selected", hotspotIndex === productIndex);
      if (hotspotIndex === productIndex) {
        activeProduct = product;
      }
    });

    if (isEnter) {
      if (
        productList.swiperInstance &&
        typeof productList.swiperInstance === "object" &&
        !productList.swiperInstance.visibleSlidesIndexes.includes(hotspotIndex)
      ) {
        productList.swiperInstance.slideTo(hotspotIndex);
      }

      if (isMobileBreakpoint() && activeProduct) {
        this.#scrollToTop(activeProduct);
      }
    }
  }

  #scrollToTop(target, offset = 80) {
    const scrollIntoView = (selector, offset) => {
      window.scrollTo({
        behavior: "smooth",
        top: selector.getBoundingClientRect().top - document.body.getBoundingClientRect().top - offset,
      });
    };

    scrollIntoView(target, offset);
  }

  onAddToCartClick(event) {
    event.preventDefault();

    const { addAllToCart } = this.refs;

    if (addAllToCart.getAttribute("aria-disabled") === "true") return;
    addAllToCart.setAttribute("aria-disabled", "true");
    this.#showErrorMessage();
    this.#toggleButtonLoading(true);

    const products = this.querySelectorAll("product-bundle-variant-selector");

    const items = Array.from(products, (product) => ({
      id: product.querySelector("[name=id]")?.value,
      quantity: Number(product.querySelector("quantity-input")?.input?.value) || 1,
    })).filter((item) => item.id);

    if (FoxTheme.template.name == "cart" || FoxTheme.settings.cartType != "drawer") {
      const formData = new FormData();
      items.forEach(({ id, quantity }, index) => {
        formData.append(`items[${index}][id]`, id);
        formData.append(`items[${index}][quantity]`, quantity);
      });

      const fetchCfg = fetchConfig("javascript", { body: formData });

      fetch(FoxTheme.routes.cart_add_url, {
        ...fetchCfg,
        headers: {
          ...fetchCfg.headers,
          Accept: "text/html",
        },
      }).then((response) => {
        if (response.ok) {
          window.location = FoxTheme.routes.cart_url;
        }
      });

      return;
    }

    let sectionsToUpdate = [];
    document.dispatchEvent(new CartGroupedSections(sectionsToUpdate));

    const body = JSON.stringify({
      items,
      sections: Array.from(sectionsToUpdate).join(","),
      sections_url: window.location.pathname,
    });

    const fetchCfg = fetchConfig("json", { body });

    fetch(`${FoxTheme.routes.cart_add_url}`, fetchCfg)
      .then((response) => response.json())
      .then(async (response) => {
        if (response.status) {
          this.#showErrorMessage(response.description);
          return;
        } else {
          const cartJson = await (await fetch(`${FoxTheme.routes.cart_url}`, fetchConfig("json"))).json();
          cartJson["sections"] = response["sections"];

          this.dispatchEvent(
            new CartUpdateEvent(cartJson, "", {
              itemCount: cartJson.item_count || 0,
              sections: response.sections,
            })
          );
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        addAllToCart.removeAttribute("aria-disabled");
        this.#toggleButtonLoading(false);
      });
  }

  #showErrorMessage(message = false) {
    const { addToCartTextError } = this.refs;

    if (addToCartTextError) {
      addToCartTextError.classList.toggle("hidden", !message);

      if (message) addToCartTextError.textContent = message;
    } else {
      message && alert(message);
    }
  }

  #toggleButtonLoading(isLoading) {
    const { addAllToCart, addToCartSpinner } = this.refs;

    addAllToCart.classList.toggle("btn--loading", isLoading);
    addToCartSpinner.classList.toggle("hidden", !isLoading);
  }

  #setButtonDisable() {
    const products = this.querySelectorAll("product-bundle-variant-selector");
    const { addAllToCart } = this.refs;

    if (products.length < 1) {
      addAllToCart.disabled = true;
    }
  }
}

if (!customElements.get("products-bundle")) {
  customElements.define("products-bundle", ProductsBundle);
}

class ProductBundleVariantSelector extends Component {
  constructor() {
    super();
  }

  connectedCallback() {
    super.connectedCallback();

    const { variantSelect } = this.refs;

    this.currentOptionIds = variantSelect ? variantSelect.options[variantSelect.selectedIndex].dataset.optionsId : null;
    this.currentVariantId = variantSelect ? variantSelect.value : null;
  }

  get productId() {
    return this.dataset.productId;
  }

  get productUrl() {
    return this.dataset.productUrl;
  }

  get sectionId() {
    return this.dataset.sectionId;
  }

  onVariantChange(event) {
    const { target: variantSelect } = event;

    this.currentOptionIds = variantSelect.options[variantSelect.selectedIndex].dataset.optionsId;
    this.currentVariantId = variantSelect.value;

    fetch(`${this.productUrl.split("?")[0]}?section_id=${this.sectionId}&option_values=${this.currentOptionIds}`)
      .then((response) => response.text())
      .then((responseText) => {
        const html = new DOMParser().parseFromString(responseText, "text/html");
        const pcardSource = this.getProductCardFromSource(html);
        const pcardDestination = this.closest(`.product-card__wrapper[data-product-id="${this.productId}"]`);

        const updateSourceFromDestination = (selector) => {
          const source = pcardSource.querySelector(selector);
          const destination = pcardDestination.querySelector(selector);
          if (source && destination) {
            destination.replaceWith(source);
          }
        };

        if (pcardSource && pcardDestination) {
          updateSourceFromDestination(".product-card__media");
          updateSourceFromDestination(".product-card__content");
        }
      })
      .catch((error) => {
        console.error(error);
      });
  }

  getProductCardFromSource(html) {
    return html.querySelector(`.product-card__wrapper[data-product-id="${this.productId}"]`);
  }
}

if (!customElements.get("product-bundle-variant-selector")) {
  customElements.define("product-bundle-variant-selector", ProductBundleVariantSelector);
}

class TestimonialParallax extends Component {
  constructor() {
    super();
    this.scrollHandler = null;
    this.rafId = null;
    this.lenis = null; // Lenis instance for smooth scrolling
    this.intersectionObserver = null;
    this.isInViewport = false; // Track if component is in viewport
  }

  connectedCallback() {
    super.connectedCallback();

    this.#update();
    mediaQueryMobile.addEventListener("change", this.#update);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#destroy();
  }

  #update = () => {
    if (isMobileBreakpoint()) {
      this.#destroy();
    } else {
      this.#init();
    }
  };

  #init() {
    this.#setupIntersectionObserver();
    this.#handleItemsAnimation();
  }

  #setupIntersectionObserver() {
    // Setup IntersectionObserver to only animate when in viewport
    // This significantly reduces performance impact when scrolling past the component
    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        this.isInViewport = entries[0].isIntersecting;

        // Trigger initial update when entering viewport
        if (this.isInViewport) {
          requestAnimationFrame(() => {
            this.#updateItemsAnimation();
          });
        }
      },
      {
        rootMargin: "100px", // Start animating slightly before entering viewport
      }
    );

    this.intersectionObserver.observe(this);
  }

  #handleItemsAnimation() {
    const { items } = this.refs;

    if (!items.length) return;

    // Use Lenis smooth scroll if available, otherwise fallback to native scroll
    this.lenis = getLenis();

    // Setup scroll handler
    this.scrollHandler = () => {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
      }

      this.rafId = requestAnimationFrame(() => {
        this.#updateItemsAnimation();
        this.rafId = null;
      });
    };

    if (this.lenis) {
      // Listen to Lenis scroll events (shared instance with other sections)
      this.lenis.on("scroll", this.scrollHandler);
    } else {
      // Fallback to native scroll if Lenis not available yet
      window.addEventListener("scroll", this.scrollHandler, { passive: true });
    }

    // Initial update
    requestAnimationFrame(() => {
      this.#updateItemsAnimation();
    });
  }

  #updateItemsAnimation() {
    const { items } = this.refs;

    if (!items.length) return;

    // Skip animations if not in viewport (performance optimization)
    if (!this.isInViewport) return;

    // Try to get Lenis again if not available (in case it loaded after init)
    if (!this.lenis) {
      const retryLenis = getLenis();
      if (retryLenis) {
        this.lenis = retryLenis;
        window.removeEventListener("scroll", this.scrollHandler);
        this.lenis.on("scroll", this.scrollHandler);
      }
    }

    // Use Lenis scroll position if available, otherwise fallback to native scroll
    const scrollTop = this.lenis ? this.lenis.scroll : window.pageYOffset || document.documentElement.scrollTop;
    const viewportHeight = window.innerHeight;

    items.forEach((item) => {
      const { begin, end } = item.dataset;

      if (!begin || !end) return;

      // Parse begin and end values (e.g., "30%", "-60%")
      const beginValue = parseFloat(begin);
      const endValue = parseFloat(end);
      const beginUnit = begin.includes("%") ? "%" : "px";
      const endUnit = end.includes("%") ? "%" : "px";

      // Calculate scroll progress for this item
      // GSAP ScrollTrigger equivalent:
      // start: "top bottom" = when item top reaches viewport bottom
      // end: "bottom top" = when item bottom reaches viewport top
      const itemRect = item.getBoundingClientRect();
      const itemTop = itemRect.top + scrollTop;
      const itemBottom = itemTop + itemRect.height;

      // Start point: scrollTop when item top is at viewport bottom
      // When itemRect.top = viewportHeight, scrollTop = itemTop - viewportHeight
      const startPoint = itemTop - viewportHeight;

      // End point: scrollTop when item bottom is at viewport top
      // When itemRect.bottom = 0, scrollTop = itemBottom
      const endPoint = itemBottom;

      const scrollRange = endPoint - startPoint;

      if (scrollRange <= 0) {
        // Before animation range, set to begin value
        const beginPx = beginUnit === "%" ? (beginValue / 100) * itemRect.height : beginValue;
        item.style.transform = `translateY(${beginPx}${beginUnit === "%" ? "%" : "px"})`;
        return;
      }

      // Calculate progress: 0 at start, 1 at end
      const progress = Math.max(0, Math.min(1, (scrollTop - startPoint) / scrollRange));

      // Interpolate between begin and end
      const beginPx = beginUnit === "%" ? (beginValue / 100) * itemRect.height : beginValue;
      const endPx = endUnit === "%" ? (endValue / 100) * itemRect.height : endValue;
      const currentY = beginPx + (endPx - beginPx) * progress;

      // Update transform
      item.style.transform = `translateY(${currentY}px)`;
    });
  }

  #destroy() {
    // Clean up IntersectionObserver
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    // Clean up scroll listener
    if (this.scrollHandler) {
      if (this.lenis) {
        // Remove Lenis scroll listener
        this.lenis.off("scroll", this.scrollHandler);
      } else {
        // Remove native scroll listener
        window.removeEventListener("scroll", this.scrollHandler);
      }
      this.scrollHandler = null;
    }

    // Cancel pending RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Reset transforms on mobile
    if (this.refs.items) {
      this.refs.items.forEach((item) => {
        item.style.transform = "";
      });
    }
  }
}

if (!customElements.get("testimonial-parallax")) {
  customElements.define("testimonial-parallax", TestimonialParallax);
}

class FlexCarousel extends CarouselComponent {
  connectedCallback() {
    super.connectedCallback();

    // Wait for parent CarouselComponent to finish Swiper initialization
    // Check if already initialized (in case event fired before our connectedCallback)
    if (this.swiperInstance) {
      this.#init();
    } else {
      // Listen for carousel:ready event
      this.addEventListener(
        "carousel:ready",
        () => {
          this.#init();
        },
        { once: true }
      );
    }
  }

  #init() {
    if (!this.swiperInstance) return;

    const EVENTS = ["reachBeginning", "reachEnd", "fromEdge"];
    const shadowsList = this.querySelectorAll(".edge__shadows");

    shadowsList.forEach((edgeEl) => {
      const isThumb = edgeEl.getAttribute("ref") === "thumbnails";
      const swiper = isThumb ? this.thumbnailSwiper : this.swiperInstance;

      edgeEl.classList.add("is--active");

      this.#updateShadow(edgeEl, swiper);

      EVENTS.forEach((evt) => {
        swiper.on(evt, () => this.#updateShadow(edgeEl, swiper));
      });
    });
  }

  #updateShadow(edgeEl, swiper) {
    edgeEl.classList.toggle("is--beginning", swiper.isBeginning);
    edgeEl.classList.toggle("is--end", swiper.isEnd);
  }
}

customElements.define("flex-carousel", FlexCarousel);

if (!customElements.get("footer-details")) {
  customElements.define(
    "footer-details",
    class FooterDetails extends HTMLDetailsElement {
      constructor() {
        super();
      }

      get accordionEl() {
        return (this._accordionEl = this._accordionEl || this.closest("accordion-component"));
      }

      connectedCallback() {
        this.openDefault = this.dataset.openDefault === "true";

        const mqlTablet = window.matchMedia("screen and (max-width: 1023px)");
        const updateOpen = (isTablet) => {
          const shouldOpen = isTablet ? this.openDefault : true;

          if (this.open === shouldOpen) return;

          // Check if accordion component exists and has refs initialized
          const accordionEl = this.accordionEl;
          if (!accordionEl || !accordionEl.refs) {
            console.warn("footer-details: accordion-component not found or refs not initialized");
            return;
          }

          const { item: items, summary: summaries, content: contents } = accordionEl.refs;

          // Fallback if refs are not available
          if (!items || !summaries || !contents) {
            // Use DOM query as fallback
            const item = this.closest("details") || this;
            const summary = item.querySelector("summary");
            const content = item.querySelector(".accordion__content");

            if (accordionEl.toggleOpen && item && summary && content) {
              accordionEl.toggleOpen({
                willOpen: shouldOpen,
                item,
                summary,
                content,
              });
            }
            return;
          }

          let idx = -1;
          if (Array.isArray(items)) idx = items.indexOf(this);

          let item = Array.isArray(items) ? items[idx] : items;
          let summary = Array.isArray(summaries) ? summaries[idx] : summaries;
          let content = Array.isArray(contents) ? contents[idx] : contents;

          if (!item || !summary || !content) return;

          accordionEl.toggleOpen({
            willOpen: shouldOpen,
            item,
            summary,
            content,
          });
        };

        updateOpen(mqlTablet.matches);
        mqlTablet.onchange = (event) => updateOpen(event.matches);
      }
    },
    { extends: "details" }
  );
}

class MarqueeComponent extends Component {
  requiredRefs = ["inner"];

  #resizeObserver;
  #scrollStop = null;
  #inViewStop = null;
  #intersectionObserver = null;
  #previousWidth = 0;

  static #PAUSE_OBSERVER_MARGIN = "0px 0px 50px 0px";
  static #MIN_COPIES = 5;
  static #COPY_WIDTH_ESTIMATE = 200;
  static #DURATION_MULTIPLIER = 33;
  static #DURATION_MAX_RATIO = 2.5;
  static #DEFAULT_DURATION = "20s";
  static #DEFAULT_PARALLAX = 0.55;
  static #RESIZE_DEBOUNCE = 200;

  connectedCallback() {
    super.connectedCallback();
    if (prefersReducedMotion()) return;

    this.isRTL = false;

    // Init immediately to prevent layout shift when scrolling
    // Defer slightly to avoid blocking page load
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(
        () => {
          this.#init();
        },
        { timeout: 1000 }
      );
    } else {
      // Fallback: use setTimeout for browsers without requestIdleCallback
      setTimeout(() => {
        this.#init();
      }, 100);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.#cleanup();
  }

  #init() {
    const { inner } = this.refs;
    if (!inner) return;

    const item = inner.firstElementChild;
    if (!item) return;

    // Defer all initialization to avoid force reflow during page load
    requestAnimationFrame(() => {
      // Batch all layout reads
      const height = this.offsetHeight;
      const isRotated = this.classList.contains("marquee--rotated");
      const childWidth = this.#getChildWidthSync(inner);
      const parentWidth = this.#getParentWidthSync();

      // Perform non-layout operations
      item.classList.add("animate");

      // Set animation duration with cached values
      this.#setAnimationDurationWithValues(childWidth, parentWidth);

      // Set height and rotate offset with cached values
      this.style.setProperty("--block-height", `${height}px`);
      if (isRotated) {
        this.#setRotateOffsetWithHeight(height);
      } else {
        this.style.setProperty("--offset", "0px");
      }

      this.#adjustItemCount();
      this.#previousWidth = parentWidth;

      if (this.parallax) {
        this.#initParallax();
        requestAnimationFrame(() => {
          this.#adjustItemCount();
        });
      } else {
        this.#initPauseObserver();
      }

      this.#setupResizeObserver();
    });
  }

  #getChildWidthSync(inner) {
    const item = inner?.firstElementChild;
    if (!item) return 1;
    const rect = item.getBoundingClientRect();
    return rect.right - rect.left;
  }

  #getParentWidthSync() {
    const rect = this.getBoundingClientRect();
    return rect.right - rect.left;
  }

  #setAnimationDurationWithValues(childWidth, parentWidth) {
    const liquidDuration = this.duration;
    if (liquidDuration && liquidDuration > 0) {
      this.style.setProperty("--duration", `${liquidDuration}s`);
      return;
    }

    if (childWidth > 0 && parentWidth > 0) {
      const ratio = Math.ceil(childWidth / parentWidth);
      const defaultSpeed = 16;
      const duration =
        (MarqueeComponent.#DURATION_MULTIPLIER - defaultSpeed) * Math.min(MarqueeComponent.#DURATION_MAX_RATIO, ratio);
      this.style.setProperty("--duration", `${duration}s`);
    } else {
      this.style.setProperty("--duration", MarqueeComponent.#DEFAULT_DURATION);
    }
  }

  #cleanup() {
    this.#resizeObserver?.disconnect();
    window.removeEventListener("resize", this.#handleResize);
    this.#intersectionObserver?.disconnect();
    this.#inViewStop?.();
    this.#scrollStop?.();
    this.#intersectionObserver = null;
    this.#inViewStop = null;
    this.#scrollStop = null;
  }

  #setAnimationDuration() {
    const liquidDuration = this.duration;
    if (liquidDuration && liquidDuration > 0) {
      this.style.setProperty("--duration", `${liquidDuration}s`);
      return;
    }

    const childWidth = this.childElementWidth;
    const parentWidth = this.parentWidth;

    if (childWidth > 0 && parentWidth > 0) {
      const ratio = Math.ceil(childWidth / parentWidth);
      const defaultSpeed = 16;
      const duration =
        (MarqueeComponent.#DURATION_MULTIPLIER - defaultSpeed) * Math.min(MarqueeComponent.#DURATION_MAX_RATIO, ratio);
      this.style.setProperty("--duration", `${duration}s`);
    } else {
      this.style.setProperty("--duration", MarqueeComponent.#DEFAULT_DURATION);
    }
  }

  #adjustItemCount(resetAll = false) {
    const { inner } = this.refs;
    if (!inner) return;

    const currentCount = inner.children.length;
    if (currentCount === 0) return;

    const originalItem = inner.firstElementChild;
    if (!originalItem) return;

    if (resetAll && currentCount > 1) {
      while (inner.children.length > 1) {
        inner.lastElementChild?.remove();
      }
    }

    if (inner.children.length === 1) {
      const conservativeCount = Math.max(
        MarqueeComponent.#MIN_COPIES,
        Math.ceil(window.innerWidth / MarqueeComponent.#COPY_WIDTH_ESTIMATE) + 2
      );
      // Batch DOM operations to reduce layout shifts
      // Use DocumentFragment to batch appends
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < conservativeCount - 1; i++) {
        const clone = originalItem.cloneNode(true);
        this.#disableFocusableElements(clone);
        clone.setAttribute("aria-hidden", "true");
        clone.classList.add("animate");
        fragment.appendChild(clone);
      }
      inner.appendChild(fragment);
      // Handle images after DOM update to prevent flicker
      requestAnimationFrame(() => {
        inner.querySelectorAll(".marquee__items:not(:first-child) .media").forEach((media) => {
          const img = media.querySelector("img.media__image");
          if (img && img.complete && img.naturalWidth > 0) {
            media.classList.remove("loading");
            if (img.classList.contains("loading")) {
              img.classList.remove("loading");
              img.classList.add("loaded");
            }
          }
        });
      });
    }

    const exactCount = this.#calculateNumberOfCopies();
    const finalCount = inner.children.length;

    if (exactCount > finalCount) {
      this.#addRepeatedItems(exactCount - finalCount, originalItem);
    } else if (exactCount < finalCount) {
      const itemsToRemove = Math.min(finalCount - exactCount, finalCount - 1);
      this.#removeRepeatedItems(itemsToRemove);
    }

    if (!this.hasAttribute("data-duration")) {
      this.#setAnimationDuration();
    }
  }

  #addRepeatedItems(numberOfCopies, templateItem = null) {
    const { inner } = this.refs;
    if (!inner) return;

    const item = templateItem || inner.firstElementChild;
    if (!item) return;

    for (let i = 0; i < numberOfCopies; i++) {
      this.#cloneItem(item, inner);
    }
  }

  #removeRepeatedItems(numberOfCopies) {
    const { inner } = this.refs;
    if (!inner) return;

    for (let i = 0; i < numberOfCopies; i++) {
      inner.lastElementChild?.remove();
    }
  }

  #cloneItem(item, container) {
    const clone = item.cloneNode(true);
    this.#disableFocusableElements(clone);
    clone.setAttribute("aria-hidden", "true");
    clone.classList.add("animate");
    container.appendChild(clone);

    // Handle images in cloned items to prevent flicker
    // Only remove loading class if images are already loaded
    clone.querySelectorAll(".media").forEach((media) => {
      const img = media.querySelector("img.media__image");
      if (img && img.complete && img.naturalWidth > 0) {
        // Image is already loaded, safe to remove loading class
        media.classList.remove("loading");
        if (img.classList.contains("loading")) {
          img.classList.remove("loading");
          img.classList.add("loaded");
        }
      }
      // If image is not loaded yet, keep loading class to prevent flicker
      // responsive-image will handle removing it when image loads
    });
  }

  #getFocusableElements(wrapperEl) {
    const focusableSelectors = "a[href], button:enabled, [tabindex]:not([tabindex^='-'])";
    const focusableElements = wrapperEl.querySelectorAll(focusableSelectors);

    return focusableElements;
  }

  #disableFocusableElements(wrapperEl) {
    const focusableElements = this.#getFocusableElements(wrapperEl);

    focusableElements &&
      focusableElements.forEach((el) => {
        el.setAttribute("tabindex", "-1");
      });
  }

  #calculateNumberOfCopies() {
    const childWidth = this.childElementWidth;
    const parentWidth = this.parentWidth;

    if (childWidth <= 0 || parentWidth <= 0) {
      return MarqueeComponent.#MIN_COPIES;
    }

    const baseCopies = Math.ceil(parentWidth / childWidth);

    if (this.parallax) {
      const parallaxValue = this.#parseParallaxValue();
      const parallaxTranslate = Math.abs((parallaxValue * 100) / (1 + parallaxValue));
      const parallaxMultiplier = 1.5;
      const extraCopies = Math.ceil(parallaxTranslate / 10) + 4;
      return Math.ceil(baseCopies * parallaxMultiplier) + extraCopies;
    }

    return baseCopies + 2;
  }

  #initParallax() {
    this.#createParallaxAnimation();
    this.#initParallaxPauseObserver();
  }

  #createParallaxAnimation() {
    const parallaxValue = this.#parseParallaxValue();
    let translate = this.#calculateParallaxTranslate(parallaxValue);

    this.#scrollStop = scroll(
      animate(this.refs.inner, { transform: [`translateX(${translate}%)`, `translateX(0)`] }, { easing: "linear" }),
      {
        target: this,
        offset: ["start end", "end start"],
      }
    );
  }

  #parseParallaxValue() {
    const parallaxAttr = this.getAttribute("data-parallax");
    if (!parallaxAttr || parallaxAttr === "false") return 0;
    if (parallaxAttr === "true") return MarqueeComponent.#DEFAULT_PARALLAX;
    return parseFloat(parallaxAttr);
  }

  #calculateParallaxTranslate(parallaxValue) {
    let translate = (parallaxValue * 100) / (1 + parallaxValue);
    const isReverse = this.direction === "reverse" || this.direction === "right";

    if (!isReverse) {
      translate *= -1;
    }

    if (this.isRTL) {
      translate *= -1;
    }

    return translate;
  }

  #initParallaxPauseObserver() {
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            this.#pauseParallax();
          } else {
            this.#resumeParallax();
          }
        });
      },
      {
        rootMargin: MarqueeComponent.#PAUSE_OBSERVER_MARGIN,
      }
    );
    this.#intersectionObserver.observe(this);
  }

  #pauseParallax() {
    this.classList.add("paused");
    if (this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
    }
  }

  #resumeParallax() {
    this.classList.remove("paused");
    if (!this.#scrollStop) {
      this.#createParallaxAnimation();
    }
  }

  #initPauseObserver() {
    this.#intersectionObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            this.classList.remove("paused");
          } else {
            this.classList.add("paused");
          }
        });
      },
      {
        rootMargin: MarqueeComponent.#PAUSE_OBSERVER_MARGIN,
      }
    );
    this.#intersectionObserver.observe(this);
  }

  #setupResizeObserver() {
    this.#resizeObserver = new ResizeObserver(() => this.#setHeight());
    this.#resizeObserver.observe(this);
    window.addEventListener("resize", this.#handleResize);
  }

  #handleResize = debounce(() => {
    const currentWidth = this.parentWidth;
    if (currentWidth === this.#previousWidth) return;

    this.#previousWidth = currentWidth;

    const { inner } = this.refs;
    if (!inner) return;

    const allItemsElements = inner.querySelectorAll(".marquee__items");
    allItemsElements.forEach((el) => {
      el.classList.remove("animate");
      el.style.transform = "";
    });

    if (this.parallax && this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
      inner.style.transform = "";
    }

    this.#adjustItemCount(true);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const currentItemsElements = inner.querySelectorAll(".marquee__items");
        currentItemsElements.forEach((el) => {
          el.classList.add("animate");
          el.style.transform = "";
        });

        if (this.parallax) {
          this.#createParallaxAnimation();
        }
      });
    });
  }, MarqueeComponent.#RESIZE_DEBOUNCE);

  #setHeight() {
    // Called from ResizeObserver, batch reads and writes
    const height = this.offsetHeight;
    const isRotated = this.classList.contains("marquee--rotated");

    // Batch writes after all reads
    this.style.setProperty("--block-height", `${height}px`);

    if (isRotated) {
      this.#setRotateOffsetWithHeight(height);
    } else {
      this.style.setProperty("--offset", "0px");
    }
  }

  #setRotateOffsetWithHeight(blockHeight) {
    const angleDeg =
      parseFloat(this.style.getPropertyValue("--angle-raw")) || parseFloat(this.style.getPropertyValue("--angle")) || 0;

    if (angleDeg === 0) {
      this.style.setProperty("--offset", "0px");
      return;
    }

    const angleRad = (Math.abs(angleDeg) * Math.PI) / 180;
    const offset = blockHeight * Math.tan(angleRad);

    this.style.setProperty("--offset", `${offset}px`);
  }

  #setRotateOffset() {
    // Legacy method - kept for compatibility
    // Now handled inline in #setHeight() to avoid double rAF
    if (!this.classList.contains("marquee--rotated")) {
      this.style.setProperty("--offset", "0px");
      return;
    }

    const angleDeg =
      parseFloat(this.style.getPropertyValue("--angle-raw")) || parseFloat(this.style.getPropertyValue("--angle")) || 0;
    if (angleDeg === 0) {
      this.style.setProperty("--offset", "0px");
      return;
    }

    const angleRad = (Math.abs(angleDeg) * Math.PI) / 180;
    const blockHeight = this.offsetHeight || parseFloat(this.style.getPropertyValue("--block-height")) || 0;
    const offset = blockHeight * Math.tan(angleRad);

    this.style.setProperty("--offset", `${offset}px`);
  }

  onPause() {
    this.classList.add("paused");
    if (this.parallax && this.#scrollStop) {
      this.#scrollStop();
      this.#scrollStop = null;
    }
  }

  onPlay() {
    this.classList.remove("paused");
    if (this.parallax && !this.#scrollStop) {
      this.#createParallaxAnimation();
    }
  }

  get direction() {
    return this.getAttribute("data-direction") || "forward";
  }

  get duration() {
    if (!this.hasAttribute("data-duration")) return null;
    const value = parseFloat(this.getAttribute("data-duration"));
    return isNaN(value) ? null : value;
  }

  get parallax() {
    if (isTouch()) return false;
    return this.#parseParallaxValue();
  }

  get parentWidth() {
    const rect = this.getBoundingClientRect();
    return rect.right - rect.left;
  }

  get childElementWidth() {
    const { inner } = this.refs;
    const item = inner?.firstElementChild;
    if (!item) return 1;
    const rect = item.getBoundingClientRect();
    return rect.right - rect.left;
  }
}

if (!customElements.get("marquee-component")) {
  customElements.define("marquee-component", MarqueeComponent);
}
