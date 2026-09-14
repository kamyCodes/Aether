/**
 * Liquid Glass interaction layer — ported from the reference implementation.
 *
 * Mounted ONCE from App.tsx via delegated document-level listeners, so no
 * component owns glass logic and no per-element listeners accumulate:
 *   - .glow            → pointer-tracked highlight (--mx/--my)
 *   - .btn-glass       → one-shot shine sweep per click (forced reflow)
 *   - .segmented       → sliding indicator via getBoundingClientRect, with
 *                        the squish keyframe on the SEPARATE fill element
 *                        (indicator position and squish must never share
 *                        one transition — they fight)
 *   - .dock            → cursor-distance magnification (if a dock exists)
 *
 * Pure visual behavior — zero state/data-flow involvement.
 */

function isButtonDisabled(el: Element): boolean {
  return el instanceof HTMLButtonElement && el.disabled;
}

export function mountGlassInteractions(): () => void {
  /* ---- pointer-tracked glow ---- */
  const onGlowMove = (e: MouseEvent) => {
    const target = (e.target as Element | null)?.closest?.('.glow') as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    target.style.setProperty('--mx', ((e.clientX - rect.left) / rect.width) * 100 + '%');
    target.style.setProperty('--my', ((e.clientY - rect.top) / rect.height) * 100 + '%');
  };

  /* ---- button shine sweep: one-shot per click ----
     Mapping: Aether's primary buttons are `button.primary` (styled with the
     reference's .btn-glass treatment in styles.css); .btn-glass stays in
     the selector so any future literal port inherits the sweep too. */
  const onBtnClick = (e: MouseEvent) => {
    const btn = (e.target as Element | null)?.closest?.('.btn-glass, button.primary');
    if (!btn || isButtonDisabled(btn)) return;
    // React/Framer GlassButton drives its own shine (key-remount) — skip to
    // avoid a double sweep.
    if (btn.hasAttribute('data-framer-shine')) return;
    btn.classList.remove('shine');
    void (btn as HTMLElement).offsetWidth; // force reflow so the animation can restart
    btn.classList.add('shine');
  };

  /* ---- segmented controls: slide + squish the indicator ----
     Mapping: Aether's segmented controls are `.mode-toggle` (Composer
     Agent/Ask/Plan, sidebar Files/Projects, panel Terminal/Preview, preview
     device sizes) — same pattern as the reference's .segmented. Both
     selectors are supported so a literal .segmented port also works.
     Role conventions carried from the reference: containers that are real
     tab switchers carry role="tablist" in markup; here we only drive the
     indicator visuals. */
  const SEG_CONTAINER = '.segmented, .mode-toggle';
  const onSegClick = (e: MouseEvent) => {
    const seg = (e.target as Element | null)?.closest?.(
      '.segmented > .segment, .mode-toggle > button',
    );
    if (!seg || isButtonDisabled(seg)) return;
    const container = seg.closest(SEG_CONTAINER);
    if (!container) return;
    moveTo(container as HTMLElement, seg as HTMLElement, true);
  };

  function moveTo(container: HTMLElement, target: HTMLElement, squish: boolean) {
    const indicator = container.querySelector<HTMLElement>('.segment-indicator');
    const fill = container.querySelector<HTMLElement>('.segment-indicator-fill');
    if (!indicator || !fill) return;
    const segRect = target.getBoundingClientRect();
    const parentRect = container.getBoundingClientRect();
    indicator.style.width = segRect.width + 'px';
    indicator.style.transform = 'translateX(' + (segRect.left - parentRect.left) + 'px)';
    container
      .querySelectorAll('.segment, .mode-toggle > button')
      .forEach((s) => s.classList.toggle('active', s === target));
    if (squish) {
      fill.classList.remove('morphing');
      void fill.offsetWidth; // restart the squish keyframe
      fill.classList.add('morphing');
    }
  }

  // Keep indicators aligned with layout changes (panel resize, tab reflow).
  function realignAll() {
    document.querySelectorAll<HTMLElement>(SEG_CONTAINER).forEach((container) => {
      const active = container.querySelector<HTMLElement>('.segment.active, button.active');
      if (active) moveTo(container, active, false);
    });
  }
  const ro = new ResizeObserver(() => realignAll());
  ro.observe(document.body);

  /* ---- dock magnification (no dock exists in Aether yet; kept verbatim
     from the reference so a future dock inherits it for free) ---- */
  const onDockMove = (e: MouseEvent) => {
    const dock = (e.target as Element | null)?.closest?.('.dock');
    if (!dock) return;
    const icons = dock.querySelectorAll<HTMLElement>('.dock-icon');
    icons.forEach((icon) => {
      const r = icon.getBoundingClientRect();
      const dist = Math.abs(e.clientX - (r.left + r.width / 2));
      const maxDist = 140;
      const t = Math.max(0, 1 - dist / maxDist);
      icon.style.transform = 'translateY(' + -18 * t + 'px) scale(' + (1 + 0.7 * t) + ')';
    });
  };
  const onDockLeave = (e: MouseEvent) => {
    const dock = (e.target as Element | null)?.closest?.('.dock');
    if (!dock) return;
    dock.querySelectorAll<HTMLElement>('.dock-icon').forEach((icon) => {
      icon.style.transform = '';
    });
  };

  document.addEventListener('mousemove', onGlowMove, { passive: true });
  document.addEventListener('mousemove', onDockMove, { passive: true });
  document.addEventListener('click', onBtnClick);
  document.addEventListener('click', onSegClick);
  document.addEventListener('mouseout', onDockLeave);

  return () => {
    document.removeEventListener('mousemove', onGlowMove);
    document.removeEventListener('mousemove', onDockMove);
    document.removeEventListener('click', onBtnClick);
    document.removeEventListener('click', onSegClick);
    document.removeEventListener('mouseout', onDockLeave);
    ro.disconnect();
  };
}
