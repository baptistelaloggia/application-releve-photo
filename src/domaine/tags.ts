/**
 * Tags des photos (20/11/2026, CONCEPTION §A.6 decies) : un catalogue par lot technique, des tags
 * personnels ajoutés par l'utilisateur, et la reconnaissance des tags dans une phrase dictée.
 * Règles pures, sans accès au navigateur.
 */

export interface CategorieTags {
  /** Libellé affiché : « CVC · production ». */
  nom: string;
  tags: string[];
}

/** Catalogue fourni par l'utilisateur le 20/11/2026 (« À verifier » corrigé en « À vérifier »). */
export const CATALOGUE_TAGS: CategorieTags[] = [
  { nom: 'Commun · statut', tags: ['Conforme', 'À vérifier', 'Non conforme'] },
  { nom: 'Commun · chantier', tags: ['Avant fermeture', 'Calorifuge', 'VC'] },
  { nom: 'CVC · production', tags: ['GF', 'PAC', 'Chaudière', 'DRY', 'Échangeur', 'CPCU', 'FRDP'] },
  { nom: 'CVC · traitement d’air', tags: ['CTA', 'Rooftop', 'VMC', 'Extracteur'] },
  {
    nom: 'CVC · hydraulique',
    tags: ['Pompe', "Vase d'expansion", 'Bouteille', 'Collecteur', 'Vanne 2/3 voies', 'PAB', "Traitement d'eau", 'Tuyauterie'],
  },
  { nom: 'CVC · aéraulique', tags: ['Gaine', 'CCF', 'BDV', 'PAS', 'Flexible'] },
  {
    nom: 'CVC · terminaux',
    tags: ['VCV', 'Plafond rayonnant', 'Radiateur', 'Unité intérieure DRV', 'Cassette', 'Diffuseur', 'Bouche', 'Grille'],
  },
  { nom: 'CVC · désenfumage', tags: ['VCFT', 'TCFT', 'VED', 'VSD'] },
  { nom: 'CVC · régulation, GTB', tags: ['Automate', 'Sonde', 'Thermostat', 'Compteur'] },
  {
    nom: 'Plomberie · production ECS',
    tags: ['Ballon ECS', 'Préparateur ECS', 'Chauffe-eau électrique', 'Solaire thermique', 'Bouclage ECS'],
  },
  {
    nom: 'Plomberie · alimentation',
    tags: [
      "Compteur d'eau",
      'Disconnecteur',
      'Réducteur de pression',
      'Adoucisseur',
      'Surpresseur',
      "Vanne d'isolement",
      'Colonne montante',
      'Nourrice',
    ],
  },
  {
    nom: 'Plomberie · évacuation',
    tags: ['Chute EU / EV', 'Eaux pluviales', 'Poste de relevage', 'Séparateur à graisses', 'Séparateur hydrocarbures', 'Siphon de sol', 'Regard'],
  },
  { nom: 'Plomberie · sanitaires', tags: ['WC', 'Urinoir', 'Lavabo', 'Douche', 'Évier', 'Robinetterie', 'Fontaine'] },
  { nom: 'Plomberie · incendie', tags: ['RIA', 'Colonne sèche'] },
  {
    nom: 'Électricité · distribution CFO',
    tags: ['TGBT', 'TD', 'Armoire', 'Transformateur', 'Groupe électrogène', 'Onduleur', 'Chemin de câbles', 'Câblage'],
  },
  { nom: 'Électricité · terminaux CFO', tags: ['Prise', 'Interrupteur', 'Alimentation équipement CVC / PLB'] },
  { nom: 'Électricité · éclairage', tags: ['Luminaire', 'BAES / BAPI', 'Détecteur de présence'] },
  {
    nom: 'Électricité · CFA, sécurité',
    tags: ['SSI / CMSI', 'Détecteur incendie', 'Déclencheur manuel', "Contrôle d'accès", 'Vidéosurveillance', 'Interphonie', 'Baie de brassage'],
  },
  { nom: 'Électricité · comptage, EnR', tags: ['Compteur électrique', 'Sous-comptage', 'Borne IRVE', 'Onduleur PV'] },
];

/** Tags proposés en puces avant tout usage (statut et suivi de chantier). */
export const PUCES_PAR_DEFAUT = ['Conforme', 'À vérifier', 'Non conforme', 'Avant fermeture', 'Calorifuge', 'VC'];

export const TAG_LONGUEUR_MAX = 40;
export const TAGS_PAR_PHOTO_MAX = 30;
/** Nombre de puces affichées : favoris d'abord, puis tags les plus récents. */
export const NB_PUCES = 6;

/** Tag saisi par l'utilisateur, nettoyé : espaces réduits, caractères de contrôle retirés, 40 caractères au plus. */
export function nettoyerTag(saisie: string): string {
  return saisie
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, TAG_LONGUEUR_MAX)
    .trim();
}

/** Forme de comparaison : minuscules, sans accents, apostrophes et tirets en espaces. */
export function cleTag(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’'`\-–_,.;:!?()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tous les tags connus, sans doublon (catalogue, puis tags personnels). */
export function tousLesTags(perso: string[] = []): string[] {
  const vus = new Set<string>();
  const liste: string[] = [];
  for (const t of [...CATALOGUE_TAGS.flatMap((c) => c.tags), ...perso]) {
    const k = cleTag(t);
    if (!k || vus.has(k)) continue;
    vus.add(k);
    liste.push(t);
  }
  return liste;
}

/**
 * Recherche par les premières lettres : un tag est retenu si l'un de ses mots commence par la
 * saisie (« cal » → « Calorifuge », « Chemin de câbles » ; « ve d » → « Vase d'expansion »).
 */
export function rechercherTags(tags: string[], requete: string): string[] {
  const q = cleTag(requete);
  if (!q) return tags;
  return tags.filter((t) => {
    const k = cleTag(t);
    if (k.startsWith(q)) return true;
    const mots = k.split(' ');
    const morceaux = q.split(' ');
    if (morceaux.length === 1) return mots.some((m) => m.startsWith(q));
    // Plusieurs morceaux : chacun doit commencer un mot, dans l'ordre.
    let i = 0;
    for (const m of mots) if (i < morceaux.length && m.startsWith(morceaux[i])) i++;
    return i === morceaux.length;
  });
}

/** Les puces : favoris d'abord, puis récents, puis tags par défaut, sans doublon, NB_PUCES au plus. */
export function puces(favoris: string[], recents: string[], nb = NB_PUCES): string[] {
  const liste: string[] = [];
  const vus = new Set<string>();
  for (const t of [...favoris, ...recents, ...PUCES_PAR_DEFAUT]) {
    const k = cleTag(t);
    if (vus.has(k)) continue;
    vus.add(k);
    liste.push(t);
    if (liste.length >= nb) break;
  }
  return liste;
}

/** Mots courants de la langue que certains sigles imitent : ils ne valent pas un tag dans une phrase dictée. */
const MOTS_COURANTS = new Set(['pas', 'regard', 'prise', 'bouche', 'grille', 'sonde', 'armoire']);

/**
 * Tags cités dans une phrase dictée (note vocale) : « VC non conforme, calorifuge absent avant
 * fermeture » → VC, Non conforme, Calorifuge, Avant fermeture. Comparaison sans accents ni casse,
 * sur des mots entiers ; le pluriel en s ou x est accepté ; un tag « A / B » est reconnu par A ou par B.
 * Un tag qui est aussi un mot courant (« pas », « regard ») n'est retenu que s'il est seul dans la phrase.
 * « Conforme » n'est pas retenu quand la phrase dit « non conforme ».
 */
export function tagsDansPhrase(phrase: string, tags: string[]): string[] {
  const texte = ` ${cleTag(phrase)} `;
  const trouves: string[] = [];
  for (const tag of tags) {
    const variantes = tag.split(' / ').map(cleTag).filter(Boolean);
    const present = variantes.some((v) => {
      if (MOTS_COURANTS.has(v) && cleTag(phrase) !== v) return false;
      const motif = new RegExp(`(^|\\s)${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[sx]?(?=\\s|$)`);
      return motif.test(texte);
    });
    if (present) trouves.push(tag);
  }
  // « Non conforme » l'emporte sur « Conforme ».
  const nonConforme = trouves.some((t) => cleTag(t) === 'non conforme');
  return nonConforme ? trouves.filter((t) => cleTag(t) !== 'conforme') : trouves;
}

/** Contrôle des tags d'une photo reçue par paquet. */
export function tagsValides(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    v.length <= TAGS_PAR_PHOTO_MAX &&
    v.every((t) => typeof t === 'string' && t.length > 0 && t.length <= TAG_LONGUEUR_MAX && !/[\u0000-\u001f]/.test(t))
  );
}
