type SentinelleLogoProps = {
  /** Côté du carré, en pixels */
  size?: number;
  /** Couleur du trait — par défaut hérite de la couleur du texte parent (currentColor) */
  className?: string;
};

/**
 * Marque Sentinelle — double S anguleux incliné à 30°.
 *
 * La viewBox est recadrée sur le dessin lui-même (256×256 autour du centre de rotation)
 * plutôt que sur le 680×400 d'origine : dans ce cadre-là, le tracé n'occupait qu'un tiers
 * de la largeur, et la marque apparaissait minuscule à taille de logo. Le rendu est donc
 * carré, `size` étant le côté.
 * Utilise `currentColor`, donc la couleur suit le `text-*` Tailwind du parent
 * (ex: <SentinelleLogo className="text-slate-900 dark:text-white" />).
 */
export function SentinelleLogo({ size = 40, className = '' }: SentinelleLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="212 72 256 256"
      width={size}
      height={size}
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
