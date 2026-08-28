type SentinelleLogoProps = {
  /** Taille en pixels (largeur et hauteur calculées via l'aspect ratio) */
  size?: number;
  /** Couleur du trait — par défaut hérite de la couleur du texte parent (currentColor) */
  className?: string;
};

/**
 * Marque Sentinelle — double S anguleux incliné à 30°.
 * Utilise `currentColor`, donc la couleur suit le `text-*` Tailwind du parent
 * (ex: <SentinelleLogo className="text-slate-900 dark:text-white" />).
 */
export function SentinelleLogo({ size = 40, className = '' }: SentinelleLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 680 400"
      width={size}
      height={(size * 400) / 680}
      role="img"
      aria-label="Sentinelle"
      className={className}
    >
      <g transform="rotate(30 340 200)">
        <polyline
          points="364,140 256,140 256,212 400,212 400,284 292,284"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
        <polyline
          points="388,116 280,116 280,188 424,188 424,260 316,260"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="butt"
          strokeLinejoin="miter"
        />
      </g>
    </svg>
  );
}

export default SentinelleLogo;
