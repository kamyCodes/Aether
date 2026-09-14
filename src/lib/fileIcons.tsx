import React from 'react';

/**
 * Seti-style colored file-type icons rendered as lightweight inline SVG glyphs.
 * Each language family gets its own accent color (Seti palette) and a small
 * geometric mark, so icons read at 14px and stay weight-matched with UI text.
 */

export interface FileIconDef {
  /** Short text monogram for extensions without a dedicated glyph. */
  text?: string;
  /** Seti-style accent color. */
  color: string;
  /** Optional custom SVG mark drawn in a 16x16 viewBox (stroke only). */
  svg?: (props: { size: number; color: string }) => React.ReactElement;
}

const S = (size: number) => ({ width: size, height: size, viewBox: '0 0 16 16', fill: 'none' as const, xmlns: 'http://www.w3.org/2000/svg' });

/** Stroke-width 1.5 keeps glyphs optically consistent with lucide 12-14px icons. */
const stroke = { strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const fileIconDefs: Record<string, FileIconDef> = {
  ts: {
    color: '#519aba',
    text: 'TS',
  },
  tsx: {
    color: '#519aba',
    text: 'TS',
  },
  js: {
    color: '#cbcb41',
    text: 'JS',
  },
  jsx: {
    color: '#cbcb41',
    text: 'JS',
  },
  mjs: { color: '#cbcb41', text: 'JS' },
  cjs: { color: '#cbcb41', text: 'JS' },
  json: {
    color: '#cbcb41',
    svg: ({ size, color }) => (
      <svg {...S(size)}>
        <path d="M5 3C3.5 3 4 8 2.5 8C4 8 3.5 13 5 13" stroke={color} {...stroke} />
        <path d="M11 3C12.5 3 12 8 13.5 8C12 8 12.5 13 11 13" stroke={color} {...stroke} />
      </svg>
    ),
  },
  md: {
    color: '#519aba',
    svg: ({ size, color }) => (
      <svg {...S(size)}>
        <rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke={color} {...stroke} />
        <path d="M4 10V6L6 8.5L8 6V10" stroke={color} {...stroke} />
        <path d="M10.5 6V10M10.5 10L9.5 9M10.5 10L11.5 9" stroke={color} {...stroke} />
      </svg>
    ),
  },
  css: {
    color: '#519aba',
    text: '#',
  },
  scss: { color: '#e37933', text: 'S' },
  html: {
    color: '#e37933',
    svg: ({ size, color }) => (
      <svg {...S(size)}>
        <path d="M3 2.5L4 13L8 14L12 13L13 2.5H3Z" stroke={color} {...stroke} />
        <path d="M5.5 5.5H10.5L10.2 8H5.8L6 10.2L8 10.8L10 10.2" stroke={color} {...stroke} />
      </svg>
    ),
  },
  vue: { color: '#8dc149', text: 'V' },
  svelte: { color: '#e35733', text: 'S' },
  py: {
    color: '#8dc149',
    text: 'PY',
  },
  rb: { color: '#cc3e44', text: 'RB' },
  go: {
    color: '#519aba',
    svg: ({ size, color }) => (
      <svg {...S(size)}>
        <circle cx="8" cy="8" r="5.5" stroke={color} {...stroke} />
        <path d="M6 8H10" stroke={color} {...stroke} />
        <circle cx="10.5" cy="6.5" r="0.5" fill={color} />
      </svg>
    ),
  },
  rs: {
    color: '#cc3e44',
    text: 'RS',
  },
  java: { color: '#cc3e44', text: 'J' },
  kt: { color: '#a074c4', text: 'K' },
  swift: {
    color: '#e37933',
    svg: ({ size, color }) => (
      <svg {...S(size)}>
        <path d="M2.5 8L8 2.5L13.5 8L8 13.5L2.5 8Z" stroke={color} {...stroke} />
      </svg>
    ),
  },
  php: { color: '#a074c4', text: 'P' },
  c: { color: '#519aba', text: 'C' },
  h: { color: '#a074c4', text: 'H' },
  cpp: { color: '#519aba', text: 'C+' },
  cs: { color: '#519aba', text: 'C#' },
  sql: {
    color: '#e5c07b',
    svg: ({ size, color }) => (
      <svg {...S(size)}>
        <ellipse cx="8" cy="4" rx="5.5" ry="2" stroke={color} {...stroke} />
        <path d="M2.5 4V12C2.5 13.1 5 14 8 14C11 14 13.5 13.1 13.5 12V4" stroke={color} {...stroke} />
        <path d="M2.5 8C2.5 9.1 5 10 8 10C11 10 13.5 9.1 13.5 8" stroke={color} {...stroke} />
      </svg>
    ),
  },
  sh: {
    color: '#4d5a63',
    svg: ({ size, color }) => (
      <svg {...S(size)}>
        <path d="M1.5 3.5H14.5V12.5H1.5V3.5Z" stroke={color} {...stroke} />
        <path d="M4 6L6 8L4 10" stroke={color} {...stroke} />
        <path d="M7.5 10.5H11.5" stroke={color} {...stroke} />
      </svg>
    ),
  },
  yml: { color: '#a074c4', text: 'Y' },
  yaml: { color: '#a074c4', text: 'Y' },
  toml: { color: '#8b93a1', text: 'T' },
  lock: { color: '#8b93a1', svg: ({ size, color }) => (
    <svg {...S(size)}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke={color} {...stroke} />
      <path d="M5.5 7V5C5.5 3.6 6.6 2.5 8 2.5C9.4 2.5 10.5 3.6 10.5 5V7" stroke={color} {...stroke} />
    </svg>
  ) },
  svg: { color: '#8dc149', text: 'SV' },
  png: { color: '#a074c4', text: 'IM' },
  jpg: { color: '#a074c4', text: 'IM' },
  jpeg: { color: '#a074c4', text: 'IM' },
  gif: { color: '#a074c4', text: 'IM' },
  ico: { color: '#519aba', text: 'IM' },
  env: { color: '#e5c07b', text: 'EV' },
  txt: { color: '#8b93a1', text: 'TXT' },
  pdf: { color: '#cc3e44', text: 'PDF' },
  zip: { color: '#e5c07b', text: 'Z' },
  gitignore: { color: '#e37933', text: 'G' },
  dockerfile: { color: '#519aba', svg: ({ size, color }) => (
    <svg {...S(size)}>
      <rect x="2.5" y="8" width="11" height="4" rx="0.5" stroke={color} {...stroke} />
      <path d="M4.5 8V5.5M6.5 8V5.5M8.5 8V5.5M10.5 8V5.5M4.5 5.5V3.5" stroke={color} {...stroke} />
      <path d="M1.5 14C3 15 5 15 8 15C11 15 13 15 14.5 14" stroke={color} {...stroke} />
    </svg>
  ) },
};

/** Special full-filename matches (checked before extension). */
const fileNameOverrides: Record<string, keyof typeof fileIconDefs | FileIconDef> = {
  'dockerfile': 'dockerfile',
  '.gitignore': 'gitignore',
  '.env': 'env',
  '.env.local': 'env',
  '.env.development': 'env',
  '.env.production': 'env',
  'package.json': 'json',
  'tsconfig.json': 'json',
  'makefile': { color: '#8b93a1', text: 'M' },
  'license': { color: '#e5c07b', text: 'L' },
  'readme.md': 'md',
};

function defFor(name: string): FileIconDef | undefined {
  const lower = name.toLowerCase();
  const override = fileNameOverrides[lower];
  if (override) return typeof override === 'string' ? fileIconDefs[override] : override;
  const ext = lower.includes('.') ? lower.split('.').pop()! : lower;
  return fileIconDefs[ext];
}

/** Colored Seti-style icon for a file name. Falls back to a neutral doc glyph. */
export function FileIcon({ name, size = 14 }: { name: string; size?: number }) {
  const def = defFor(name);
  if (!def) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 1.5H9.5L12.5 4.5V14.5H4V1.5Z" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        <path d="M9.5 1.5V4.5H12.5" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    );
  }
  if (def.svg) return def.svg({ size, color: def.color });
  return (
    <span
      style={{
        color: def.color,
        fontSize: Math.max(8, Math.round(size * 0.58)),
        fontWeight: 700,
        fontFamily: 'var(--mono)',
        letterSpacing: '-0.02em',
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 1,
      }}
    >
      {def.text}
    </span>
  );
}
