import type { DetectedPattern, Ticket } from './types';
import { COBAC_DEADLINE_DAYS } from './taxonomy';

export type ComplianceReport = {
  reportType: 'Sentinelle — Rapport de conformité COBAC R-2020/06';
  version: '1.0';
  generatedAt: string;
  periode: { debut: string | null; fin: string | null };
  synthese: string;
  totalTickets: number;
  repartitionParCategorie: Record<string, number>;
  ticketsEnRetard: number;
  tauxConformiteDelai: number; // 0..1
  patternsDetectes: DetectedPattern[];
  avertissement: string;
};

function extentDates(tickets: Ticket[]): { debut: string | null; fin: string | null } {
  if (tickets.length === 0) return { debut: null, fin: null };
  const dates = tickets.map((t) => t.date_creation).sort();
  return { debut: dates[0], fin: dates[dates.length - 1] };
}

export function buildComplianceReport(tickets: Ticket[], patterns: DetectedPattern[]): ComplianceReport {
  const repartitionParCategorie: Record<string, number> = {};
  for (const t of tickets) {
    repartitionParCategorie[t.categorie_causale] = (repartitionParCategorie[t.categorie_causale] ?? 0) + 1;
  }

  const ticketsEnRetard = tickets.filter(
    (t) => t.statut === 'en_retard' || (t.delai_reponse_jours ?? 0) > COBAC_DEADLINE_DAYS,
  ).length;

  const tauxConformiteDelai = tickets.length > 0 ? 1 - ticketsEnRetard / tickets.length : 1;

  return {
    reportType: 'Sentinelle — Rapport de conformité COBAC R-2020/06',
    version: '1.0',
    generatedAt: new Date().toISOString(),
    periode: extentDates(tickets),
    synthese: [
      `${tickets.length} réclamation(s) analysée(s).`,
      `${ticketsEnRetard} en dépassement du délai réglementaire de ${COBAC_DEADLINE_DAYS} jours.`,
      `${patterns.length} pattern(s) d'incident détecté(s).`,
    ].join(' '),
    totalTickets: tickets.length,
    repartitionParCategorie,
    ticketsEnRetard,
    tauxConformiteDelai,
    patternsDetectes: patterns,
    avertissement:
      "Rapport généré automatiquement à partir des délais et catégories déclarés. Les obligations exactes (accusé de réception, registre, désignation du responsable réclamations) sont définies par le règlement COBAC R-2020/06 du 30 juillet 2020 — faire valider les citations d'articles par un juriste conformité avant tout usage réglementaire ou soumission officielle.",
  };
}

export function complianceReportToMarkdown(report: ComplianceReport): string {
  const lines: string[] = [
    `# ${report.reportType}`,
    '',
    `**Généré le :** ${report.generatedAt}`,
    `**Version :** ${report.version}`,
    report.periode.debut ? `**Période couverte :** ${report.periode.debut} → ${report.periode.fin}` : '',
    '',
    '## Synthèse',
    '',
    report.synthese,
    '',
    '## Répartition par catégorie causale',
    '',
    '| Catégorie | Tickets |',
    '|---|---|',
    ...Object.entries(report.repartitionParCategorie).map(([cat, n]) => `| ${cat} | ${n} |`),
    '',
    '## Conformité délai (COBAC R-2020/06, réponse finale sous 45 jours)',
    '',
    `- Réclamations en dépassement de délai : **${report.ticketsEnRetard}**`,
    `- Taux de conformité au délai : **${(report.tauxConformiteDelai * 100).toFixed(1)}%**`,
    '',
    '## Patterns d\'incidents détectés',
    '',
  ];

  if (report.patternsDetectes.length === 0) {
    lines.push('Aucun pattern détecté sur cette période.', '');
  } else {
    for (const p of report.patternsDetectes) {
      lines.push(
        `### [${p.severite.toUpperCase()}] ${p.categorie_causale} (${p.type === 'conformite_cobac' ? 'non-conformité COBAC' : 'pic de volume'})`,
        `- ${p.description}`,
        `- Tickets liés : ${p.tickets_lies.length}`,
        '',
      );
    }
  }

  lines.push('## Avertissement', '', report.avertissement, '');

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}
