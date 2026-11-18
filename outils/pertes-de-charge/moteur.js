// Moteur de calcul simplifié des pertes de charge aérauliques (études de conception).
// Module pur, sans dépendance : utilisé par la page index.html et par le script verif.mjs.
// Pourra être repris plus tard par l'appli de relevé (mesure de polylignes sur les plans).
//
// Principe (voir docs/PDC_AERAULIQUE.md) : pour le circuit le plus défavorisé d'un réseau,
//   ΔP = L · j · (1 + kr)          pertes linéaires + accidents de forme répartis
//      + ζb · Pd(tronc principal)  accidents de forme concentrés près du ventilateur
//      + Σ pertes particulières    CCF, PAS, BDV, MR, terminaux, grilles…
// Chaque terme est évalué en valeur basse, probable et haute : la fourchette en sort.

/** Air à 20 °C, niveau de la mer. */
export const AIR = { rho: 1.204, nu: 1.52e-5 };

/** Diamètres normalisés des conduits circulaires (mm). */
export const DIAMETRES = [80, 100, 125, 160, 200, 250, 315, 355, 400, 450, 500, 560, 630, 710, 800, 900, 1000, 1120, 1250, 1400, 1600];

/** Diamètre hydraulique équivalent d'une gaine rectangulaire (Huebscher), en mm. */
export function diametreEquivalent(a, b) {
  return (1.3 * Math.pow(a * b, 0.625)) / Math.pow(a + b, 0.25);
}

/** Coefficient de frottement λ (Colebrook-White, laminaire sous Re = 2300). */
export function coefFrottement(re, rugositeRelative) {
  if (re <= 0) return 0;
  if (re < 2300) return 64 / re;
  let l = 0.02;
  for (let i = 0; i < 40; i++) {
    const x = -2 * Math.log10(rugositeRelative / 3.7 + 2.51 / (re * Math.sqrt(l)));
    l = 1 / (x * x);
  }
  return l;
}

/** Pression dynamique ρv²/2 (Pa). */
export const pressionDynamique = (v) => (AIR.rho * v * v) / 2;

/**
 * Perte de charge linéique d'une gaine.
 * @param {{debit:number, a:number, b?:number|null, rugosite?:number}} p
 *   debit en m³/h, a = diamètre ou largeur (mm), b = hauteur (mm) si rectangulaire, rugosité en mm,
 *   vitesseReelle : convention de calcul en rectangulaire (voir plus bas).
 * @returns {{v:number, deq:number, j:number, pd:number, re:number}}
 *   v vitesse réelle (m/s), deq diamètre équivalent (mm), j (Pa/m), pd pression dynamique (Pa).
 */
export function perteLineique({ debit, a, b = null, rugosite = 0.15, vitesseReelle = false }) {
  const q = debit / 3600;
  const rect = b != null && b > 0;
  const deq = rect ? diametreEquivalent(a, b) : a;
  const section = rect ? (a * b) / 1e6 : (Math.PI * (a / 1000) ** 2) / 4;
  const v = q / section;
  const D = deq / 1000;
  // Le diamètre de Huebscher donne la même perte linéique à débit égal : on calcule
  // donc j avec la vitesse dans le conduit circulaire équivalent (convention de la note B).
  // vitesseReelle = true : vitesse réelle de la gaine avec le diamètre équivalent
  // (convention de l'outil A, j plus faible de 10 à 20 % en rectangulaire).
  const vEq = vitesseReelle ? v : q / ((Math.PI * D * D) / 4);
  const re = (vEq * D) / AIR.nu;
  const lambda = coefFrottement(re, rugosite / 1000 / D);
  const j = ((lambda / D) * AIR.rho * vEq * vEq) / 2;
  return { v, deq, j, pd: pressionDynamique(v), re };
}

/** Plus petit diamètre normalisé donnant une vitesse ≤ vMax (m/s). */
export function diametrePourVitesse(debit, vMax) {
  const q = debit / 3600;
  for (const d of DIAMETRES) if (q / ((Math.PI * (d / 1000) ** 2) / 4) <= vMax) return d;
  return DIAMETRES[DIAMETRES.length - 1];
}

/** Gaine rectangulaire (pas de 50 mm, hauteur imposée ou rapport ≤ 2,5) donnant v ≤ vMax. */
export function rectanglePourVitesse(debit, vMax, hauteurMax = null) {
  const s = debit / 3600 / vMax; // m²
  let meilleur = null;
  for (let b = 150; b <= (hauteurMax || 1500); b += 50) {
    const a = Math.max(b, Math.ceil((s * 1e6) / b / 50) * 50);
    if (a / b > 2.5 && !hauteurMax) continue;
    const surplus = (a * b) / 1e6 - s;
    if (meilleur == null || surplus < meilleur.surplus - 1e-9) meilleur = { a, b, surplus };
  }
  return meilleur ? { a: meilleur.a, b: meilleur.b } : null;
}

// ---------------------------------------------------------------------------------------
// Pertes de charge particulières : [bas, probable, haut] en Pa par élément traversé.
// Sources : A = outil de calcul d'une entreprise de désenfumage (onglet « PDC particulières »),
//           B = note de calcul DOE d'une entreprise CVC (23 CTA d'un immeuble de bureaux).
// ---------------------------------------------------------------------------------------
export const PARTICULIERS = {
  ccf: { libelle: 'Clapet coupe-feu (CCF)', pa: [10, 20, 40], source: 'B : 20 Pa ; A : mini 10 Pa, 26 Pa en Ø200 à 340 m³/h' },
  pas: { libelle: 'Piège à son (PAS)', pa: [50, 50, 70], source: 'B : 50 Pa ; A : 70 Pa' },
  bdv: { libelle: 'Boîte à débit variable (BDV)', pa: [50, 80, 110], source: 'A : 50 Pa ; B : 110 Pa (BDV de plateau)' },
  mr: { libelle: 'Module de régulation (MR)', pa: [50, 50, 70], source: 'B : 50 Pa ; A : 70 Pa' },
  batterie: { libelle: 'Batterie terminale (chaud, froid, élec.)', pa: [40, 50, 70], source: 'A : 50 Pa' },
  volet: { libelle: 'Volet ou trappe de désenfumage + grille', pa: [25, 50, 125], source: 'A : 16 à 125 Pa selon modèle, sens et vitesse ; VCF 38 et 76 Pa' },
  grilleExt: { libelle: 'Grille extérieure (air neuf, rejet) ou sortie toiture', pa: [30, 40, 50], source: 'A : 30 Pa ; B : 50 Pa' },
};

/** Terminaux en bout du circuit le plus défavorisé (un seul par circuit). */
export const TERMINAUX = {
  aucun: { libelle: 'Aucun (compté ailleurs)', pa: [0, 0, 0], source: '' },
  grille: { libelle: 'Grille ou bouche simple', pa: [20, 30, 40], source: 'A : 30 Pa' },
  diffuseurPlenum: { libelle: 'Diffuseur ou grille avec plénum', pa: [30, 40, 60], source: 'B : 40 Pa (grille + plénum)' },
  diffuseurBdv: { libelle: 'Diffuseur avec boîte terminale (BDV + grille)', pa: [60, 80, 100], source: 'B : 80 Pa' },
  bouchAutoreglable: { libelle: 'Bouche autoréglable ou hygroréglable (VMC)', pa: [70, 100, 160], source: 'A : 70 Pa ; plage de fonctionnement fabricant [À VÉRIFIER]' },
  poutreFroide: { libelle: 'Poutre froide active', pa: [50, 80, 120], source: 'A : 50 Pa ; [À VÉRIFIER] selon fabricant' },
  hotte: { libelle: 'Hotte de cuisine ou sorbonne', pa: [100, 150, 200], source: 'A et B : 150 Pa' },
  bouchDesenfumage: { libelle: 'Bouche de désenfumage (comptée en volet)', pa: [0, 0, 0], source: '' },
};

// ---------------------------------------------------------------------------------------
// Régimes de réseau : coefficients [bas, probable, haut] calés sur les notes de référence.
//   jDim  : perte linéique de dimensionnement moyenne sur le circuit (Pa/m)
//   kr    : accidents de forme répartis, en fraction des pertes linéaires
//   zb    : somme des ζ concentrés près du ventilateur (rapportée à Pd du tronc principal)
//   vMain : vitesse du tronc principal (m/s), fonction du débit si non saisie
// ---------------------------------------------------------------------------------------
const vBassePression = (q) => Math.min(8.5, Math.max(3, 2.2 * Math.log10(Math.max(q, 100)) - 2.5));

export const REGIMES = {
  bassePression: {
    libelle: 'Réseau basse pression (soufflage, reprise, extraction)',
    jDim: [0.35, 0.5, 0.8], kr: [0.1, 0.3, 0.6], zb: [1.5, 2.5, 5],
    vMain: (q) => { const v = vBassePression(q); return [v - 1, v, v + 1.5]; },
  },
  vmc: {
    libelle: 'Réseau VMC (conduits circulaires)',
    jDim: [0.5, 0.8, 1.2], kr: [0.3, 0.6, 1.0], zb: [1.5, 3, 5],
    vMain: (q) => { const v = Math.min(6, Math.max(3, vBassePression(q) - 1)); return [v - 1, v, v + 1]; },
  },
  prise: {
    libelle: 'Prise d\'air neuf ou rejet (court, gros débit)',
    jDim: [0.3, 0.45, 0.7], kr: [0, 0.1, 0.4], zb: [0.2, 0.6, 2],
    vMain: (q) => { const v = vBassePression(q); return [v - 1, v, v + 1.5]; },
  },
  desenfumage: {
    libelle: 'Réseau de désenfumage (vitesses élevées)',
    jDim: null, kr: [0, 0.1, 0.3], zb: [3, 6, 9],
    vMain: () => [8, 10, 13],
  },
};

/** Arrondi à la dizaine supérieure (pratique des notes de calcul). */
export const arrondiDizaine = (x) => Math.ceil(x / 10 - 1e-9) * 10;

const NIVEAUX = ['bas', 'probable', 'haut'];

/**
 * Pertes de charge d'un réseau (circuit le plus défavorisé), en trois niveaux.
 * @param {object} r
 *   r.regime     clé de REGIMES
 *   r.debit      m³/h (débit au ventilateur, fuites comprises en désenfumage)
 *   r.longueur   ml du circuit le plus défavorisé (ventilateur → terminal le plus éloigné)
 *   r.section    {a, b?} tronc principal en mm (facultatif ; sinon vitesse type du régime)
 *   r.jImpose    Pa/m imposé (facultatif ; sinon jDim du régime ou j du tronc en désenfumage)
 *   r.rugosite   mm (défaut 0,15 tôle galvanisée)
 *   r.vitesseReelle  convention de calcul de j en rectangulaire (défaut : débit égal)
 *   r.elements   {ccf, pas, bdv, mr, batterie, volet, grilleExt : nombres ; terminal : clé ; autres : Pa}
 * @returns {{bas:object, probable:object, haut:object, tronc:object, fourchette:object, postes:number[][]}}
 *   bas / probable / haut : détail avec chaque poste à sa valeur basse, probable ou haute ;
 *   fourchette : {bas, probable, haut} combinés (écarts quadratiques), {envBas, envHaut} enveloppe.
 */
export function calculerReseau(r) {
  const regime = REGIMES[r.regime];
  if (!regime) throw new Error(`Régime inconnu : ${r.regime}`);
  const debit = Math.max(0, Number(r.debit) || 0);
  const L = Math.max(0, Number(r.longueur) || 0);
  const rug = r.rugosite ?? 0.15;
  const el = r.elements || {};

  // Tronc principal : section saisie, sinon vitesse type (trois valeurs).
  const vTypes = regime.vMain(debit);
  const troncs = NIVEAUX.map((_, i) => {
    if (r.section && r.section.a > 0) return perteLineique({ debit, a: r.section.a, b: r.section.b || null, rugosite: rug, vitesseReelle: !!r.vitesseReelle });
    const v = vTypes[i];
    const d = Math.sqrt((4 * debit) / 3600 / Math.PI / v) * 1000; // diamètre théorique (mm)
    return { ...perteLineique({ debit, a: d, rugosite: rug }), v, pd: pressionDynamique(v) };
  });
  const troncSaisi = !!(r.section && r.section.a > 0);

  const res = {};
  NIVEAUX.forEach((niv, i) => {
    const t = troncSaisi ? troncs[0] : troncs[i];
    let j;
    if (r.jImpose > 0) j = r.jImpose;
    else if (regime.jDim) j = regime.jDim[i];
    else j = t.j; // désenfumage : collecteur à section constante
    const lineaire = L * j;
    const formeRepartie = lineaire * regime.kr[i];
    const formeConcentree = regime.zb[i] * t.pd;
    const detail = [];
    for (const [cle, def] of Object.entries(PARTICULIERS)) {
      const n = Number(el[cle]) || 0;
      if (n > 0) detail.push({ cle, libelle: def.libelle, nombre: n, pa: n * def.pa[i] });
    }
    const term = TERMINAUX[el.terminal || 'aucun'] || TERMINAUX.aucun;
    if (term.pa[i] > 0) detail.push({ cle: 'terminal', libelle: term.libelle, nombre: 1, pa: term.pa[i] });
    const autres = Number(el.autres) || 0;
    if (autres > 0) detail.push({ cle: 'autres', libelle: 'Autres pertes particulières saisies', nombre: 1, pa: autres });
    const particuliers = detail.reduce((s, d) => s + d.pa, 0);
    res[niv] = {
      j, lineaire, forme: formeRepartie + formeConcentree, formeRepartie, formeConcentree,
      particuliers, detail, total: lineaire + formeRepartie + formeConcentree + particuliers,
      vTronc: t.v, pdTronc: t.pd,
    };
  });
  res.tronc = troncSaisi ? troncs[0] : troncs[1];
  res.troncSaisi = troncSaisi;
  // Fourchette : les postes sont supposés indépendants, on combine leurs écarts
  // quadratiquement (cumuler toutes les valeurs extrêmes donnerait une enveloppe trop large).
  res.postes = postesIndependants(res);
  res.fourchette = combiner([res]);
  return res;
}

/** Postes indépendants d'un réseau : [bas, probable, haut] de chacun. */
function postesIndependants(res) {
  const p = [
    NIVEAUX.map((n) => res[n].lineaire + res[n].formeRepartie),
    NIVEAUX.map((n) => res[n].formeConcentree),
  ];
  const cles = new Set(NIVEAUX.flatMap((n) => res[n].detail.map((d) => d.cle)));
  for (const c of cles) p.push(NIVEAUX.map((n) => res[n].detail.find((d) => d.cle === c)?.pa || 0));
  return p;
}

/** Combine plusieurs réseaux (en série sur un même ventilateur) en une fourchette. */
export function combiner(reseaux) {
  let probable = 0, eb = 0, eh = 0, envBas = 0, envHaut = 0;
  for (const r of reseaux) {
    for (const [b, m, h] of r.postes) {
      probable += m; eb += (m - b) ** 2; eh += (h - m) ** 2; envBas += b; envHaut += h;
    }
  }
  return { bas: probable - Math.sqrt(eb), probable, haut: probable + Math.sqrt(eh), envBas, envHaut };
}

// ---------------------------------------------------------------------------------------
// Types de ventilateur : réseaux à décrire et ventilateurs à sélectionner.
// ---------------------------------------------------------------------------------------
export const TYPES = {
  cta: {
    libelle: 'CTA double flux',
    reseaux: {
      soufflage: { libelle: 'Soufflage', regime: 'bassePression', defaut: { longueur: 100, elements: { ccf: 2, pas: 1, bdv: 0, terminal: 'diffuseurPlenum' } } },
      airNeuf: { libelle: 'Air neuf (prise → CTA)', regime: 'prise', memeDebitQue: 'soufflage', defaut: { longueur: 15, elements: { pas: 1, grilleExt: 1 } } },
      reprise: { libelle: 'Reprise', regime: 'bassePression', defaut: { longueur: 70, elements: { ccf: 2, pas: 1, terminal: 'grille' } } },
      rejet: { libelle: 'Rejet (CTA → grille)', regime: 'prise', memeDebitQue: 'reprise', defaut: { longueur: 15, elements: { pas: 1, grilleExt: 1 } } },
    },
    ventilateurs: [
      { nom: 'Ventilateur de soufflage', reseaux: ['airNeuf', 'soufflage'] },
      { nom: 'Ventilateur de reprise', reseaux: ['reprise', 'rejet'] },
    ],
    note: 'Pression disponible = pertes externes à la CTA. Filtres, batteries et récupérateur sont comptés par le constructeur dans la sélection.',
  },
  simpleFlux: {
    libelle: 'Ventilateur simple flux (caisson)',
    reseaux: {
      principal: { libelle: 'Réseau (extraction ou insufflation)', regime: 'bassePression', defaut: { longueur: 60, elements: { ccf: 1, pas: 1, mr: 0, terminal: 'grille' } } },
      exterieur: { libelle: 'Rejet ou prise d\'air', regime: 'prise', memeDebitQue: 'principal', defaut: { longueur: 5, elements: { grilleExt: 1 } } },
    },
    ventilateurs: [{ nom: 'Caisson simple flux', reseaux: ['principal', 'exterieur'] }],
    note: 'Caisson d\'extraction ou d\'insufflation sans récupération (sanitaires, locaux techniques, locaux à pollution spécifique…).',
  },
  vmc: {
    libelle: 'VMC',
    reseaux: {
      principal: { libelle: 'Réseau d\'extraction', regime: 'vmc', defaut: { longueur: 40, elements: { ccf: 1, terminal: 'bouchAutoreglable' } } },
      exterieur: { libelle: 'Rejet', regime: 'prise', memeDebitQue: 'principal', defaut: { longueur: 3, elements: { grilleExt: 1 } } },
    },
    ventilateurs: [{ nom: 'Caisson VMC', reseaux: ['principal', 'exterieur'] }],
    note: 'La pression de la bouche la plus défavorisée doit rester dans la plage de fonctionnement du fabricant [À VÉRIFIER].',
  },
  desenfumage: {
    libelle: 'Ventilateur de désenfumage',
    reseaux: {
      principal: { libelle: 'Réseau de désenfumage (volets, collecteur)', regime: 'desenfumage', fuites: 0.05, defaut: { longueur: 80, elements: { volet: 1 } } },
      exterieur: { libelle: 'Rejet ou prise d\'air', regime: 'prise', memeDebitQue: 'principal', defaut: { longueur: 5, elements: { grilleExt: 1 } } },
    },
    ventilateurs: [{ nom: 'Ventilateur de désenfumage', reseaux: ['principal', 'exterieur'] }],
    note: 'Débit majoré des fuites des volets fermés (5 % par défaut, comme la note de référence A) [À VÉRIFIER selon nombre de volets et classe d\'étanchéité].',
  },
};

/**
 * Calcule un ventilateur : somme des réseaux qu'il dessert, marge, pression conseillée.
 * @param {string} type clé de TYPES
 * @param {Record<string, object>} saisies réseau → paramètres de calculerReseau (sans le régime)
 * @param {number} marge fraction (0,10 = 10 %)
 */
export function calculerType(type, saisies, marge = 0.1) {
  const def = TYPES[type];
  const reseaux = {};
  for (const [cle, rdef] of Object.entries(def.reseaux)) {
    const s = saisies[cle] || {};
    const debit = rdef.memeDebitQue && !(s.debit > 0) ? Number(saisies[rdef.memeDebitQue]?.debit) || 0 : Number(s.debit) || 0;
    const fuites = s.fuites ?? rdef.fuites ?? 0;
    reseaux[cle] = calculerReseau({ ...s, regime: s.regime || rdef.regime, debit: debit * (1 + fuites) });
    reseaux[cle].debit = debit * (1 + fuites);
  }
  const ventilateurs = def.ventilateurs.map((v) => {
    const f = combiner(v.reseaux.map((c) => reseaux[c]));
    return { nom: v.nom, reseaux: v.reseaux, ...f, marge, conseillee: arrondiDizaine(f.probable * (1 + marge)) };
  });
  return { reseaux, ventilateurs };
}
