/**
 * Liquid Glass behavior layer — Radix UI + Framer Motion.
 *
 * Replaces the vanilla DOM manipulation in lib/glass.ts with accessible,
 * declarative components:
 *   - GlassButton            → Framer tap/hover + key-remount shine sweep
 *   - GlassToggle            → Radix Switch (role="switch", Space/Enter) +
 *                              Framer spring thumb (replaces :checked CSS)
 *   - GlassSegmentedControl  → Radix ToggleGroup (radiogroup + arrow keys) +
 *                              Framer layoutId indicator (replaces all
 *                              getBoundingClientRect/resize-listener math)
 *   - GlassDropdown          → Radix DropdownMenu (Escape/click-outside,
 *                              collision detection) with .glass content
 *   - ChatBubble             → Framer entrance only (NO `layout` prop —
 *                              too expensive on long scrolling lists)
 *   - useGlowTracking        → pointer-tracked --mx/--my for large static
 *                              cards (lib/glass.ts's delegated handler already
 *                              covers `.glow` globally; use this hook only
 *                              for surfaces outside that delegation)
 *
 * Visuals come from the shared token set in styles.css — no component
 * hardcodes blur radii, borders, or easings. The SVG #glass-distortion
 * filter lives ONCE in App.tsx.
 *
 * Reduced motion: every animated component calls useReducedMotion() and
 * skips/shortens its spring or shine — behavior lives here now, not in CSS
 * class toggles.
 */
import { useEffect, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';

/* ============================================================
   BUTTON — press scale + one-shot shine sweep per click.
   The `key`-remount of the shine span replaces the vanilla
   classList.remove/offsetWidth/classList.add reflow hack.
   Elements carry data-framer-shine so the vanilla driver in
   lib/glass.ts skips them (no double sweep).
   ============================================================ */
export function GlassButton({
  children,
  onClick,
  className = '',
  disabled,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  title?: string;
}) {
  const [shineKey, setShineKey] = useState(0);
  const reduceMotion = useReducedMotion();

  return (
    <motion.button
      className={className}
      data-framer-shine
      disabled={disabled}
      title={title}
      onClick={() => {
        setShineKey((k) => k + 1);
        onClick?.();
      }}
      whileHover={reduceMotion ? undefined : { boxShadow: '0 12px 28px rgba(0,0,0,0.3)' }}
      whileTap={reduceMotion ? undefined : { scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      {children}
      {!reduceMotion && (
        <motion.span
          key={shineKey}
          className="btn-shine"
          initial={{ left: '-150%' }}
          animate={shineKey > 0 ? { left: '150%' } : undefined}
          transition={{ duration: 0.65, ease: 'easeOut' }}
        />
      )}
    </motion.button>
  );
}

/* ============================================================
   TOGGLE — Radix Switch. data-state="checked" (set by Radix)
   drives the track gradient in CSS; the thumb animates with a
   bouncy spring (the overshoot is the point — never ease-out).
   Keyboard: Space/Enter via the native button role="switch".
   ============================================================ */
export function GlassToggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <SwitchPrimitive.Root
      className="glass toggle-track"
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
    >
      <SwitchPrimitive.Thumb asChild>
        <motion.span
          className="toggle-thumb"
          animate={{ x: checked ? 16 : 0 }}
          transition={
            reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.45, duration: 0.5 }
          }
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

/* ============================================================
   SEGMENTED CONTROL — Radix ToggleGroup + Framer layoutId.
   layoutId makes Framer animate the indicator's position AND
   size between items automatically — no rect math, no resize
   listener, no manual squish keyframe. One layoutId per control
   instance (the prefix keeps multiple controls independent —
   sharing one across unrelated elements makes them swap).
   `active` class is set manually alongside Radix's data-state
   so Aether's existing .mode-toggle visuals keep applying.
   ============================================================ */
export interface SegOption {
  value: string;
  label: string;
  title?: string;
}

export function GlassSegmentedControl({
  value,
  onValueChange,
  options,
  layoutId,
  className = '',
  style,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SegOption[];
  /** Unique per control instance on the screen. */
  layoutId: string;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(v) => v && onValueChange(v)}
      className={`segmented ${className}`.trim()}
      style={style}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <ToggleGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={`segment${value === option.value ? ' active' : ''}`}
          title={option.title}
        >
          {value === option.value && (
            <motion.div
              layoutId={layoutId}
              className="segment-indicator-fill-fm"
              transition={
                reduceMotion ? { duration: 0.01 } : { type: 'spring', bounce: 0.3, duration: 0.5 }
              }
            />
          )}
          <span className="segment-label">{option.label}</span>
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

/* ============================================================
   DROPDOWN — Radix DropdownMenu with .glass content. Radix
   handles positioning, collision detection, Escape and
   click-outside-to-close, and full keyboard navigation.
   Mapping decision (per the reference): a small fixed option
   list → this; the 1000+-entry model catalog picker stays a
   native <select> because native option lists virtualize for
   free while 1000 Radix items would mount eagerly on open.
   ============================================================ */
export interface DropdownGroup {
  label: string;
  options: { value: string; label: string }[];
}

export function GlassDropdown({
  value,
  onValueChange,
  options,
  groups,
  className = '',
  contentClassName = '',
  title,
  ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  /** Flat option list — ignored when `groups` is provided. */
  options?: { value: string; label: string }[];
  /** Grouped rendering (like <optgroup>): section headers + items. Pass
      either `groups` or `options`; exactly one should be provided. */
  groups?: DropdownGroup[];
  className?: string;
  contentClassName?: string;
  title?: string;
  ariaLabel?: string;
}) {
  const flat = groups ? groups.flatMap((g) => g.options) : (options ?? []);
  const current = flat.find((o) => o.value === value);

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger className={className} title={title} aria-label={ariaLabel}>
        {current?.label ?? value}
        <svg className="dd-chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path
            d="M2 3.5 L5 6.5 L8 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </DropdownMenuPrimitive.Trigger>{' '}
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          className={`glass dd-content ${contentClassName}`.trim()}
          sideOffset={6}
          align="start"
        >
          {groups
            ? groups.map((g) => (
                <DropdownMenuPrimitive.Group key={g.label}>
                  <DropdownMenuPrimitive.Label className="dd-group-label">
                    {g.label}
                  </DropdownMenuPrimitive.Label>
                  {g.options.map((o) => (
                    <DropdownMenuPrimitive.Item
                      key={o.value}
                      className="dd-item"
                      {...(o.value === value ? { 'data-checked': '' } : {})}
                      onSelect={() => onValueChange(o.value)}
                    >
                      {o.label}
                    </DropdownMenuPrimitive.Item>
                  ))}
                </DropdownMenuPrimitive.Group>
              ))
            : (options ?? []).map((o) => (
                <DropdownMenuPrimitive.Item
                  key={o.value}
                  className="dd-item"
                  {...(o.value === value ? { 'data-checked': '' } : {})}
                  onSelect={() => onValueChange(o.value)}
                >
                  {o.label}
                </DropdownMenuPrimitive.Item>
              ))}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}

/* ============================================================
   CHAT BUBBLE — entrance motion only. Deliberately NO `layout`
   prop and no whileHover: `layout` on a long scrolling message
   list measures every child on each commit and wrecks scroll;
   glow on every bubble adds a mousemove cost per row.
   ============================================================ */
export function ChatBubble({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

/* ============================================================
   GLOW HOOK — pointer-tracked highlight for LARGE STATIC cards
   only (a walkthrough/response card: yes; a chat bubble in a
   dense list or a small diff row: no). Note: the delegated
   handler in lib/glass.ts already drives every `.glow` element
   on the page — attach this hook only to surfaces outside that
   delegation, never both (double mousemove listeners).
   ============================================================ */
export function useGlowTracking(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
      el.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    };
    el.addEventListener('mousemove', handleMove);
    return () => el.removeEventListener('mousemove', handleMove);
  }, [ref]);
}
