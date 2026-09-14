/**
 * Central alias map for tech icon lookups. Keys are lowercased before
 * lookup, so "TS", "Ts", "ts" all resolve to the same entry. Aliases cover
 * common abbreviations, file extensions, and alternate names.
 *
 * Icons come from react-icons' `si` (Simple Icons) set via named imports —
 * bundlers tree-shake everything not referenced here, so the bundle only
 * pays for the icons listed in this file.
 */
import type { IconType } from 'react-icons';
import {
  SiTypescript,
  SiJavascript,
  SiPython,
  SiReact,
  SiVuedotjs,
  SiSvelte,
  SiNodedotjs,
  SiNextdotjs,
  SiDeno,
  SiBun,
  SiVite,
  SiWebpack,
  SiEsbuild,
  SiRollupdotjs,
  SiBabel,
  SiJest,
  SiVitest,
  SiCypress,
  SiGooglechrome,
  SiTailwindcss,
  SiSass,
  SiHtml5,
  SiMarkdown,
  SiGraphql,
  SiMongodb,
  SiPostgresql,
  SiRedis,
  SiMysql,
  SiSqlite,
  SiPrisma,
  SiDocker,
  SiKubernetes,
  SiGit,
  SiGithub,
  SiGitlab,
  SiRust,
  SiGo,
  SiC,
  SiCplusplus,
  SiSharp,
  SiOpenjdk,
  SiKotlin,
  SiSwift,
  SiPhp,
  SiRuby,
  SiLua,
  SiDart,
  SiFlutter,
  SiNpm,
  SiYarn,
  SiPnpm,
  SiTurborepo,
  SiEslint,
  SiPrettier,
  SiFigma,
  SiElectron,
  SiExpress,
  SiSocketdotio,
  SiCss,
  SiDotnet,
  SiGnubash,
  SiNushell,
} from 'react-icons/si';

/** One icon slot: the component plus its official brand color. */
export interface TechIconDef {
  icon: IconType;
  color: string;
}

export const techIconMap: Record<string, TechIconDef> = {
  // Languages
  typescript: { icon: SiTypescript, color: '#3178c6' },
  ts: { icon: SiTypescript, color: '#3178c6' },
  javascript: { icon: SiJavascript, color: '#f7df1e' },
  js: { icon: SiJavascript, color: '#f7df1e' },
  jsx: { icon: SiReact, color: '#61dafb' },
  mjs: { icon: SiJavascript, color: '#f7df1e' },
  cjs: { icon: SiJavascript, color: '#f7df1e' },
  python: { icon: SiPython, color: '#3776ab' },
  py: { icon: SiPython, color: '#3776ab' },
  rust: { icon: SiRust, color: '#dea584' },
  rs: { icon: SiRust, color: '#dea584' },
  go: { icon: SiGo, color: '#00add8' },
  golang: { icon: SiGo, color: '#00add8' },
  c: { icon: SiC, color: '#5c6bc0' },
  cpp: { icon: SiCplusplus, color: '#649ad2' },
  'c++': { icon: SiCplusplus, color: '#649ad2' },
  csharp: { icon: SiSharp, color: '#68217a' },
  'c#': { icon: SiSharp, color: '#68217a' },
  cs: { icon: SiSharp, color: '#68217a' },
  java: { icon: SiOpenjdk, color: '#f89820' },
  kotlin: { icon: SiKotlin, color: '#a97bff' },
  swift: { icon: SiSwift, color: '#f05138' },
  php: { icon: SiPhp, color: '#8892bf' },
  ruby: { icon: SiRuby, color: '#cc342d' },
  rb: { icon: SiRuby, color: '#cc342d' },
  lua: { icon: SiLua, color: '#2c2d72' },
  dart: { icon: SiDart, color: '#0175c2' },
  vb: { icon: SiDotnet, color: '#512bd4' },
  vbscript: { icon: SiDotnet, color: '#512bd4' },
  // Markup / styling
  txt: { icon: SiMarkdown, color: '#8b93a1' },
  text: { icon: SiMarkdown, color: '#8b93a1' },
  json: { icon: SiNodedotjs, color: '#8b93a1' },
  jsonc: { icon: SiNodedotjs, color: '#8b93a1' },
  log: { icon: SiMarkdown, color: '#8b93a1' },
  ini: { icon: SiMarkdown, color: '#8b93a1' },
  cfg: { icon: SiMarkdown, color: '#8b93a1' },
  conf: { icon: SiMarkdown, color: '#8b93a1' },
  xml: { icon: SiHtml5, color: '#8b93a1' },
  yml: { icon: SiDotnet, color: '#8b93a1' },
  yaml: { icon: SiDotnet, color: '#8b93a1' },
  toml: { icon: SiNodedotjs, color: '#8b93a1' },
  sh: { icon: SiGnubash, color: '#8b93a1' },
  bash: { icon: SiGnubash, color: '#8b93a1' },
  zsh: { icon: SiGnubash, color: '#8b93a1' },
  // Simple Icons has no PowerShell glyph — NuShell stands in for ps1.
  ps1: { icon: SiNushell, color: '#5391fe' },
  html: { icon: SiHtml5, color: '#e34f26' },
  css: { icon: SiCss, color: '#1572b6' },
  scss: { icon: SiSass, color: '#cc6699' },
  sass: { icon: SiSass, color: '#cc6699' },
  tailwind: { icon: SiTailwindcss, color: '#38bdf8' },
  tailwindcss: { icon: SiTailwindcss, color: '#38bdf8' },
  markdown: { icon: SiMarkdown, color: '#8b93a1' },
  md: { icon: SiMarkdown, color: '#8b93a1' },
  // Frameworks / runtimes
  react: { icon: SiReact, color: '#61dafb' },
  vue: { icon: SiVuedotjs, color: '#4fc08d' },
  svelte: { icon: SiSvelte, color: '#ff3e00' },
  node: { icon: SiNodedotjs, color: '#5fa04e' },
  nodejs: { icon: SiNodedotjs, color: '#5fa04e' },
  next: { icon: SiNextdotjs, color: '#8b93a1' },
  nextjs: { icon: SiNextdotjs, color: '#8b93a1' },
  deno: { icon: SiDeno, color: '#8b93a1' },
  bun: { icon: SiBun, color: '#fbf0df' },
  electron: { icon: SiElectron, color: '#47848f' },
  express: { icon: SiExpress, color: '#8b93a1' },
  flutter: { icon: SiFlutter, color: '#02569b' },
  graphql: { icon: SiGraphql, color: '#e10098' },
  socketio: { icon: SiSocketdotio, color: '#8b93a1' },
  // Build / tooling
  vite: { icon: SiVite, color: '#a259ff' },
  webpack: { icon: SiWebpack, color: '#8dd6f9' },
  esbuild: { icon: SiEsbuild, color: '#ffcf00' },
  rollup: { icon: SiRollupdotjs, color: '#ec4a3f' },
  babel: { icon: SiBabel, color: '#f9dc3e' },
  turborepo: { icon: SiTurborepo, color: '#ef4444' },
  eslint: { icon: SiEslint, color: '#4b32c3' },
  prettier: { icon: SiPrettier, color: '#f7b93e' },
  figma: { icon: SiFigma, color: '#f24e1e' },
  // Test
  jest: { icon: SiJest, color: '#c21325' },
  vitest: { icon: SiVitest, color: '#6e9f18' },
  cypress: { icon: SiCypress, color: '#69d3a7' },
  // Simple Icons has no Playwright glyph — Chrome stands in (it drives Chromium).
  playwright: { icon: SiGooglechrome, color: '#2ead33' },
  // Data
  mongodb: { icon: SiMongodb, color: '#47a248' },
  postgres: { icon: SiPostgresql, color: '#4169e1' },
  postgresql: { icon: SiPostgresql, color: '#4169e1' },
  redis: { icon: SiRedis, color: '#ff4438' },
  mysql: { icon: SiMysql, color: '#4479a1' },
  sqlite: { icon: SiSqlite, color: '#0f80cc' },
  prisma: { icon: SiPrisma, color: '#5a67d8' },
  // Infra / VCS / package managers
  docker: { icon: SiDocker, color: '#2496ed' },
  kubernetes: { icon: SiKubernetes, color: '#326ce5' },
  k8s: { icon: SiKubernetes, color: '#326ce5' },
  git: { icon: SiGit, color: '#f05032' },
  github: { icon: SiGithub, color: '#8b93a1' },
  gitlab: { icon: SiGitlab, color: '#fc6d26' },
  npm: { icon: SiNpm, color: '#cb3837' },
  yarn: { icon: SiYarn, color: '#2c8ebb' },
  pnpm: { icon: SiPnpm, color: '#f9ad00' },
};

/** Look up an icon by any name/alias; returns undefined when unknown. */
export function lookupTechIcon(name: string): TechIconDef | undefined {
  const key = name.trim().toLowerCase().replace(/\s+/g, '');
  return techIconMap[key];
}

/** Special full-filename matches, checked before the extension. */
const fileNameTech: Record<string, string> = {
  dockerfile: 'docker',
  'package.json': 'npm',
  'tsconfig.json': 'typescript',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  '.gitignore': 'git',
  '.env': 'nodejs',
  makefile: 'nodejs',
};

/**
 * Resolve a *file name* (e.g. "app.tsx", "Dockerfile") to a tech alias for
 * icon lookup. Falls back to the extension, then undefined.
 */
export function techNameForFile(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  const override = fileNameTech[lower];
  if (override && techIconMap[override]) return override;
  const ext = lower.includes('.') ? lower.split('.').pop()! : '';
  if (ext && techIconMap[ext]) return ext;
  return undefined;
}
