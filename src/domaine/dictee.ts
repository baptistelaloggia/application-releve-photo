/**
 * Correction de la dictée (21/11/2026) : la reconnaissance vocale générale connaît mal les sigles
 * du bâtiment. Elle rend « cé té a », « c t a » ou « cta » là où l'on a dit CTA. Ce correcteur
 * remet les sigles connus (catalogue des tags et vocabulaire CVC, plomberie, électricité) en
 * majuscules. Règles pures, testées.
 */
import { CATALOGUE_TAGS } from './tags';

/** Sigles du métier, en plus de ceux du catalogue des tags. */
export const SIGLES_METIER = [
  'CVC', 'CFO', 'CFA', 'GTB', 'GTC', 'ECS', 'EFS', 'ECH', 'EG', 'EC', 'CTA', 'VC', 'GF', 'CCF', 'VCFT', 'TCFT', 'VCV', 'PAC', 'DRV', 'VRV',
  'VMC', 'UTA', 'PAB', 'BDV', 'VED', 'VSD', 'CPCU', 'FRDP', 'DRY', 'TGBT', 'TD', 'BAES', 'BAPI', 'SSI', 'CMSI', 'IRVE', 'RIA', 'PV',
  'ERP', 'IGH', 'DN', 'PEHD', 'PVC', 'PER', 'CO2', 'HT', 'BT', 'TGHT', 'UPS', 'DAD', 'DAS', 'UGCIS', 'ECS', 'EU', 'EV', 'EP',
];

/** Nom des lettres en français, tel que la reconnaissance vocale peut les écrire. */
const NOMS_DE_LETTRES: Record<string, string> = {
  a: 'a', ah: 'a', be: 'b', bé: 'b', ce: 'c', cé: 'c', c: 'c', de: 'd', dé: 'd', e: 'e', eu: 'e', ef: 'f', effe: 'f', èf: 'f', f: 'f',
  ge: 'g', gé: 'g', ache: 'h', hache: 'h', i: 'i', ji: 'j', gi: 'j', ka: 'k', el: 'l', elle: 'l', èl: 'l', em: 'm', emme: 'm', èm: 'm',
  en: 'n', enne: 'n', èn: 'n', o: 'o', pe: 'p', pé: 'p', ku: 'q', qu: 'q', er: 'r', erre: 'r', ère: 'r', èr: 'r', es: 's', esse: 's',
  ès: 's', te: 't', té: 't', u: 'u', ve: 'v', vé: 'v', ix: 'x', iks: 'x', zed: 'z', zède: 'z',
};
/** Lettres seules qui sont aussi des mots courants : jamais le début d'un sigle à elles seules. */
const MOTS_UNE_LETTRE = new Set(['a', 'à', 'y', 'o', 'e', 'en', 'es', 'de', 'ce', 'te', 'le', 'se']);

/** Sigles connus : catalogue des tags (mots en majuscules) et vocabulaire du métier. */
export function siglesConnus(tagsPerso: string[] = []): Set<string> {
  const sigles = new Set(SIGLES_METIER);
  for (const t of [...CATALOGUE_TAGS.flatMap((c) => c.tags), ...tagsPerso]) {
    for (const mot of t.split(/[\s/]+/)) if (/^[A-Z][A-Z0-9]{1,5}$/.test(mot)) sigles.add(mot);
  }
  return sigles;
}

/** Mots courants qui ressemblent à un sigle : laissés tels quels quand ils sont seuls (« pas », « eu »…). */
const MOTS_COURANTS = new Set(['pas', 'eu', 'ev', 'ep', 'ht', 'bt', 'ras', 'ce', 'td', 'pv', 'dn', 'per', 'eg', 'ec', 'das', 'dad']);

/**
 * Corrige une phrase dictée :
 * - les lettres épelées (« c t a », « cé té a », « v.c. ») qui forment un sigle connu → « CTA », « VC » ;
 * - un sigle connu écrit en minuscules (« cta », « tgbt ») → majuscules, sauf mots courants (« pas ») ;
 * - quelques tournures : « chute eu ev » → « chute EU / EV », « co 2 » → « CO2 ».
 */
export function corrigerDictee(phrase: string, sigles: Set<string> = siglesConnus()): string {
  // Séparer les lettres collées par des points ou des tirets : « c.t.a. », « c-t-a ».
  const texte = phrase.replace(/\b([a-zA-Z])[.\-](?=[a-zA-Z][.\-\s]|[a-zA-Z]\b)/g, '$1 ').replace(/\b([a-zA-Z])\.(?=\s|$)/g, '$1');
  const mots = texte.split(/(\s+)/); // garde les espaces
  const jetons = mots.filter((_, i) => i % 2 === 0);
  const sortie: string[] = [];
  for (let i = 0; i < jetons.length; ) {
    // Suite la plus longue de lettres épelées formant un sigle connu (2 à 6 lettres).
    let remplace = false;
    for (let n = Math.min(6, jetons.length - i); n >= 2; n--) {
      const morceaux = jetons.slice(i, i + n).map((j) => j.toLowerCase().replace(/[,;:!?]$/, ''));
      const lettres = morceaux.map((m) => (/^[a-z]$/.test(m) ? m : (NOMS_DE_LETTRES[m] ?? null)));
      if (lettres.some((l) => l === null)) continue;
      const sigle = lettres.join('').toUpperCase();
      if (!sigles.has(sigle)) continue;
      // Une suite qui commence par un mot courant d'une lettre (« a », « de ») doit être entière.
      if (MOTS_UNE_LETTRE.has(morceaux[0]) && n < 3) continue;
      const ponctuation = /[,;:!?]$/.exec(jetons[i + n - 1])?.[0] ?? '';
      sortie.push(sigle + ponctuation);
      i += n;
      remplace = true;
      break;
    }
    if (remplace) continue;
    const j = jetons[i];
    const nu = j.replace(/[,;:!?.]$/, '');
    const fin = j.slice(nu.length);
    if (sigles.has(nu.toUpperCase()) && !MOTS_COURANTS.has(nu.toLowerCase()) && /^[a-zA-Z][a-zA-Z0-9]{1,5}$/.test(nu)) sortie.push(nu.toUpperCase() + fin);
    else sortie.push(j);
    i++;
  }
  return sortie
    .join(' ')
    .replace(/\bchute (?:EU|eu) (?:et )?(?:EV|ev)\b/gi, 'chute EU / EV')
    .replace(/\bco ?2\b/gi, 'CO2')
    .replace(/\s+/g, ' ')
    .trim();
}
