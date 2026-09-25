/*
  Comforsh scroll motion.

  Two effects, both opt-in via data attributes so sections stay in control:
    data-cf-reveal="up|left|right|zoom"  fade + move in when scrolled into view
    data-cf-parallax="0.15"              drift the element against the scroll

  The .cf-ready class on <html> is what actually hides revealable elements (see
  comforsh-motion.css). It is only added when this script runs and the visitor
  has not asked for reduced motion, so a JS failure leaves the page fully
  visible rather than blank.
*/
(function () {
  'use strict';

  var root = document.documentElement;
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (reduced.matches || !('IntersectionObserver' in window)) return;

  root.classList.add('cf-ready');

  /* ---------------------------------------------------------------- reveal */

  var revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.classList.add('cf-in');
        revealObserver.unobserve(el);

        // Free the compositor layer once the transition has finished.
        el.addEventListener(
          'transitionend',
          function () { el.classList.add('cf-done'); },
          { once: true }
        );
      });
    },
    // Start slightly before the element is fully on screen so the motion
    // finishes about when the reader gets there.
    { rootMargin: '0px 0px -12% 0px', threshold: 0.05 }
  );

  function indexSiblings(el) {
    // Cards inside the same parent cascade instead of all firing at once.
    if (el.style.getPropertyValue('--cf-index')) return;
    var parent = el.parentElement;
    if (!parent) return;
    var siblings = Array.prototype.filter.call(parent.children, function (child) {
      return child.hasAttribute && child.hasAttribute('data-cf-reveal');
    });
    if (siblings.length < 2) return;
    var i = siblings.indexOf(el);
    // Cap the cascade so a long grid never leaves the last card lagging.
    if (i > 0) el.style.setProperty('--cf-index', String(Math.min(i, 6)));
  }

  function bindReveals(scope) {
    (scope || document).querySelectorAll('[data-cf-reveal]').forEach(function (el) {
      if (el.dataset.cfBound) return;
      el.dataset.cfBound = '1';
      indexSiblings(el);
      revealObserver.observe(el);
    });
  }

  /* -------------------------------------------------------------- parallax */

  var parallaxItems = [];
  var ticking = false;

  function measure(el) {
    var rect = el.getBoundingClientRect();
    return {
      el: el,
      speed: parseFloat(el.dataset.cfParallax) || 0.15,
      top: rect.top + window.scrollY,
      height: rect.height,
    };
  }

  function paint() {
    ticking = false;
    var viewportH = window.innerHeight;
    var scrollY = window.scrollY;

    parallaxItems.forEach(function (item) {
      // Skip anything off screen; no point paying for transforms nobody sees.
      var offsetFromTop = item.top - scrollY;
      if (offsetFromTop > viewportH || offsetFromTop + item.height < 0) return;

      // -1 when the element is entering from below, +1 when it has passed.
      var progress = (offsetFromTop + item.height / 2 - viewportH / 2) / viewportH;
      var shift = -progress * item.height * item.speed;
      item.el.style.setProperty('--cf-shift', shift.toFixed(1) + 'px');
    });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(paint);
  }

  function bindParallax(scope) {
    // The class hook exists because Liquid's image_tag filter cannot emit a
    // hyphenated data attribute, but it can append a class.
    var selector = '[data-cf-parallax], .cf-parallax';
    (scope || document).querySelectorAll(selector).forEach(function (el) {
      if (el.dataset.cfBound) return;
      el.dataset.cfBound = '1';
      parallaxItems.push(measure(el));
    });
    if (parallaxItems.length) onScroll();
  }

  function remeasure() {
    parallaxItems = parallaxItems.map(function (item) {
      item.el.style.removeProperty('--cf-shift');
      return measure(item.el);
    });
    onScroll();
  }

  /* ------------------------------------------------------------------ init */

  function init(scope) {
    bindReveals(scope);
    bindParallax(scope);
  }

  init(document);

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', remeasure, { passive: true });

  // The theme editor swaps section markup in without a page load.
  document.addEventListener('shopify:section:load', function (event) {
    init(event.target);
    remeasure();
  });

  // If the visitor turns reduced motion on mid-session, stop immediately.
  var onPreferenceChange = function (event) {
    if (!event.matches) return;
    root.classList.remove('cf-ready');
    parallaxItems.forEach(function (item) {
      item.el.style.removeProperty('--cf-shift');
    });
    parallaxItems = [];
    revealObserver.disconnect();
  };

  if (reduced.addEventListener) reduced.addEventListener('change', onPreferenceChange);
  else if (reduced.addListener) reduced.addListener(onPreferenceChange);
})();
