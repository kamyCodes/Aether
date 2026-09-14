import React from 'react';

/**
 * Aether prism mark — compact variant of the brand tile for small sizes:
 * a beam of light enters a prism and disperses into gold, violet, and
 * periwinkle. Geometry zoomed so the prism fills the frame; bold strokes
 * keep it legible at titlebar size.
 */
export function AetherMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="ae-edge" x1="0.2" y1="1" x2="0.8" y2="0">
          <stop offset="0" stopColor="#D9E4EF" />
          <stop offset="0.55" stopColor="#C7D3E2" />
          <stop offset="1" stopColor="#C9A75B" />
        </linearGradient>
        <linearGradient id="ae-beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8FA6B8" stopOpacity="0.55" />
          <stop offset="1" stopColor="#D1E3ED" />
        </linearGradient>
      </defs>
      {/* entry beam */}
      <path d="M36 320 L146 310" stroke="url(#ae-beam)" strokeWidth="40" strokeLinecap="round" />
      {/* prism outline, apex lit gold */}
      <path
        d="M256 118 L418 396 L94 396 Z"
        stroke="url(#ae-edge)"
        strokeWidth="38"
        strokeLinejoin="round"
      />
      {/* internal refraction */}
      <path
        d="M150 308 L326 298"
        stroke="#8D46C0"
        strokeOpacity="0.32"
        strokeWidth="34"
        strokeLinecap="round"
      />
      {/* dispersed spectrum leaving the right face */}
      <g strokeLinecap="round">
        <path d="M362 296 L498 252" stroke="#C9A75B" strokeWidth="40" />
        <path d="M362 300 L506 300" stroke="#8D46C0" strokeWidth="40" />
        <path d="M362 304 L490 350" stroke="#7C9CFF" strokeWidth="40" />
      </g>
    </svg>
  );
}
