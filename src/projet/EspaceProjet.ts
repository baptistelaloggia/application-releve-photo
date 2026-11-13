import {
  codeDepuisNomDossier,
  controlerNiveaux,
  estCodeNiveauValide,
  libelleNiveau,
  nomsDossiersNiveaux,
  normaliserCodeNiveau,
  rangNiveau,
} from '../domaine/niveaux';
import {
  DOSSIERS,
  estIndiceValide,
  nomDossierProjet,
  nomFichierPlan,
  nomFichierPlanArchive,
  dateLocale,
  nomDossierLocal,
  nomFichierPhoto,
  nomFichierPhotoAClasser,
  numeroRepere,
  normaliserCodeAffaire,
  normaliserIndice,
} from '../domaine/nommage';
import { VERSION_SCHEMA, type Local, type Niveau, type Photo, type Plan, type Projet, type Repere } from '../domaine/types';
import { proposerNumeroLocal, type LocalDetecte } from '../domaine/locaux';
import { rechercher } from '../domaine/recherche';
import { ecrireJson, lireJson, type Stockage } from '../stockage/Stockage';

const FICHIER_PROJET = `${DOSSIERS.donnees}/projet.json`;
const DOSSIER_NIVEAUX = `${DOSSIERS.donnees}/niveaux`;
const DOSSIER_PLANS = `${DOSSIERS.donnees}/plans`;
const DOSSIER_LOCAUX = `${DOSSIERS.donnees}/locaux`;
const DOSSIER_REPERES = `${DOSSIERS.donnees}/reperes`;
const DOSSIER_PHOTOS = `${DOSSIERS.donnees}/photos`;
const DOSSIER_MINIATURES = `${DOSSIERS.donnees}/miniatures`;
const DOSSIER_A_CLASSER = `${DOSSIERS.photos}/${DOSSIERS.aClasser}`;
/** Distance (relative à la page) au-delà de laquelle un repère n'est rattaché à aucun local. */
const DISTANCE_RATTACHEMENT = 0.06;
/** Écart entre deux niveaux dans le champ « ordre ». */
const PAS_ORDRE = 10;

export class ErreurPasUnProjet extends Error {
  constructor() {
    super(`Ce dossier n'est pas un projet : le fichier ${FICHIER_PROJET} est absent.`);
    this.name = 'ErreurPasUnProjet';
  }
}

export interface InfosNouveauProjet {
  annee: number;
  codeAffaire: string;
  nom: string;
  niveaux: string[];
}

export interface PlanAImporter {
  fichier: Blob;
  nomOrigine: string;
  /** Page d'origine, si le plan est extrait d'un carnet multi-pages. */
  pageOrigine?: number;
  /** Empreinte déjà calculée (obligatoire pour une page extraite, voir Plan.empreinte). */
  empreinte?: string;
  codeNiveau: string;
  indice: string;
  pages: number;
}

/** Ce qui se passera si l'on importe ce plan : affiché avant confirmation. */
export interface PrevisionImport {
  nomFinal: string;
  nouveauNiveau: boolean;
  /** Indice remplacé (archivé), s'il y en a un. */
  remplace: string | null;
  erreur: string | null;
}

/** Saisie d'un local (création ou modification). */
export interface SaisieLocal {
  nom: string;
  numero: string | null;
  surface: number | null;
  x: number;
  y: number;
}

/** Résultat de recherche : le local, son plan et son niveau. */
export interface ResultatLocal {
  local: Local;
  plan: Plan;
  niveau: Niveau;
}

/** Distance (relative à la page) en dessous de laquelle deux étiquettes de même nom sont un doublon. */
const DISTANCE_DOUBLON = 0.01;

const maintenant = () => new Date().toISOString();

/** Contrôle les informations saisies pour un nouveau projet ; renvoie les problèmes. */
export function controlerNouveauProjet(infos: InfosNouveauProjet): string[] {
  const problemes: string[] = [];
  if (!Number.isInteger(infos.annee) || infos.annee < 2000 || infos.annee > 2100) {
    problemes.push("L'année doit être comprise entre 2000 et 2100.");
  }
  if (!infos.codeAffaire || infos.codeAffaire !== normaliserCodeAffaire(infos.codeAffaire)) {
    problemes.push("Le code d'affaire ne doit contenir que des lettres majuscules, des chiffres ou des tirets.");
  }
  if (!nomDossierProjet(infos.annee, infos.codeAffaire, infos.nom).split('_')[1]) {
    problemes.push('Le nom du projet est vide.');
  }
  if (infos.niveaux.length === 0) problemes.push('Il faut au moins un niveau.');
  problemes.push(...controlerNiveaux(infos.niveaux));
  return problemes;
}

/**
 * Un projet ouvert : son dossier (via l'interface Stockage) et ses données.
 * Toutes les écritures passent par ici, pour garantir l'arborescence normalisée.
 */
export class EspaceProjet {
  private constructor(
    readonly stockage: Stockage,
    public projet: Projet,
    public niveaux: Niveau[],
    public plans: Plan[],
    public locaux: Local[],
    public reperes: Repere[],
    public photos: Photo[],
    /** Fichiers de données illisibles rencontrés à l'ouverture. */
    public avertissements: string[],
  ) {}

  // ---------------------------------------------------------------- création, ouverture

  /** Crée un projet dans un dossier vide (qui deviendra « 2026-XXX_NomProjet »). */
  static async creer(stockage: Stockage, infos: InfosNouveauProjet, auteur: string): Promise<EspaceProjet> {
    const problemes = controlerNouveauProjet(infos);
    if (problemes.length) throw new Error(problemes.join('\n'));
    if (await stockage.existe(FICHIER_PROJET)) throw new Error('Ce dossier contient déjà un projet.');

    const projet: Projet = {
      schema: VERSION_SCHEMA,
      id: crypto.randomUUID(),
      annee: infos.annee,
      codeAffaire: infos.codeAffaire,
      nom: infos.nom.trim(),
      dossier: nomDossierProjet(infos.annee, infos.codeAffaire, infos.nom),
      creeLe: maintenant(),
      creePar: auteur,
    };
    const espace = new EspaceProjet(stockage, projet, [], [], [], [], [], []);
    const codes = [...infos.niveaux].sort((a, b) => rangNiveau(a) - rangNiveau(b));
    for (const [i, code] of codes.entries()) {
      const niveau: Niveau = {
        schema: VERSION_SCHEMA,
        id: crypto.randomUUID(),
        code,
        ordre: i * PAS_ORDRE,
        creeLe: projet.creeLe,
        creePar: auteur,
      };
      await ecrireJson(stockage, `${DOSSIER_NIVEAUX}/${niveau.id}.json`, niveau);
      espace.niveaux.push(niveau);
    }
    await espace.appliquerArborescence();
    // projet.json en dernier : sa présence signifie « projet complet ».
    await ecrireJson(stockage, FICHIER_PROJET, projet);
    return espace;
  }

  /** Ouvre un projet existant et relit toutes ses données. */
  static async ouvrir(stockage: Stockage): Promise<EspaceProjet> {
    if (!(await stockage.existe(FICHIER_PROJET))) throw new ErreurPasUnProjet();
    const projet = await lireJson<Projet>(stockage, FICHIER_PROJET);
    const espace = new EspaceProjet(stockage, projet, [], [], [], [], [], []);
    await espace.recharger();
    return espace;
  }

  /** Relit niveaux et plans depuis le disque (par ex. après modification par un collègue). */
  async recharger(): Promise<void> {
    const debut = performance.now();
    this.avertissements = [];
    this.illisibles = [];
    this.fichiersLus = 0;
    this.detailLecture = [];
    // Les dossiers sont lus en même temps : sur un lecteur réseau, chaque accès a un temps
    // de latence, qui se recouvre ainsi au lieu de s'additionner.
    const mesurer = async <T>(libelle: string, lecture: () => Promise<T>): Promise<T> => {
      const t0 = performance.now();
      const v = await lecture();
      const n = Array.isArray(v) ? ` (${v.length})` : '';
      this.detailLecture.push(`${libelle}${n} ${((performance.now() - t0) / 1000).toFixed(1).replace('.', ',')} s`);
      return v;
    };
    const [projet, niveaux, plans, locaux, reperes, photos] = await Promise.all([
      mesurer('projet', () => lireJson<Projet>(this.stockage, FICHIER_PROJET)),
      mesurer('niveaux', () => this.lireTous<Niveau>(DOSSIER_NIVEAUX)),
      mesurer('plans', () => this.lireTous<Plan>(DOSSIER_PLANS)),
      mesurer('locaux', () => this.lireTous<Local>(DOSSIER_LOCAUX)),
      mesurer('repères', () => this.lireTous<Repere>(DOSSIER_REPERES)),
      mesurer('photos', () => this.lireTous<Photo>(DOSSIER_PHOTOS)),
    ]);
    Object.assign(this, { projet, niveaux, plans, locaux, reperes, photos });
    this.trierNiveaux();
    // Projets créés avant l'ordre modifiable : on enregistre l'ordre du bâtiment.
    if (this.niveaux.some((n) => n.ordre === undefined)) await this.renumeroter();
    this.dureeLecture = (performance.now() - debut) / 1000;
  }

  /** Durée totale de l'ouverture du projet (s), lecture comprise. */
  dureeOuverture = 0;

  /** Durée de lecture de chaque dossier de données (« locaux (224) 1,2 s »), pour le diagnostic. */
  detailLecture: string[] = [];

  /** Fichiers de données illisibles trouvés à la dernière lecture (chemins dans le projet). */
  illisibles: string[] = [];
  /** Nombre de fichiers de données lus et durée de la dernière lecture (s), pour le compte rendu. */
  fichiersLus = 0;
  dureeLecture = 0;

  /** Lit tous les JSON d'un dossier de données, en une fois (voir Stockage.lireDossier). */
  private async lireTous<T>(dossier: string): Promise<T[]> {
    const resultat: T[] = [];
    for (const f of await this.stockage.lireDossier(dossier)) {
      if (!f.nom.endsWith('.json')) continue;
      this.fichiersLus++;
      try {
        resultat.push(JSON.parse(await f.contenu.text()) as T);
      } catch {
        this.illisibles.push(`${dossier}/${f.nom}`);
        this.avertissements.push(
          `Fichier de données illisible, ignoré : ${dossier}/${f.nom} (${f.contenu.size === 0 ? 'vide : écriture interrompue ?' : `${f.contenu.size} octets`})`,
        );
      }
    }
    return resultat;
  }

  /** Niveaux dans l'ordre enregistré ; à défaut, dans l'ordre du bâtiment. */
  private trierNiveaux() {
    this.niveaux.sort((a, b) =>
      a.ordre !== undefined && b.ordre !== undefined ? a.ordre - b.ordre : rangNiveau(a.code) - rangNiveau(b.code),
    );
  }

  /** Réécrit l'ordre 0, 10, 20… selon la position actuelle (seuls les niveaux modifiés sont réécrits). */
  private async renumeroter() {
    for (const [i, n] of this.niveaux.entries()) {
      if (n.ordre === i * PAS_ORDRE) continue;
      n.ordre = i * PAS_ORDRE;
      await ecrireJson(this.stockage, `${DOSSIER_NIVEAUX}/${n.id}.json`, n);
    }
  }

  /** Libellé affiché d'un niveau : celui saisi pour un niveau intermédiaire, sinon le libellé standard. */
  libelle(n: Niveau): string {
    return n.libelle ?? libelleNiveau(n.code);
  }

  // ---------------------------------------------------------------- arborescence

  /** Nom du dossier de photos d'un niveau, par ex. « 02_R+1 ». */
  dossierNiveau(code: string): string {
    const nom = nomsDossiersNiveaux(this.niveaux.map((n) => n.code)).get(code);
    if (!nom) throw new Error(`Niveau inconnu : ${code}`);
    return `${DOSSIERS.photos}/${nom}`;
  }

  /**
   * Crée les dossiers manquants et renomme les dossiers de niveau dont le numéro
   * d'ordre a changé. Sans effet si tout est déjà en ordre. Renvoie le compte rendu.
   */
  async appliquerArborescence(): Promise<string[]> {
    const compteRendu: string[] = [];
    for (const d of [
      DOSSIERS.plans,
      `${DOSSIERS.plans}/${DOSSIERS.plansAnciens}`,
      DOSSIERS.photos,
      DOSSIERS.exports,
      DOSSIER_NIVEAUX,
      DOSSIER_PLANS,
      DOSSIER_LOCAUX,
      DOSSIER_REPERES,
      DOSSIER_PHOTOS,
      DOSSIER_MINIATURES,
      DOSSIER_A_CLASSER,
    ]) {
      if (!(await this.stockage.existe(d))) {
        await this.stockage.creerDossier(d);
        compteRendu.push(`Dossier créé : ${d}`);
      }
    }

    const attendus = nomsDossiersNiveaux(this.niveaux.map((n) => n.code));
    const presents = await this.stockage.lister(DOSSIERS.photos);
    const nomsPresents = new Set(presents.map((e) => e.nom));

    for (const e of presents) {
      if (e.type !== 'dossier') continue;
      const code = codeDepuisNomDossier(e.nom);
      const attendu = code ? attendus.get(code) : undefined;
      if (!attendu || attendu === e.nom) continue;
      if (nomsPresents.has(attendu)) {
        compteRendu.push(
          `Attention : deux dossiers pour le niveau ${code} (${e.nom} et ${attendu}). ` +
            `Regroupez leur contenu à la main dans ${attendu}.`,
        );
        continue;
      }
      await this.stockage.deplacer(`${DOSSIERS.photos}/${e.nom}`, `${DOSSIERS.photos}/${attendu}`);
      await this.majCheminsPhotos(`${DOSSIERS.photos}/${e.nom}/`, `${DOSSIERS.photos}/${attendu}/`);
      nomsPresents.delete(e.nom);
      nomsPresents.add(attendu);
      compteRendu.push(`Dossier renommé : ${e.nom} → ${attendu}`);
    }

    for (const attendu of attendus.values()) {
      if (!nomsPresents.has(attendu)) {
        await this.stockage.creerDossier(`${DOSSIERS.photos}/${attendu}`);
        compteRendu.push(`Dossier créé : ${DOSSIERS.photos}/${attendu}`);
      }
    }
    return compteRendu;
  }

  // ---------------------------------------------------------------- niveaux

  niveauParCode(code: string): Niveau | undefined {
    return this.niveaux.find((n) => n.code === code);
  }

  /** Ajoute un niveau et renumérote les dossiers. Renvoie le compte rendu. */
  async ajouterNiveau(saisie: string, auteur: string): Promise<string[]> {
    const code = normaliserCodeNiveau(saisie);
    const problemes = controlerNiveaux([...this.niveaux.map((n) => n.code), code]);
    if (problemes.length) throw new Error(problemes.join('\n'));
    const standard = estCodeNiveauValide(code);
    const niveau: Niveau = {
      schema: VERSION_SCHEMA,
      id: crypto.randomUUID(),
      code,
      ...(standard ? {} : { libelle: saisie.trim().replace(/\s+/g, ' ') }),
      creeLe: maintenant(),
      creePar: auteur,
    };
    // Position proposée : après le dernier niveau situé plus bas dans le bâtiment
    // (« R+4-MEZZANINE » juste après R+4). L'utilisateur peut ensuite le déplacer.
    const rang = rangNiveau(code);
    let position = 0;
    this.niveaux.forEach((n, i) => {
      if (rangNiveau(n.code) <= rang) position = i + 1;
    });
    this.niveaux.splice(position, 0, niveau);
    await ecrireJson(this.stockage, `${DOSSIER_NIVEAUX}/${niveau.id}.json`, niveau);
    await this.renumeroter();
    return [`Niveau ajouté : ${code} (${this.libelle(niveau)})`, ...(await this.appliquerArborescence())];
  }

  /** Déplace un niveau d'un cran vers le haut (+1) ou vers le bas (-1) et renumérote les dossiers. */
  async deplacerNiveau(id: string, sens: 1 | -1): Promise<string[]> {
    const i = this.niveaux.findIndex((n) => n.id === id);
    if (i < 0) throw new Error('Niveau introuvable.');
    const j = i + sens;
    if (j < 0 || j >= this.niveaux.length) return [];
    [this.niveaux[i], this.niveaux[j]] = [this.niveaux[j], this.niveaux[i]];
    await this.renumeroter();
    const n = this.niveaux[j];
    return [
      `Niveau ${n.code} déplacé vers le ${sens > 0 ? 'haut' : 'bas'}`,
      ...(await this.appliquerArborescence()),
    ];
  }

  /** Supprime un niveau, seulement s'il n'a ni plan ni photo. */
  async supprimerNiveau(id: string): Promise<string[]> {
    const niveau = this.niveaux.find((n) => n.id === id);
    if (!niveau) throw new Error('Niveau introuvable.');
    if (this.plans.some((p) => p.niveauId === id)) {
      throw new Error(`Le niveau ${niveau.code} a un plan : il ne peut pas être supprimé.`);
    }
    const dossier = this.dossierNiveau(niveau.code);
    if ((await this.stockage.existe(dossier)) && (await this.stockage.lister(dossier)).length > 0) {
      throw new Error(`Le dossier ${dossier} n'est pas vide : le niveau ne peut pas être supprimé.`);
    }
    await this.stockage.supprimer(dossier);
    await this.stockage.supprimer(`${DOSSIER_NIVEAUX}/${id}.json`);
    this.niveaux = this.niveaux.filter((n) => n.id !== id);
    return [`Niveau supprimé : ${niveau.code}`, ...(await this.appliquerArborescence())];
  }

  // ---------------------------------------------------------------- plans

  planDuNiveau(niveauId: string): Plan | undefined {
    return this.plans.find((p) => p.niveauId === niveauId);
  }

  /** Prévoit le résultat d'un import, sans rien écrire. */
  prevoirImport(codeNiveauSaisi: string, indiceSaisi: string, empreinte?: string): PrevisionImport {
    const code = normaliserCodeNiveau(codeNiveauSaisi);
    const indice = normaliserIndice(indiceSaisi);
    const nomFinal = nomFichierPlan(this.projet.codeAffaire, code);
    const prevision: PrevisionImport = { nomFinal, nouveauNiveau: false, remplace: null, erreur: null };
    const niveau = this.niveauParCode(code);
    if (!niveau) {
      const problemes = controlerNiveaux([...this.niveaux.map((n) => n.code), code]);
      if (problemes.length) return { ...prevision, erreur: problemes.join(' ') };
      prevision.nouveauNiveau = true;
    }
    if (!estIndiceValide(indice)) return { ...prevision, erreur: 'Indice manquant ou non conforme (ex. A, B, 01).' };
    const plan = niveau && this.planDuNiveau(niveau.id);
    if (plan) {
      if (empreinte && plan.empreinte === empreinte) {
        return { ...prevision, erreur: `Ce fichier est déjà le plan courant du niveau ${code}.` };
      }
      if (plan.indice === indice || plan.historique.some((h) => h.indice === indice)) {
        return { ...prevision, erreur: `L'indice ${indice} existe déjà pour le niveau ${code}.` };
      }
      prevision.remplace = plan.indice;
    }
    return prevision;
  }

  /**
   * Importe un plan PDF sous son nom normalisé « XXX_R+1.pdf ».
   * Si le niveau a déjà un plan, l'ancien indice est archivé dans 00_PLANS/_ANCIENS/.
   */
  async importerPlan(aImporter: PlanAImporter, auteur: string): Promise<string[]> {
    const empreinte = aImporter.empreinte ?? (await calculerEmpreinte(aImporter.fichier));
    const prevision = this.prevoirImport(aImporter.codeNiveau, aImporter.indice, empreinte);
    if (prevision.erreur) throw new Error(prevision.erreur);
    const code = normaliserCodeNiveau(aImporter.codeNiveau);
    const indice = normaliserIndice(aImporter.indice);
    const compteRendu: string[] = [];

    if (prevision.nouveauNiveau) compteRendu.push(...(await this.ajouterNiveau(code, auteur)));
    const niveau = this.niveauParCode(code)!;
    const chemin = `${DOSSIERS.plans}/${prevision.nomFinal}`;
    const date = maintenant();
    const existant = this.planDuNiveau(niveau.id);

    let plan: Plan;
    if (existant) {
      const archive = `${DOSSIERS.plans}/${DOSSIERS.plansAnciens}/${nomFichierPlanArchive(
        this.projet.codeAffaire,
        code,
        existant.indice,
      )}`;
      await this.stockage.deplacer(existant.fichier, archive);
      try {
        await this.stockage.ecrireFichier(chemin, aImporter.fichier);
      } catch (e) {
        // On remet l'ancien plan en place avant de signaler l'erreur.
        await this.stockage.deplacer(archive, existant.fichier).catch(() => undefined);
        throw e;
      }
      compteRendu.push(`Indice ${existant.indice} archivé : ${archive}`);
      plan = {
        ...existant,
        indice,
        fichier: chemin,
        nomOrigine: aImporter.nomOrigine,
        pageOrigine: aImporter.pageOrigine,
        pages: aImporter.pages,
        taille: aImporter.fichier.size,
        empreinte,
        importeLe: date,
        importePar: auteur,
        historique: [
          ...existant.historique,
          {
            indice: existant.indice,
            fichier: archive,
            nomOrigine: existant.nomOrigine,
            pageOrigine: existant.pageOrigine,
            empreinte: existant.empreinte,
            importeLe: existant.importeLe,
            importePar: existant.importePar,
            archiveLe: date,
            archivePar: auteur,
          },
        ],
      };
    } else {
      if (await this.stockage.existe(chemin)) {
        throw new Error(`Le fichier ${chemin} existe déjà sans être connu de l'application : vérifiez le dossier.`);
      }
      await this.stockage.ecrireFichier(chemin, aImporter.fichier);
      plan = {
        schema: VERSION_SCHEMA,
        id: crypto.randomUUID(),
        niveauId: niveau.id,
        indice,
        fichier: chemin,
        nomOrigine: aImporter.nomOrigine,
        pageOrigine: aImporter.pageOrigine,
        pages: aImporter.pages,
        taille: aImporter.fichier.size,
        empreinte,
        importeLe: date,
        importePar: auteur,
        historique: [],
      };
    }
    await ecrireJson(this.stockage, `${DOSSIER_PLANS}/${plan.id}.json`, plan);
    this.plans = [...this.plans.filter((p) => p.id !== plan.id), plan];
    const origine = aImporter.pageOrigine ? `${aImporter.nomOrigine}, page ${aImporter.pageOrigine}` : aImporter.nomOrigine;
    compteRendu.push(`Plan importé : ${origine} → ${chemin} (indice ${indice})`);
    return compteRendu;
  }

  async lirePlan(plan: Plan): Promise<Blob> {
    return this.stockage.lireFichier(plan.fichier);
  }

  planParId(id: string): Plan | undefined {
    return this.plans.find((p) => p.id === id);
  }

  niveauDuPlan(plan: Plan): Niveau {
    const n = this.niveaux.find((x) => x.id === plan.niveauId);
    if (!n) throw new Error(`Niveau introuvable pour le plan ${plan.fichier}`);
    return n;
  }

  // ---------------------------------------------------------------- locaux

  locauxDuPlan(planId: string): Local[] {
    return this.locaux
      .filter((l) => l.planId === planId)
      .sort((a, b) => (a.numero ?? a.nom).localeCompare(b.numero ?? b.nom, 'fr', { numeric: true }));
  }

  /** Contrôle une saisie ; renvoie la saisie nettoyée ou lève une erreur explicite. */
  private controlerLocal(saisie: SaisieLocal, idModifie?: string): SaisieLocal {
    const nom = saisie.nom.trim().replace(/\s+/g, ' ');
    const numero = saisie.numero?.trim().toUpperCase() || null;
    if (!nom) throw new Error('Le nom du local est obligatoire.');
    if (numero && !/^[A-Z0-9.+-]{1,12}$/.test(numero)) {
      throw new Error('Le numéro ne doit contenir que des lettres, des chiffres, des points ou des tirets (12 caractères au plus).');
    }
    if (numero) {
      const doublon = this.locaux.find((l) => l.numero === numero && l.id !== idModifie);
      if (doublon) {
        const plan = this.planParId(doublon.planId);
        const niveau = plan ? this.niveauDuPlan(plan).code : '?';
        throw new Error(`Le numéro ${numero} est déjà utilisé (${doublon.nom}, niveau ${niveau}).`);
      }
    }
    if (saisie.surface !== null && !(saisie.surface > 0 && saisie.surface < 1_000_000)) {
      throw new Error('Surface non valable.');
    }
    if (!(saisie.x >= 0 && saisie.x <= 1 && saisie.y >= 0 && saisie.y <= 1)) {
      throw new Error('Position hors du plan.');
    }
    return { ...saisie, nom, numero };
  }

  private async ecrireLocal(local: Local) {
    await ecrireJson(this.stockage, `${DOSSIER_LOCAUX}/${local.id}.json`, local);
    this.locaux = [...this.locaux.filter((l) => l.id !== local.id), local];
  }

  /** Numéro automatique libre pour un nouveau local de ce plan (« R2-03 »). */
  proposerNumero(planId: string): string {
    const plan = this.planParId(planId);
    if (!plan) throw new Error('Plan introuvable.');
    return proposerNumeroLocal(
      this.niveauDuPlan(plan).code,
      this.locaux.flatMap((l) => (l.numero ? [l.numero] : [])),
    );
  }

  async creerLocal(planId: string, saisie: SaisieLocal, auteur: string, origine: Local['origine'] = 'manuel'): Promise<Local> {
    if (!this.planParId(planId)) throw new Error('Plan introuvable.');
    const propre = this.controlerLocal(saisie);
    const date = maintenant();
    const local: Local = {
      schema: VERSION_SCHEMA,
      id: crypto.randomUUID(),
      planId,
      ...propre,
      origine,
      creeLe: date,
      creePar: auteur,
      modifieLe: date,
      modifiePar: auteur,
    };
    await this.ecrireLocal(local);
    return local;
  }

  async modifierLocal(id: string, saisie: SaisieLocal, auteur: string): Promise<Local> {
    const existant = this.locaux.find((l) => l.id === id);
    if (!existant) throw new Error('Local introuvable.');
    const propre = this.controlerLocal(saisie, id);
    const local: Local = { ...existant, ...propre, modifieLe: maintenant(), modifiePar: auteur };
    await this.ecrireLocal(local);
    // Le numéro et le nom du local figurent dans les noms des dossiers et des photos.
    if (local.numero !== existant.numero || local.nom !== existant.nom) {
      await this.rangerPhotos(this.photos.filter((p) => this.repereDe(p)?.localId === id));
    }
    // Le repère d'étiquette suit l'étiquette du local.
    if (local.x !== existant.x || local.y !== existant.y) {
      for (const r of this.reperes.filter((x) => x.localId === id && x.surEtiquette)) {
        await this.ecrireRepere({ ...r, x: local.x, y: local.y, modifieLe: local.modifieLe, modifiePar: auteur });
      }
    }
    return local;
  }

  /**
   * Attribue un numéro automatique (« R2-04 ») à chaque local qui n'en a pas, sur un plan ou sur
   * tout le projet. Ordre de lecture du plan : de haut en bas, puis de gauche à droite.
   */
  async numeroterLocauxSansNumero(auteur: string, planId?: string): Promise<string[]> {
    const cibles = this.locaux
      .filter((l) => !l.numero && (!planId || l.planId === planId))
      .sort((a, b) => a.planId.localeCompare(b.planId) || Math.round((a.y - b.y) * 50) || a.x - b.x);
    for (const l of cibles) {
      await this.modifierLocal(l.id, { ...l, numero: this.proposerNumero(l.planId) }, auteur);
    }
    return [`${cibles.length} ${cibles.length > 1 ? 'locaux numérotés' : 'local numéroté'} automatiquement`];
  }

  /** Supprime un local ; ses repères deviennent « hors local » et leurs photos sont rangées en conséquence. */
  async supprimerLocal(id: string, auteur = '?'): Promise<void> {
    await this.stockage.supprimer(`${DOSSIER_LOCAUX}/${id}.json`);
    this.locaux = this.locaux.filter((l) => l.id !== id);
    for (const r of this.reperes.filter((x) => x.localId === id)) {
      // Le repère d'étiquette redevient un repère ordinaire, visible à sa place sur le plan.
      const { surEtiquette: _surEtiquette, ...ordinaire } = r;
      await this.ecrireRepere({ ...ordinaire, localId: null, modifieLe: maintenant(), modifiePar: auteur });
    }
    await this.rangerPhotos(this.photos.filter((p) => p.repereId && !this.repereDe(p)?.localId));
  }

  /**
   * Indique si un local détecté existe déjà sur ce plan : même numéro dans le projet,
   * ou même nom à la même place. Sert à relancer la détection sans créer de doublons.
   */
  dejaPresent(planId: string, d: Pick<LocalDetecte, 'numero' | 'nom' | 'x' | 'y'>): Local | undefined {
    const numero = d.numero?.toUpperCase();
    return this.locaux.find(
      (l) =>
        (numero && l.numero === numero) ||
        (l.planId === planId &&
          l.nom.toUpperCase() === d.nom.trim().toUpperCase() &&
          Math.hypot(l.x - d.x, l.y - d.y) < DISTANCE_DOUBLON),
    );
  }

  /** Enregistre les locaux détectés retenus par l'utilisateur. Renvoie le compte rendu. */
  async enregistrerDetection(planId: string, retenus: LocalDetecte[], auteur: string): Promise<string[]> {
    let crees = 0;
    const compteRendu: string[] = [];
    for (const d of retenus) {
      if (this.dejaPresent(planId, d)) {
        compteRendu.push(`Déjà présent, ignoré : ${d.numero ?? ''} ${d.nom}`.replace('  ', ' '));
        continue;
      }
      try {
        await this.creerLocal(planId, { nom: d.nom, numero: d.numero, surface: d.surface, x: d.x, y: d.y }, auteur, 'auto');
        crees++;
      } catch (e) {
        compteRendu.push(`Attention : ${d.nom} non enregistré (${e instanceof Error ? e.message : String(e)})`);
      }
    }
    const plan = this.planParId(planId);
    compteRendu.unshift(`${crees} ${crees > 1 ? 'locaux' : 'local'} enregistré${crees > 1 ? 's' : ''} sur le plan ${plan?.fichier.split('/').pop() ?? ''}`);
    return compteRendu;
  }

  // ---------------------------------------------------------------- repères

  repereDe(photo: Photo): Repere | undefined {
    return photo.repereId ? this.reperes.find((r) => r.id === photo.repereId) : undefined;
  }

  reperesDuPlan(planId: string): Repere[] {
    return this.reperes.filter((r) => r.planId === planId).sort((a, b) => a.numero.localeCompare(b.numero, 'fr', { numeric: true }));
  }

  /** Photos d'un repère, de la plus ancienne à la plus récente. */
  photosDuRepere(repereId: string): Photo[] {
    return this.photos.filter((p) => p.repereId === repereId).sort((a, b) => a.prisLe.localeCompare(b.prisLe));
  }

  /** Photos du panier (prises sans repère), de la plus récente à la plus ancienne. */
  photosAClasser(): Photo[] {
    return this.photos.filter((p) => !p.repereId).sort((a, b) => b.prisLe.localeCompare(a.prisLe));
  }

  /** Local le plus proche d'un point, s'il est assez près (les locaux sont des points, pas des contours). */
  localProche(planId: string, x: number, y: number): Local | null {
    let meilleur: Local | null = null;
    let distance = DISTANCE_RATTACHEMENT;
    for (const l of this.locaux) {
      if (l.planId !== planId) continue;
      const d = Math.hypot(l.x - x, l.y - y);
      if (d < distance) {
        distance = d;
        meilleur = l;
      }
    }
    return meilleur;
  }

  private async ecrireRepere(r: Repere) {
    await ecrireJson(this.stockage, `${DOSSIER_REPERES}/${r.id}.json`, r);
    this.reperes = [...this.reperes.filter((x) => x.id !== r.id), r];
  }

  /** Crée un repère ; sans local précisé, il est rattaché au local le plus proche. */
  async creerRepere(
    planId: string,
    x: number,
    y: number,
    auteur: string,
    localId?: string | null,
    options: { surEtiquette?: boolean } = {},
  ): Promise<Repere> {
    if (!this.planParId(planId)) throw new Error('Plan introuvable.');
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new Error('Position hors du plan.');
    const pris = new Set(this.reperes.map((r) => r.numero));
    let rang = this.reperes.length + 1;
    while (pris.has(numeroRepere(rang))) rang++;
    const date = maintenant();
    const repere: Repere = {
      schema: VERSION_SCHEMA,
      id: crypto.randomUUID(),
      planId,
      localId: localId === undefined ? (this.localProche(planId, x, y)?.id ?? null) : localId,
      numero: numeroRepere(rang),
      libelle: '',
      x,
      y,
      ...(options.surEtiquette ? { surEtiquette: true } : {}),
      creeLe: date,
      creePar: auteur,
      modifieLe: date,
      modifiePar: auteur,
    };
    await this.ecrireRepere(repere);
    return repere;
  }

  /** Repère d'étiquette d'un local : créé à la première photo prise ou placée sur l'étiquette du local. */
  async repereEtiquette(localId: string, auteur: string): Promise<Repere> {
    const local = this.locaux.find((l) => l.id === localId);
    if (!local) throw new Error('Local introuvable.');
    const existant = this.reperes.find((r) => r.localId === localId && r.surEtiquette);
    return existant ?? this.creerRepere(local.planId, local.x, local.y, auteur, localId, { surEtiquette: true });
  }

  /** Photos d'un local (tous ses repères), de la plus ancienne à la plus récente. */
  photosDuLocal(localId: string): Photo[] {
    const ids = new Set(this.reperes.filter((r) => r.localId === localId).map((r) => r.id));
    return this.photos.filter((p) => p.repereId && ids.has(p.repereId)).sort((a, b) => a.prisLe.localeCompare(b.prisLe));
  }

  /** Les n locaux les plus proches d'un point du plan, du plus proche au plus éloigné. */
  locauxProches(planId: string, x: number, y: number, n = 3): Local[] {
    return this.locaux
      .filter((l) => l.planId === planId)
      .map((l) => ({ l, d: Math.hypot(l.x - x, l.y - y) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, n)
      .map((v) => v.l);
  }

  async modifierRepere(id: string, maj: Partial<Pick<Repere, 'libelle' | 'localId' | 'x' | 'y'>>, auteur: string): Promise<Repere> {
    const existant = this.reperes.find((r) => r.id === id);
    if (!existant) throw new Error('Repère introuvable.');
    if (maj.localId && !this.locaux.some((l) => l.id === maj.localId)) throw new Error('Local introuvable.');
    const repere: Repere = { ...existant, ...maj, libelle: (maj.libelle ?? existant.libelle).trim(), modifieLe: maintenant(), modifiePar: auteur };
    await this.ecrireRepere(repere);
    if (repere.localId !== existant.localId) await this.rangerPhotos(this.photosDuRepere(id));
    return repere;
  }

  /** Supprime un repère sans photo (les photos ne sont jamais supprimées par ricochet). */
  async supprimerRepere(id: string): Promise<void> {
    if (this.photos.some((p) => p.repereId === id)) {
      throw new Error('Ce repère a des photos : supprimez-les ou renvoyez-les au panier avant de supprimer le repère.');
    }
    await this.stockage.supprimer(`${DOSSIER_REPERES}/${id}.json`);
    this.reperes = this.reperes.filter((r) => r.id !== id);
  }

  // ---------------------------------------------------------------- photos

  /** Chemin où la photo doit se trouver, d'après son repère, son local, son niveau et sa date. */
  cheminAttendu(photo: Photo): string {
    const repere = this.repereDe(photo);
    if (!repere) {
      // Photo du panier : son nom ne dépend de rien d'autre, il ne change pas.
      return photo.fichier.startsWith(`${DOSSIER_A_CLASSER}/`)
        ? photo.fichier
        : `${DOSSIER_A_CLASSER}/${nomFichierPhotoAClasser(this.projet.codeAffaire, new Date(photo.prisLe), photo.id)}`;
    }
    const plan = this.planParId(repere.planId);
    if (!plan) throw new Error(`Plan introuvable pour le repère ${repere.numero}`);
    const niveau = this.niveauDuPlan(plan);
    const local = repere.localId ? (this.locaux.find((l) => l.id === repere.localId) ?? null) : null;
    return [
      this.dossierNiveau(niveau.code),
      nomDossierLocal(niveau.code, local),
      nomFichierPhoto(this.projet.codeAffaire, niveau.code, local?.numero ?? null, repere.numero, photo.date, photo.rang),
    ].join('/');
  }

  /** Premier rang libre pour un repère et un jour donnés. */
  private rangLibre(repereId: string, date: string, sauf?: string): number {
    const pris = new Set(this.photos.filter((p) => p.repereId === repereId && p.date === date && p.id !== sauf).map((p) => p.rang));
    let rang = 1;
    while (pris.has(rang)) rang++;
    return rang;
  }

  /** Un local photographé doit avoir un numéro : il figure dans les noms de fichiers. */
  private async numeroterLocalDuRepere(repereId: string | null, auteur: string) {
    const repere = repereId ? this.reperes.find((r) => r.id === repereId) : undefined;
    const local = repere?.localId ? this.locaux.find((l) => l.id === repere.localId) : undefined;
    if (local && !local.numero) {
      await this.modifierLocal(local.id, { ...local, numero: this.proposerNumero(local.planId) }, auteur);
    }
  }

  /**
   * Enregistre une photo (déjà compressée) : le JPEG à son nom normalisé, sa miniature et son JSON.
   * Sans repère, la photo va dans le panier à classer.
   */
  async ajouterPhoto(
    entree: {
      repereId: string | null;
      jpeg: Blob;
      miniature: Blob;
      largeur: number;
      hauteur: number;
      source: Photo['source'];
      prisLe?: Date;
      nomOrigine?: string;
      commentaire?: string;
    },
    auteur: string,
  ): Promise<Photo> {
    if (entree.repereId && !this.reperes.some((r) => r.id === entree.repereId)) throw new Error('Repère introuvable.');
    await this.numeroterLocalDuRepere(entree.repereId, auteur);
    const prisLe = entree.prisLe ?? new Date();
    const date = dateLocale(prisLe);
    const id = crypto.randomUUID();
    const photo: Photo = {
      schema: VERSION_SCHEMA,
      id,
      repereId: entree.repereId,
      fichier: '',
      miniature: `${DOSSIER_MINIATURES}/${id}.jpg`,
      date,
      prisLe: prisLe.toISOString(),
      prisPar: auteur,
      rang: entree.repereId ? this.rangLibre(entree.repereId, date) : 0,
      largeur: entree.largeur,
      hauteur: entree.hauteur,
      taille: entree.jpeg.size,
      empreinte: await calculerEmpreinte(entree.jpeg),
      commentaire: entree.commentaire?.trim() ?? '',
      source: entree.source,
      ...(entree.nomOrigine ? { nomOrigine: entree.nomOrigine } : {}),
    };
    photo.fichier = this.cheminAttendu(photo);
    if (await this.stockage.existe(photo.fichier)) throw new Error(`Le fichier ${photo.fichier} existe déjà.`);
    await this.stockage.ecrireFichier(photo.fichier, entree.jpeg);
    await this.stockage.ecrireFichier(photo.miniature, entree.miniature);
    await ecrireJson(this.stockage, `${DOSSIER_PHOTOS}/${id}.json`, photo);
    this.photos = [...this.photos, photo];
    return photo;
  }

  private async ecrirePhoto(p: Photo) {
    await ecrireJson(this.stockage, `${DOSSIER_PHOTOS}/${p.id}.json`, p);
    this.photos = [...this.photos.filter((x) => x.id !== p.id), p];
  }

  /** Classe une photo du panier sur un repère (ou la renvoie au panier avec null). */
  async classerPhoto(photoId: string, repereId: string | null, auteur: string): Promise<Photo> {
    const photo = this.photos.find((p) => p.id === photoId);
    if (!photo) throw new Error('Photo introuvable.');
    if (repereId && !this.reperes.some((r) => r.id === repereId)) throw new Error('Repère introuvable.');
    await this.numeroterLocalDuRepere(repereId, auteur);
    const modifiee: Photo = { ...photo, repereId, rang: repereId ? this.rangLibre(repereId, photo.date, photo.id) : 0 };
    await this.deplacerPhoto(photo, modifiee);
    return this.photos.find((p) => p.id === photoId)!;
  }

  /** Classe plusieurs photos d'un coup sur le même repère. */
  async classerPhotos(photoIds: string[], repereId: string | null, auteur: string): Promise<void> {
    for (const id of photoIds) await this.classerPhoto(id, repereId, auteur);
  }

  async commenterPhoto(photoId: string, commentaire: string): Promise<void> {
    const photo = this.photos.find((p) => p.id === photoId);
    if (!photo) throw new Error('Photo introuvable.');
    await this.ecrirePhoto({ ...photo, commentaire: commentaire.trim() });
  }

  async supprimerPhoto(photoId: string): Promise<void> {
    const photo = this.photos.find((p) => p.id === photoId);
    if (!photo) return;
    await this.stockage.supprimer(photo.fichier);
    await this.stockage.supprimer(photo.miniature);
    await this.stockage.supprimer(`${DOSSIER_PHOTOS}/${photo.id}.json`);
    this.photos = this.photos.filter((p) => p.id !== photoId);
  }

  async lirePhoto(photo: Photo): Promise<Blob> {
    return this.stockage.lireFichier(photo.fichier);
  }

  async lireMiniature(photo: Photo): Promise<Blob> {
    return this.stockage.lireFichier(photo.miniature);
  }

  /** Déplace le JPEG à son nouveau chemin, puis enregistre le JSON (dans cet ordre : jamais de JSON vers un fichier absent). */
  private async deplacerPhoto(avant: Photo, apres: Photo) {
    const chemin = this.cheminAttendu({ ...apres, fichier: avant.fichier });
    if (chemin !== avant.fichier) {
      let cible = chemin;
      if (await this.stockage.existe(cible)) {
        // Rang déjà pris sur le disque (photo d'un collègue pas encore relue) : rang suivant.
        let rang = apres.rang;
        do {
          rang++;
          cible = this.cheminAttendu({ ...apres, rang, fichier: avant.fichier });
        } while (await this.stockage.existe(cible));
        apres = { ...apres, rang };
      }
      await this.stockage.deplacer(avant.fichier, cible);
      await this.supprimerDossierSiVide(avant.fichier.split('/').slice(0, -1).join('/'));
      apres = { ...apres, fichier: cible };
    }
    await this.ecrirePhoto(apres);
  }

  /** Remet chaque photo à son chemin attendu (après modification d'un local, d'un repère…). */
  async rangerPhotos(photos: Photo[] = this.photos): Promise<string[]> {
    const compteRendu: string[] = [];
    for (const p of photos) {
      const actuelle = this.photos.find((x) => x.id === p.id);
      if (!actuelle) continue;
      const attendu = this.cheminAttendu(actuelle);
      if (attendu === actuelle.fichier) continue;
      await this.deplacerPhoto(actuelle, actuelle);
      compteRendu.push(`Photo rangée : ${attendu.split('/').pop()}`);
    }
    return compteRendu;
  }

  /** Après renommage d'un dossier de niveau, met à jour le chemin des photos qu'il contient. */
  private async majCheminsPhotos(ancien: string, nouveau: string) {
    for (const p of this.photos.filter((x) => x.fichier.startsWith(ancien))) {
      await this.ecrirePhoto({ ...p, fichier: nouveau + p.fichier.slice(ancien.length) });
    }
  }

  private async supprimerDossierSiVide(dossier: string) {
    if (!dossier.startsWith(`${DOSSIERS.photos}/`) || dossier === DOSSIER_A_CLASSER) return;
    if (dossier.split('/').length < 3) return; // jamais les dossiers de niveau
    if ((await this.stockage.existe(dossier)) && (await this.stockage.lister(dossier)).length === 0) {
      await this.stockage.supprimer(dossier);
    }
  }

  // ---------------------------------------------------------------- réparation

  /** Tous les fichiers d'un dossier et de ses sous-dossiers (chemins dans le projet). */
  private async listerRecursif(dossier: string): Promise<string[]> {
    if (!(await this.stockage.existe(dossier))) return [];
    const chemins: string[] = [];
    for (const e of await this.stockage.lister(dossier)) {
      const c = `${dossier}/${e.nom}`;
      if (e.type === 'dossier') chemins.push(...(await this.listerRecursif(c)));
      else chemins.push(c);
    }
    return chemins;
  }

  /**
   * Répare le projet après une écriture interrompue (appli fermée pendant un enregistrement,
   * coupure du réseau…) :
   * - les fichiers de données illisibles sont mis de côté dans _data/illisibles/ (jamais effacés) ;
   * - les photos présentes dans 01_PHOTOS mais inconnues de l'appli sont retrouvées : leur nom
   *   donne leur repère, leur date et leur rang ; à défaut, elles vont au panier.
   * preparer : calcule miniature et dimensions d'une photo (fourni par l'écran, qui sait décoder les images).
   */
  async reparer(
    auteur: string,
    preparer: (jpeg: Blob) => Promise<{ miniature: Blob; largeur: number; hauteur: number }>,
  ): Promise<string[]> {
    const compteRendu: string[] = [];
    for (const chemin of this.illisibles) {
      const cible = `${DOSSIERS.donnees}/illisibles/${chemin.split('/').slice(1).join('_')}`;
      if (await this.stockage.existe(cible)) await this.stockage.supprimer(cible);
      await this.stockage.deplacer(chemin, cible);
      compteRendu.push(`Fichier illisible mis de côté : ${cible}`);
    }
    this.illisibles = [];
    this.avertissements = this.avertissements.filter((a) => !a.startsWith('Fichier de données illisible'));

    const connus = new Set(this.photos.map((p) => p.fichier));
    const orphelines = (await this.listerRecursif(DOSSIERS.photos)).filter((c) => /\.jpe?g$/i.test(c) && !connus.has(c));
    const motif = /_(P\d{3,})_(\d{4}-\d{2}-\d{2})_(\d{2,})\.jpe?g$/i;
    const motifPanier = /_A-CLASSER_(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})_/;
    for (const chemin of orphelines) {
      const jpeg = await this.stockage.lireFichier(chemin);
      const nom = chemin.split('/').pop()!;
      const m = motif.exec(nom);
      const mp = motifPanier.exec(nom);
      const repere = m ? this.reperes.find((r) => r.numero === m[1]) : undefined;
      const date = m?.[2] ?? mp?.[1] ?? dateLocale(new Date());
      const heure = mp ? `${mp[2]}:${mp[3]}:${mp[4]}` : '12:00:00';
      const prisLe = new Date(`${date}T${heure}`);
      const { miniature, largeur, hauteur } = await preparer(jpeg);
      const id = crypto.randomUUID();
      const rang = repere ? (m && !this.photos.some((p) => p.repereId === repere.id && p.date === date && p.rang === +m[3]) ? +m[3] : this.rangLibre(repere.id, date)) : 0;
      const photo: Photo = {
        schema: VERSION_SCHEMA,
        id,
        repereId: repere?.id ?? null,
        fichier: chemin,
        miniature: `${DOSSIER_MINIATURES}/${id}.jpg`,
        date,
        prisLe: prisLe.toISOString(),
        prisPar: auteur,
        rang,
        largeur,
        hauteur,
        taille: jpeg.size,
        empreinte: await calculerEmpreinte(jpeg),
        commentaire: '',
        source: 'import',
        nomOrigine: nom,
      };
      await this.stockage.ecrireFichier(photo.miniature, miniature);
      await this.ecrirePhoto(photo);
      await this.rangerPhotos([photo]);
      compteRendu.push(
        repere ? `Photo retrouvée et rattachée au repère ${repere.numero} : ${nom}` : `Photo retrouvée, mise dans le panier : ${nom}`,
      );
    }
    if (compteRendu.length === 0) compteRendu.push('Rien à réparer : toutes les photos sont connues de l’application.');
    return compteRendu;
  }

  /** Locaux ayant au moins une photo prise ce jour-là (coloriés sur le plan pendant la visite). */
  locauxPhotographies(date: string): Set<string> {
    const resultat = new Set<string>();
    for (const p of this.photos) {
      if (p.date !== date) continue;
      const localId = this.repereDe(p)?.localId;
      if (localId) resultat.add(localId);
    }
    return resultat;
  }

  /** Recherche dans tous les locaux du projet, par nom, numéro et niveau. */
  rechercherLocaux(requete: string, limite = 30): ResultatLocal[] {
    const elements: Array<ResultatLocal & { nom: string; numero: string | null; codeNiveau: string }> = [];
    for (const local of this.locaux) {
      const plan = this.planParId(local.planId);
      if (!plan) continue;
      const niveau = this.niveauDuPlan(plan);
      elements.push({ local, plan, niveau, nom: local.nom, numero: local.numero, codeNiveau: niveau.code });
    }
    return rechercher(requete, elements, limite).map(({ local, plan, niveau }) => ({ local, plan, niveau }));
  }
}

/** Empreinte SHA-256 d'un fichier, en hexadécimal. */
export async function calculerEmpreinte(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((o) => o.toString(16).padStart(2, '0')).join('');
}
