// Palette de tags causals — mêmes teintes que le canevas de design validé
// ("Institutional Slate"). Une teinte (hue OKLCH) par catégorie, luminosité/
// chroma fixes pour rester cohérent visuellement quelle que soit la catégorie.
import { CAUSAL_CATEGORY_NAMES } from './taxonomy';

const HUES = [253, 300, 75, 210, 15, 190, 45, 320, 25, 160];

function hueFor(categorie: string): number {
  const index = CAUSAL_CATEGORY_NAMES.indexOf(categorie);
  return HUES[index >= 0 ? index % HUES.length : HUES.length - 1];
}

export function categoryTagStyle(categorie: string): { backgroundColor: string; color: string } {
  const hue = hueFor(categorie);
  // Fond très clair teinté, encre saturée : l'inverse de la version sur fond sombre. La
  // luminosité de l’encre (38 %) tient le contraste sur le fond (94 %) pour les dix teintes :
  // vérifié, ratio minimum 7,53 (teinte 190), donc AAA sur l’ensemble de la palette.
  return {
    backgroundColor: `oklch(94% 0.045 ${hue})`,
    color: `oklch(38% 0.115 ${hue})`,
  };
}
