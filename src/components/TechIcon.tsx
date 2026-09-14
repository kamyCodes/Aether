import React from 'react';
import { lookupTechIcon } from '../lib/techIconMap';

export type { TechIconDef } from '../lib/techIconMap';

/**
 * <TechIcon name="typescript" size={20} /> — renders the Simple Icons brand
 * glyph with its official color. Falls back to a neutral code-file glyph when
 * the name isn't recognized. Only the icons referenced in techIconMap.ts are
 * bundled (named imports + ESM tree-shaking).
 */
export function TechIcon({
  name,
  size = 20,
  color,
  className,
  title,
}: {
  name: string;
  /** Rendered size in px (square). */
  size?: number;
  /** Optional color override; defaults to the brand's official color. */
  color?: string;
  className?: string;
  title?: string;
}) {
  const def = lookupTechIcon(name);

  if (def) {
    const Icon = def.icon;
    return (
      <span
        className={className ? `tech-icon ${className}` : 'tech-icon'}
        title={title ?? name}
        style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}
      >
        <Icon size={size} color={color ?? def.color} />
      </span>
    );
  }

  // Fallback: generic code-file glyph in the current text color.
  return (
    <span
      className={
        className ? `tech-icon tech-icon-fallback ${className}` : 'tech-icon tech-icon-fallback'
      }
      title={title ?? name}
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        flexShrink: 0,
        color: color ?? 'currentColor',
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M4 1.5H9.5L12.5 4.5V14.5H4V1.5Z"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <path
          d="M9.5 1.5V4.5H12.5"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <path
          d="M6.2 8.2L7.8 9.8L6.2 11.4M9.8 8.2L8.2 9.8L9.8 11.4"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
