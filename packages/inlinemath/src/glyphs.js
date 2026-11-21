/**
 * Shapes drawn as inline SVG: parentheses, braces, the radical sign and the
 * big operators. Each is drawn in a 0..1 box with preserveAspectRatio="none"
 * and sized by CSS, so the same path serves every height.
 *
 * Filled shapes (parens, braces) keep their thickness because their width
 * stays fixed while their height stretches. Stroked shapes (√, ∫) use
 * non-scaling strokes so the line weight never changes with size.
 *
 * To restyle a shape, change its path here; nothing else depends on it.
 */

export const PATHS = {
    // Crescents: outer curve down, inner curve back up.
    '(': { fill: 'M0.92,0 C0.1,0.2 0.1,0.8 0.92,1 L1,0.975 C0.48,0.75 0.48,0.25 1,0.025 Z' },
    ')': { fill: 'M0.08,0 C0.9,0.2 0.9,0.8 0.08,1 L0,0.975 C0.52,0.75 0.52,0.25 0,0.025 Z' },
    '{': { fill: 'M1,0 C0.45,0 0.5,0.05 0.5,0.2 L0.5,0.38 C0.5,0.46 0.35,0.49 0.05,0.5 C0.35,0.51 0.5,0.54 0.5,0.62 L0.5,0.8 C0.5,0.95 0.45,1 1,1 L1,0.985 C0.68,0.985 0.64,0.95 0.64,0.8 L0.64,0.62 C0.64,0.53 0.55,0.505 0.3,0.5 C0.55,0.495 0.64,0.47 0.64,0.38 L0.64,0.2 C0.64,0.05 0.68,0.015 1,0.015 Z' },
    '}': { fill: 'M0,0 C0.55,0 0.5,0.05 0.5,0.2 L0.5,0.38 C0.5,0.46 0.65,0.49 0.95,0.5 C0.65,0.51 0.5,0.54 0.5,0.62 L0.5,0.8 C0.5,0.95 0.55,1 0,1 L0,0.985 C0.32,0.985 0.36,0.95 0.36,0.8 L0.36,0.62 C0.36,0.53 0.45,0.505 0.7,0.5 C0.45,0.495 0.36,0.47 0.36,0.38 L0.36,0.2 C0.36,0.05 0.32,0.015 0,0.015 Z' },
    // Radical: short tick, long down-stroke, long up-stroke to the top right, ending at the very top
    // (y = 0), which CSS puts on the center of the bar (.mv-hook).
    'sqrt': { stroke: 'M0,0.62 L0.18,0.55 L0.45,0.97 L0.98,0' },
    // \cancel: one stroke, bottom left to top right, stretched over what it crosses out.
    'cancel': { stroke: 'M0,1 L1,0' },
    // Integral: an S slanted to the right with small hooks at each end.
    'int': { stroke: 'M0.95,0.09 C0.9,0.01 0.72,0 0.66,0.12 C0.6,0.25 0.42,0.75 0.34,0.88 C0.28,0.99 0.1,0.99 0.05,0.91' },
    'sum': { fill: 'M0.04,0 L0.94,0 L0.98,0.24 L0.94,0.24 C0.9,0.1 0.8,0.07 0.62,0.07 L0.24,0.07 L0.58,0.5 L0.2,0.93 L0.64,0.93 C0.82,0.93 0.92,0.9 0.95,0.76 L0.99,0.76 L0.94,1 L0.02,1 L0.47,0.47 Z' },
    'prod': { fill: 'M0,0 L1,0 L1,0.04 L0.88,0.05 L0.88,0.95 L1,0.96 L1,1 L0.62,1 L0.62,0.96 L0.74,0.95 L0.74,0.06 L0.26,0.06 L0.26,0.95 L0.38,0.96 L0.38,1 L0,1 L0,0.96 L0.12,0.95 L0.12,0.05 L0,0.04 Z' },
};

/**
 * An SVG element for a shape. `style` sizes and places it (width, height,
 * vertical-align or absolute position).
 */
export function svg(name, cls, style = '') {
    const shape = PATHS[name];
    const path = shape.fill
        ? `<path d="${shape.fill}" fill="currentColor"/>`
        : `<path d="${shape.stroke}" fill="none" stroke="currentColor" vector-effect="non-scaling-stroke"/>`;
    const attr = style ? ` style="${style}"` : '';
    return `<svg class="${cls}" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"${attr}>${path}</svg>`;
}
