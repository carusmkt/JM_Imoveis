/* Adapted for the static DOM from React Bits AnimatedContent (David Haz).
 * https://github.com/DavidHDev/react-bits/blob/main/src/content/Animations/AnimatedContent/AnimatedContent.jsx
 * MIT + Commons Clause; full notice in THIRD_PARTY_NOTICES.md.
 * Keep its short offset/opacity/scale reveal and reduced-motion guard, using the
 * native Web Animations API instead of adding GSAP to this static site.
 * Content is visible by default; animation never delays a task or gates a form.
 */
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const observer = new MutationObserver(records => {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      for (const { target, attributeName, oldValue } of records) {
        const opening = attributeName === 'open' ? target.open && oldValue === null : !target.hidden && oldValue !== null;
        if (!opening) continue;
        target.getAnimations().forEach(animation => animation.cancel());
        target.animate([
          { opacity: 0.7, transform: 'translateY(6px) scale(.99)' },
          { opacity: 1, transform: 'translateY(0) scale(1)' }
        ], { duration: 180, easing: 'cubic-bezier(.22, 1, .36, 1)' });
      }
    });
    ['selection-bar', 'move-dialog', 'photo-dialog', 'property-dialog'].forEach(id => {
      observer.observe(document.getElementById(id), { attributes: true, attributeOldValue: true, attributeFilter: ['open', 'hidden'] });
    });
  });
})();
