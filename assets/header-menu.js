import { Component } from '@theme/component';
import { debounce, onDocumentLoaded, setHeaderMenuStyle } from '@theme/utilities';
import { MegaMenuHoverEvent } from '@theme/events';

/** Grace period for the pointer to reach an open submenu, in ms. */
const SUBMENU_CLOSE_DELAY = 240;

/**
 * A custom element that manages a header menu.
 *
 * @typedef {Object} State
 * @property {HTMLElement | null} activeItem - The currently active menu item.
 *
 * @typedef {object} Refs
 * @property {HTMLElement} overflowMenu - The overflow menu.
 * @property {HTMLElement[]} [submenu] - The submenu in each respective menu item.
 *
 * @extends {Component<Refs>}
 */
class HeaderMenu extends Component {
  requiredRefs = ['overflowMenu'];

  /**
   * @type {MutationObserver | null}
   */
  #submenuMutationObserver = null;

  /**
   * Pending close, so the pointer can cross the gap between a menu item and the
   * panel that opens below the header row without the panel vanishing.
   * @type {ReturnType<typeof setTimeout> | null}
   */
  #closeTimer = null;

  connectedCallback() {
    super.connectedCallback();

    this.overflowMenu?.addEventListener('pointerleave', () => this.#deactivate());

    // Reaching the panel cancels the pending close; leaving it starts a new one.
    for (const submenu of this.refs.submenu ?? []) {
      submenu.addEventListener('pointerenter', this.#clearCloseTimer);
      submenu.addEventListener('pointerleave', () => this.#scheduleDeactivate());
    }
    // on load, cache the max height of the submenu so you can use it in a translate
    this.#cacheMaxOverflowMenuHeight();

    onDocumentLoaded(this.#preloadImages);
    window.addEventListener('resize', this.#resizeListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('resize', this.#resizeListener);
    this.#cleanupMutationObserver();
    this.#clearCloseTimer();
  }

  #clearCloseTimer = () => {
    if (this.#closeTimer == null) return;

    clearTimeout(this.#closeTimer);
    this.#closeTimer = null;
  };

  /**
   * Close the open submenu, but only once the pointer has had time to travel
   * into it.
   * @param {HTMLElement | null} [item]
   */
  #scheduleDeactivate = (item = this.#state.activeItem) => {
    this.#clearCloseTimer();

    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null;

      const submenu = item ? findSubmenu(item) : null;

      // The pointer landed on the panel or came back to the item after all.
      if (item?.matches(':hover') || submenu?.matches(':hover')) return;

      this.#deactivate(item);
    }, SUBMENU_CLOSE_DELAY);
  };

  /**
   * Debounced resize event listener to recalculate menu style
   */
  #resizeListener = debounce(() => {
    this.#cacheMaxOverflowMenuHeight();
    setHeaderMenuStyle();
  }, 100);

  /**
   * @type {State}
   */
  #state = {
    activeItem: null,
  };

  /**
   * Get the overflow menu
   */
  get overflowMenu() {
    return /** @type {HTMLElement | null} */ (this.refs.overflowMenu?.shadowRoot?.querySelector('[part="overflow"]'));
  }

  /**
   * Whether the overflow menu is hovered
   * @returns {boolean}
   */
  get overflowHovered() {
    return this.refs.overflowMenu?.matches(':hover') ?? false;
  }

  get headerComponent() {
    return /** @type {HTMLElement | null} */ (this.closest('header-component'));
  }

  /**
   * Activate the selected menu item immediately
   * @param {PointerEvent | FocusEvent} event
   */
  activate = (event) => {
    this.dispatchEvent(new MegaMenuHoverEvent());

    // Before the early returns below — re-entering the item that is already
    // open still has to call off a close that is queued up.
    this.#clearCloseTimer();

    if (!(event.target instanceof Element)) return;

    let item = findMenuItem(event.target);

    if (!item || item == this.#state.activeItem) return;

    const isDefaultSlot = event.target.slot === '';

    this.dataset.overflowExpanded = (!isDefaultSlot).toString();

    const previouslyActiveItem = this.#state.activeItem;

    if (previouslyActiveItem) {
      previouslyActiveItem.ariaExpanded = 'false';
    }

    this.#state.activeItem = item;
    this.ariaExpanded = 'true';
    item.ariaExpanded = 'true';

    let submenu = findSubmenu(item);

    if (!submenu && !isDefaultSlot) {
      submenu = this.overflowMenu;
    }

    if (submenu) {
      // Mark submenu as active for content-visibility optimization
      submenu.dataset.active = '';

      // Cleanup any existing mutation observer from previous menu activations
      this.#cleanupMutationObserver();

      // Monitor DOM mutations to catch deferred content injection (from section hydration)
      this.#submenuMutationObserver = new MutationObserver(() => {
        requestAnimationFrame(() => {
          // Double requestAnimationFrame to ensure the height is properly calculated and not defaulting to the contain-intrinsic-size
          requestAnimationFrame(() => {
            if (submenu.offsetHeight > 0) {
              this.headerComponent?.style.setProperty('--submenu-height', `${submenu.offsetHeight}px`);
              this.#cleanupMutationObserver();
            }
          });
        });
      });
      this.#submenuMutationObserver.observe(submenu, {childList: true, subtree: true});

      // Auto-disconnect after 500ms to prevent memory leaks
      setTimeout(() => {
        this.#cleanupMutationObserver();
      }, 500);
    }

    const submenuHeight = submenu ? submenu.offsetHeight : 0;

    this.headerComponent?.style.setProperty('--submenu-height', `${submenuHeight}px`);
    this.style.setProperty('--submenu-opacity', '1');
  };

  /**
   * Deactivate the active item after a delay
   * @param {PointerEvent | FocusEvent} event
   */
  deactivate(event) {
    if (!(event.target instanceof Element)) return;

    const menu = findSubmenu(this.#state.activeItem);
    const isMovingWithinMenu = event.relatedTarget instanceof Node && menu?.contains(document.activeElement);
    // Was restricted to event.type === 'blur', so a pointer moving straight
    // into the panel never matched and the panel closed under the cursor.
    const isMovingToSubmenu = event.relatedTarget instanceof Node && menu?.contains(event.relatedTarget);
    const isMovingToOverflowMenu =
      event.relatedTarget instanceof Node && event.relatedTarget.parentElement?.matches('[slot="overflow"]');

    if (isMovingWithinMenu || isMovingToOverflowMenu || isMovingToSubmenu) return;

    this.#scheduleDeactivate();
  }

  /**
   * Deactivate the active item immediately
   * @param {HTMLElement | null} [item]
   */
  #deactivate = (item = this.#state.activeItem) => {
    if (!item || item != this.#state.activeItem) return;
    if (this.overflowHovered) return;

    this.headerComponent?.style.setProperty('--submenu-height', '0px');
    this.style.setProperty('--submenu-opacity', '0');
    this.dataset.overflowExpanded = 'false';

    const submenu = findSubmenu(item);

    this.#state.activeItem = null;
    this.ariaExpanded = 'false';
    item.ariaExpanded = 'false';

    // Remove active state from submenu after animation completes
    if (submenu) {
      delete submenu.dataset.active;
    }
  };

  /**
   * Preload images that are set to load lazily.
   */
  #preloadImages = () => {
    const images = this.querySelectorAll('img[loading="lazy"]');
    images?.forEach((image) => image.removeAttribute('loading'));
  };

  /**
   * Caches the maximum height of all submenus for consistent animations
   * Stores the value in a CSS custom property for use in transitions
   */
  #cacheMaxOverflowMenuHeight() {
    const submenus = this.querySelectorAll('[ref="submenu[]"]');
    const maxHeight = Math.max(
      ...Array.from(submenus)
        .filter((submenu) => submenu instanceof HTMLElement)
        .map((submenu) => submenu.offsetHeight)
    );
    this.headerComponent?.style.setProperty('--submenu-max-height', `${maxHeight}px`);
  }

  #cleanupMutationObserver() {
    this.#submenuMutationObserver?.disconnect();
    this.#submenuMutationObserver = null;
  }
}

if (!customElements.get('header-menu')) {
  customElements.define('header-menu', HeaderMenu);
}

/**
 * Find the closest menu item.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findMenuItem(element) {
  if (!(element instanceof Element)) return null;

  if (element?.matches('[slot="more"')) {
    // Select the first overflowing menu item when hovering over the "More" item
    return findMenuItem(element.parentElement?.querySelector('[slot="overflow"]'));
  }

  return element?.querySelector('[ref="menuitem"]');
}

/**
 * Find the closest submenu.
 * @param {Element | null | undefined} element
 * @returns {HTMLElement | null}
 */
function findSubmenu(element) {
  const submenu = element?.parentElement?.querySelector('[ref="submenu[]"]');
  return submenu instanceof HTMLElement ? submenu : null;
}
