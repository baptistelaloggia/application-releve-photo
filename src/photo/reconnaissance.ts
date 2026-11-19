/**
 * Reconnaissance visuelle sur l'appareil (CONCEPTION §A.6 nonies, 19/11/2026).
 *
 * Un petit réseau de neurones (MobileNet V3, fourni par Google sous licence Apache 2.0) transforme
 * chaque photo en un vecteur de 1 280 nombres : deux photos d'un même local ont des vecteurs proches.
 * Il tourne dans le navigateur (WebAssembly, bibliothèque MediaPipe) : aucune photo ne quitte
 * l'appareil, aucun service extérieur n'est appelé (CONCEPTION §A.4-7).
 *
 * Les fichiers (moteur de 15 Mo, modèle de 11 Mo) sont publiés avec l'appli, dans « reconnaissance/ »,
 * mais ne sont téléchargés qu'à la première utilisation du regroupement ; le Service Worker les garde
 * ensuite pour l'usage hors ligne. S'ils manquent (première utilisation sans réseau), le regroupement
 * se fait sur l'heure et le GPS seuls.
 */
import type { ImageEmbedder } from '@mediapipe/tasks-vision';
import { extraireExif, lireInfosExif, lirePositionGps } from './exif';
import type { PositionGps } from '../domaine/regroupement';

export const DOSSIER_RECONNAISSANCE = 'reconnaissance/';
export const FICHIER_MODELE = 'mobilenet_v3_large.tflite';

let chargement: Promise<ImageEmbedder> | null = null;

/** Charge le moteur et le modèle (une seule fois par session). */
export function chargerReconnaissance(): Promise<ImageEmbedder> {
  if (!chargement) {
    chargement = (async () => {
      const base = new URL(DOSSIER_RECONNAISSANCE, document.baseURI).href;
      const { ImageEmbedder } = await import('@mediapipe/tasks-vision');
      return ImageEmbedder.createFromOptions(
        { wasmLoaderPath: `${base}vision_wasm_internal.js`, wasmBinaryPath: `${base}vision_wasm_internal.wasm` },
        { baseOptions: { modelAssetPath: `${base}${FICHIER_MODELE}`, delegate: 'CPU' }, runningMode: 'IMAGE', l2Normalize: true, quantize: false },
      );
    })();
    chargement.catch(() => {
      chargement = null; // nouvel essai possible plus tard (réseau revenu)
    });
  }
  return chargement;
}

/** Vecteurs déjà calculés, par empreinte de photo (gardés pour la session). */
const vecteurs = new Map<string, Float32Array>();

/** Vecteur visuel normé d'une image (la miniature de 320 px suffit : le modèle travaille en 224 px). */
export async function vecteurImage(image: Blob, cle?: string): Promise<Float32Array> {
  const connu = cle ? vecteurs.get(cle) : undefined;
  if (connu) return connu;
  const moteur = await chargerReconnaissance();
  const bitmap = await createImageBitmap(image);
  try {
    const resultat = moteur.embed(bitmap).embeddings[0]?.floatEmbedding;
    if (!resultat) throw new Error('Reconnaissance : aucun vecteur obtenu.');
    const v = Float32Array.from(resultat);
    if (cle) vecteurs.set(cle, v);
    return v;
  } finally {
    bitmap.close();
  }
}

export interface IndicesExif {
  gps: PositionGps | null;
  /** La photo porte sa date de prise de vue (sinon, sa date n'est que celle du fichier). */
  dateExif: boolean;
}

/** Indices déjà lus, par empreinte de photo. */
const indices = new Map<string, IndicesExif>();

/** Position GPS et présence d'une date de prise de vue, lues dans l'en-tête EXIF (128 premiers Ko). */
export async function indicesExif(fichier: Blob, cle?: string): Promise<IndicesExif> {
  const connu = cle ? indices.get(cle) : undefined;
  if (connu) return connu;
  const entete = new Uint8Array(await fichier.slice(0, 128 * 1024).arrayBuffer());
  const app1 = extraireExif(entete);
  const resultat = { gps: app1 ? lirePositionGps(app1) : null, dateExif: !!app1 && !!lireInfosExif(app1).dateOriginale };
  if (cle) indices.set(cle, resultat);
  return resultat;
}
