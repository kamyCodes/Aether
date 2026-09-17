import React from 'react';

/**
 * Aether prism mark — small-size variant: a rounded dark chip backing so the
 * mark keeps its shape on any surface (the old stroke-only version collapsed
 * to a faint ~1px ghost on the dark titlebar), with the prism and its
 * dispersed spectrum drawn bold enough to survive 16px rendering.
 */
export function AetherMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="ae-edge" x1="0.2" y1="1" x2="0.8" y2="0">
          <stop offset="0" stopColor="#D9E4EF" />
          <stop offset="0.55" stopColor="#C7D3E2" />
          <stop offset="1" stopColor="#C9A75B" />
        </linearGradient>
      </defs>
      {/* chip backdrop — lifts the mark off dark chrome */}
      <rect x="24" y="24" width="464" height="464" rx="104" fill="#212A3F" />
      {/* prism outline, apex lit gold */}
      <path
        d="M256 136 L400 380 L112 380 Z"
        stroke="url(#ae-edge)"
        strokeWidth="56"
        strokeLinejoin="round"
      />
      {/* dispersed spectrum leaving the right face */}
      <g strokeLinecap="round" strokeWidth="58">
        <path d="M322 292 L462 250" stroke="#C9A75B" />
        <path d="M322 314 L476 314" stroke="#8D46C0" />
        <path d="M322 336 L456 378" stroke="#7C9CFF" />
      </g>
    </svg>
  );
}
