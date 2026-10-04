// Segmented control accessible (radiogroup ARIA, navigation clavier, curseur animé
// par transition CSS) — sourcé sur 21st.dev (ddoemonn/segmented-control) et adapté aux
// tokens Sentinelle ("Institutional Slate" : --color-accent / --color-elevated / etc.).
'use client';

import { useCallback, useRef, useState, type ReactNode } from 'react';

// Le curseur et son masque glissent ensemble, en sens opposés. Une transition CSS suffit :
// la bibliothèque d'animation chargée pour ce seul composant pesait plus que lui.
// `motion-reduce` coupe le mouvement pour qui a demandé à le réduire.
const SLIDE = 'transition-transform duration-200 ease-out motion-reduce:transition-none';
const SEG = 'px-3.5 py-1.5 text-center text-[12.5px] font-medium leading-[18px] whitespace-nowrap';

export type SegmentedOption = {
  value: string;
  label: ReactNode;
  /** Nom accessible texte pour le bouton radio (le label visuel peut contenir une icône). */
  ariaLabel: string;
  disabled?: boolean;
};

export type SegmentedControlProps = {
  options: SegmentedOption[];
  label: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
};

export function SegmentedControl({
  options,
  label,
  value,
  defaultValue,
  onValueChange,
  className = '',
}: SegmentedControlProps) {
  const count = Math.max(1, options.length);
  const template = `repeat(${count}, minmax(0, 1fr))`;

  const [internal, setInternal] = useState(() => defaultValue ?? options[0]?.value ?? '');
  const [hovered, setHovered] = useState(-1);

  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const found = options.findIndex((o) => o.value === current);
  const index = found < 0 ? 0 : found;

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const emit = useRef(onValueChange);
  emit.current = onValueChange;

  const select = useCallback(
    (next: string) => {
      if (!controlled) setInternal(next);
      if (next !== current) emit.current?.(next);
    },
    [controlled, current],
  );

  const seek = useCallback(
    (from: number, dir: number) => {
      let i = from;
      for (let k = 0; k < count; k++) {
        i = (i + dir + count) % count;
        if (!options[i]?.disabled) return i;
      }
      return from;
    },
    [count, options],
  );

  const go = useCallback(
    (i: number) => {
      const option = options[i];
      if (!option || option.disabled) return;
      buttons.current[i]?.focus();
      select(option.value);
    },
    [options, select],
  );

  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      go(seek(i, 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      go(seek(i, -1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(seek(count - 1, 1));
    } else if (e.key === 'End') {
      e.preventDefault();
      go(seek(0, -1));
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={`relative inline-block select-none rounded-[9px] border border-line bg-elevated p-[3px] shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)] ${className}`}
    >
      <div className="relative grid" style={{ gridTemplateColumns: template, touchAction: 'manipulation' }}>
        {options.map((option, i) => (
          <span
            key={option.value}
            aria-hidden
            className={`${SEG} pointer-events-none inline-flex items-center justify-center gap-1.5 ${
              option.disabled ? 'text-ink-faint/50' : hovered === i && i !== index ? 'text-ink-soft' : 'text-ink-faint'
            }`}
          >
            {option.label}
          </span>
        ))}

        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 left-0 overflow-hidden rounded-[6px] bg-accent shadow-[0_1px_2px_rgba(0,0,0,0.4)] ${SLIDE}`}
          style={{ width: `${100 / count}%`, transform: `translateX(${index * 100}%)` }}
        >
          <div className={`absolute inset-0 ${SLIDE}`} style={{ transform: `translateX(${index * -100}%)` }}>
            <div className="absolute inset-y-0 left-0 grid" style={{ width: `${count * 100}%`, gridTemplateColumns: template }}>
              {options.map((option) => (
                <span key={option.value} className={`${SEG} inline-flex items-center justify-center gap-1.5`} style={{ color: 'var(--color-accent-ink)' }}>
                  {option.label}
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: template }} onPointerLeave={() => setHovered(-1)}>
          {options.map((option, i) => (
            <button
              key={option.value}
              ref={(node) => {
                buttons.current[i] = node;
              }}
              type="button"
              role="radio"
              aria-checked={i === index}
              aria-disabled={option.disabled || undefined}
              tabIndex={i === index ? 0 : -1}
              onClick={() => !option.disabled && select(option.value)}
              onKeyDown={(e) => onKeyDown(e, i)}
              onPointerEnter={() => !option.disabled && setHovered(i)}
              className="cursor-default rounded-[6px] outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-accent)]"
            >
              <span className="sr-only">{option.ariaLabel}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SegmentedControl;
