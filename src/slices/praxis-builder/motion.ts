// Whether the person using Quay asks for reduced motion, which the builder's canvases read before
// they animate a pan, a zoom or a fit of the view: with it, the view moves at once.

/** True when the system asks for reduced motion. */
export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
