/**
 * Comparaison de modèles sur un échantillon de réclamations déjà étiquetées.
 *
 * Le calcul est volontairement séparé de l'orchestration des appels : il est pur, donc
 * vérifiable sans IA, sans réseau et sans base. C'est la seule façon de faire confiance aux
 * chiffres qu'on affichera ensuite à côté d'un nom de modèle.
 *
 * Deux principes de mesure :
 *
 *  1. On ne compare que sur des réclamations portant une catégorie de référence
 *     (`categorie_attendue`). Sans référence, il n'y a pas d'exactitude à mesurer — seulement
 *     un taux d'accord entre modèles, qui ne dit pas lequel a raison.
 *
 *  2. Un repli heuristique n'est jamais compté comme une réussite du modèle, même si la
 *     catégorie trouvée par mots-clés est la bonne. Le modèle n'a pas répondu : l'attribuer à
 *     son crédit reviendrait à récompenser une panne.
 */

export type BenchmarkAttempt = {
  /** Catégorie rendue par le modèle, ou '' si le modèle n'a pas répondu. */
  obtenue: string;
  /** Catégorie de référence issue du fichier importé. */
  attendue: string;
  /** Confiance auto-déclarée par le modèle, entre 0 et 1. */
  confiance: number | null;
  /** Vrai si la réponse vient du repli par mots-clés et non du modèle. */
  repli: boolean;
  /** Durée de l'aller-retour complet, en millisecondes. */
  latenceMs: number;
};

export type ModelScore = {
  modelId: string;
  label: string;
  emplacement: 'cloud' | 'local';
  /** Réclamations soumises à ce modèle. */
  soumises: number;
  /** Réclamations auxquelles le modèle a effectivement répondu (hors repli). */
  repondues: number;
  /** Réponses du modèle correspondant à la référence. */
  exactes: number;
  /** Replis heuristiques, c'est-à-dire échecs du modèle. */
  replis: number;
  /** exactes / soumises — la mesure honnête : un échec compte comme une erreur. */
  exactitude: number;
  /** exactes / repondues — l'exactitude quand le modèle répond. Null si jamais répondu. */
  exactitudeSiRepond: number | null;
  latenceMedianeMs: number | null;
  /**
   * Temps estimé pour un portefeuille de 600 réclamations.
   *
   * Ce n'est pas la simple extrapolation de la latence. Un modèle cloud sur palier gratuit est
   * plafonné en requêtes/minute par le serveur : mesuré à 0,9 s par appel, il donnerait
   * « 9 minutes » alors qu'à 10 requêtes/minute le lot dure une heure. On retient donc le plus
   * contraignant des deux — la latence pour un modèle local, le quota pour un modèle bridé.
   */
  minutesPour600: number | null;
  /** Vrai si l'estimation est dictée par le quota et non par la vitesse du modèle. */
  limiteParQuota: boolean;
  confianceMoyenne: number | null;
  /**
   * Confiance moyenne moins exactitude observée. Positif = le modèle se surestime.
   * C'est le chiffre qui dit si l'on peut se fier à sa confiance pour trier les cas à
   * faire valider par un humain.
   */
  ecartCalibration: number | null;
};

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 0 ? (triees[milieu - 1] + triees[milieu]) / 2 : triees[milieu];
}

export function scoreModel(
  modelId: string,
  label: string,
  emplacement: 'cloud' | 'local',
  attempts: BenchmarkAttempt[],
  rpmLimite?: number,
): ModelScore {
  const soumises = attempts.length;
  const reponses = attempts.filter((a) => !a.repli);
  const exactes = reponses.filter((a) => a.obtenue === a.attendue).length;
  const confiances = reponses.map((a) => a.confiance).filter((c): c is number => c !== null);
  const confianceMoyenne = confiances.length
    ? confiances.reduce((s, c) => s + c, 0) / confiances.length
    : null;
  const latence = mediane(attempts.map((a) => a.latenceMs));
  const exactitude = soumises > 0 ? exactes / soumises : 0;
  const exactitudeSiRepond = reponses.length > 0 ? exactes / reponses.length : null;

  const minutesParLatence = latence === null ? null : (600 * latence) / 60_000;
  const minutesParQuota = rpmLimite && rpmLimite > 0 ? 600 / rpmLimite : null;
  const minutesPour600 =
    minutesParLatence === null
      ? minutesParQuota
      : minutesParQuota === null
        ? minutesParLatence
        : Math.max(minutesParLatence, minutesParQuota);

  return {
    modelId,
    label,
    emplacement,
    soumises,
    repondues: reponses.length,
    exactes,
    replis: soumises - reponses.length,
    exactitude,
    exactitudeSiRepond,
    latenceMedianeMs: latence,
    minutesPour600,
    limiteParQuota:
      minutesParQuota !== null &&
      (minutesParLatence === null || minutesParQuota > minutesParLatence),
    confianceMoyenne,
    ecartCalibration:
      confianceMoyenne !== null && exactitudeSiRepond !== null
        ? confianceMoyenne - exactitudeSiRepond
        : null,
  };
}

/**
 * Classe les modèles pour l'affichage : exactitude décroissante, puis latence croissante.
 * À exactitude égale, le plus rapide est le meilleur choix — et sur un palier gratuit
 * limité en débit, la latence n'est pas un détail de confort mais ce qui décide si un
 * portefeuille de 600 réclamations se traite en dix minutes ou en six heures.
 */
export function classerScores(scores: ModelScore[]): ModelScore[] {
  return [...scores].sort((a, b) => {
    if (b.exactitude !== a.exactitude) return b.exactitude - a.exactitude;
    return (a.latenceMedianeMs ?? Infinity) - (b.latenceMedianeMs ?? Infinity);
  });
}

/** Rapport de comparaison exportable, pour archiver une mesure plutôt que la citer de mémoire. */
export function benchmarkToMarkdown(scores: ModelScore[], echantillon: number): string {
  const lignes = [
    '# Sentinelle — comparaison de modèles de classification',
    '',
    `**Mesuré le :** ${new Date().toISOString()}`,
    `**Échantillon :** ${echantillon} réclamation(s) portant une catégorie de référence`,
    '',
    '| Modèle | Lieu | Exactitude | Si répond | Replis | Latence méd. | 600 récl. | Confiance | Écart calib. |',
    '|---|---|---|---|---|---|---|---|---|',
    ...classerScores(scores).map((s) => {
      const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(0)} %`);
      return [
        s.label,
        s.emplacement === 'cloud' ? 'cloud' : 'local',
        `${s.exactes}/${s.soumises} = ${pct(s.exactitude)}`,
        pct(s.exactitudeSiRepond),
        `${s.replis}`,
        s.latenceMedianeMs === null ? '—' : `${(s.latenceMedianeMs / 1000).toFixed(1)} s`,
        s.minutesPour600 === null
          ? '—'
          : `~${s.minutesPour600.toFixed(0)} min${s.limiteParQuota ? ' (quota)' : ''}`,
        pct(s.confianceMoyenne),
        s.ecartCalibration === null
          ? '—'
          : `${s.ecartCalibration > 0 ? '+' : ''}${(s.ecartCalibration * 100).toFixed(0)} pts`,
      ].join(' | ');
    }).map((l) => `| ${l} |`),
    '',
    '## Lecture',
    '',
    "- **Exactitude** : réponses conformes à la référence, rapportées aux réclamations soumises. Un repli heuristique compte comme une erreur, parce que le modèle n'a pas répondu.",
    "- **Si répond** : exactitude calculée sur les seules réclamations où le modèle a répondu. L'écart avec la colonne précédente mesure sa disponibilité, pas sa justesse.",
    "- **Écart de calibration** : confiance auto-déclarée moins exactitude observée. Positif, le modèle se surestime — sa confiance ne peut alors pas servir à décider quels dossiers faire relire par un humain.",
    "- **600 récl.** : « (quota) » signale une durée dictée par le plafond de requêtes/minute, et non par la vitesse du modèle — un modèle plus rapide ne raccourcirait pas le lot.",
    '',
    "La référence provient du fichier importé et n'est pas une vérité réglementaire : elle vaut ce que vaut le classement manuel qui l'a produite.",
    '',
  ];
  return lignes.join('\n');
}
