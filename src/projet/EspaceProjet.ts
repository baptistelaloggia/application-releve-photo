import {
  codeDepuisNomDossier,
  controlerNiveaux,
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
  normaliserCodeAffaire,
  normaliserIndice,
} from '../domaine/nommage';
import { VERSION_SCHEMA, type Niveau, type Plan, type Projet } from '../domaine/types';
import { ecrireJson, lireJson, type Stockage } from '../stockage/Stockage';

const FICHIER_PROJET = `${DOSSIERS.donnees}/projet.json`;
const DOSSIER_NIVEAUX = `${DOSSIERS.donnees}/niveaux`;
const DOSSIER_PLANS = `${DOSSIERS.donnees}/plans`;

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
    const espace = new EspaceProjet(stockage, projet, [], [], []);
    for (const code of infos.niveaux) {
      const niveau: Niveau = {
        schema: VERSION_SCHEMA,
        id: crypto.randomUUID(),
        code,
        creeLe: projet.creeLe,
        creePar: auteur,
      };
      await ecrireJson(stockage, `${DOSSIER_NIVEAUX}/${niveau.id}.json`, niveau);
      espace.niveaux.push(niveau);
    }
    espace.trierNiveaux();
    await espace.appliquerArborescence();
    // projet.json en dernier : sa présence signifie « projet complet ».
    await ecrireJson(stockage, FICHIER_PROJET, projet);
    return espace;
  }

  /** Ouvre un projet existant et relit toutes ses données. */
  static async ouvrir(stockage: Stockage): Promise<EspaceProjet> {
    if (!(await stockage.existe(FICHIER_PROJET))) throw new ErreurPasUnProjet();
    const projet = await lireJson<Projet>(stockage, FICHIER_PROJET);
    const espace = new EspaceProjet(stockage, projet, [], [], []);
    await espace.recharger();
    return espace;
  }

  /** Relit niveaux et plans depuis le disque (par ex. après modification par un collègue). */
  async recharger(): Promise<void> {
    this.avertissements = [];
    this.projet = await lireJson<Projet>(this.stockage, FICHIER_PROJET);
    this.niveaux = await this.lireTous<Niveau>(DOSSIER_NIVEAUX);
    this.plans = await this.lireTous<Plan>(DOSSIER_PLANS);
    this.trierNiveaux();
  }

  private async lireTous<T>(dossier: string): Promise<T[]> {
    if (!(await this.stockage.existe(dossier))) return [];
    const resultat: T[] = [];
    for (const e of await this.stockage.lister(dossier)) {
      if (e.type !== 'fichier' || !e.nom.endsWith('.json')) continue;
      try {
        resultat.push(await lireJson<T>(this.stockage, `${dossier}/${e.nom}`));
      } catch {
        this.avertissements.push(`Fichier de données illisible, ignoré : ${dossier}/${e.nom}`);
      }
    }
    return resultat;
  }

  private trierNiveaux() {
    this.niveaux.sort((a, b) => rangNiveau(a.code) - rangNiveau(b.code));
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
    const niveau: Niveau = {
      schema: VERSION_SCHEMA,
      id: crypto.randomUUID(),
      code,
      creeLe: maintenant(),
      creePar: auteur,
    };
    await ecrireJson(this.stockage, `${DOSSIER_NIVEAUX}/${niveau.id}.json`, niveau);
    this.niveaux.push(niveau);
    this.trierNiveaux();
    return [`Niveau ajouté : ${code} (${libelleNiveau(code)})`, ...(await this.appliquerArborescence())];
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
}

/** Empreinte SHA-256 d'un fichier, en hexadécimal. */
export async function calculerEmpreinte(blob: Blob): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(hash)].map((o) => o.toString(16).padStart(2, '0')).join('');
}
