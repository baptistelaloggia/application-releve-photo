/**
 * Annotations dessinées sur une photo (CONCEPTION §A.6 octies) : V vert, X rouge, texte, bulle,
 * cercle, trait à main levée. Un seul dessin, en SVG, sert à l'affichage dans l'appli et à la
 * fabrication de la copie annotée (JPEG rangé à côté de la photo).
 * Toutes les tailles sont proportionnelles au petit côté de l'image : le rendu est le même
 * quelle que soit la résolution.
 */
import type { Annotation } from './types';

export const VERT = '#1e9e3a';
export const ROUGE = '#e0281e';

/** Longueur maximale d'un texte ou d'une bulle. */
export const TEXTE_MAX = 120;
/** Nombre maximal d'annotations sur une photo, et de points d'un trait. */
export const ANNOTATIONS_MAX = 200;
export const POINTS_MAX = 1000;

const echapper = (t: string) => t.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number) => (Math.round(v * 10) / 10).toString();

/** Coupe un texte en lignes d'environ `largeur` caractères, sur les espaces. */
export function couperLignes(texte: string, largeur = 28): string[] {
  const lignes: string[] = [];
  let ligne = '';
  for (const mot of texte.trim().split(/\s+/)) {
    if (ligne && ligne.length + 1 + mot.length > largeur) {
      lignes.push(ligne);
      ligne = mot;
    } else ligne = ligne ? `${ligne} ${mot}` : mot;
  }
  if (ligne) lignes.push(ligne);
  return lignes.length ? lignes : [''];
}

/** Position proposée pour une bulle pointant sur (px, py) : au-dessus du point, ou dessous près du haut. */
export function positionBulle(px: number, py: number, largeur: number, hauteur: number): { x: number; y: number } {
  const u = Math.min(largeur, hauteur) / 100;
  const decalage = (16 * u) / hauteur;
  return { x: px, y: py > 0.3 ? py - decalage : py + decalage };
}

/** Éléments SVG des annotations, en pixels de l'image (largeur × hauteur). */
export function elementsSvg(annotations: Annotation[], largeur: number, hauteur: number): string {
  const u = Math.min(largeur, hauteur) / 100;
  const X = (v: number) => n(v * largeur);
  const Y = (v: number) => n(v * hauteur);
  const police = `font-family="Arial, Helvetica, sans-serif" font-weight="bold"`;
  const morceaux: string[] = [];
  for (const a of annotations) {
    switch (a.type) {
      case 'ok': {
        const x = a.x * largeur;
        const y = a.y * hauteur;
        const d = `M${n(x - 4.5 * u)} ${n(y)} L${n(x - 1.2 * u)} ${n(y + 3.8 * u)} L${n(x + 5.5 * u)} ${n(y - 4.5 * u)}`;
        morceaux.push(
          `<path d="${d}" fill="none" stroke="#fff" stroke-width="${n(3 * u)}" stroke-linecap="round" stroke-linejoin="round"/>`,
          `<path d="${d}" fill="none" stroke="${VERT}" stroke-width="${n(1.8 * u)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
        break;
      }
      case 'nok': {
        const x = a.x * largeur;
        const y = a.y * hauteur;
        const r = 4 * u;
        const d = `M${n(x - r)} ${n(y - r)} L${n(x + r)} ${n(y + r)} M${n(x + r)} ${n(y - r)} L${n(x - r)} ${n(y + r)}`;
        morceaux.push(
          `<path d="${d}" stroke="#fff" stroke-width="${n(3 * u)}" stroke-linecap="round"/>`,
          `<path d="${d}" stroke="${ROUGE}" stroke-width="${n(1.8 * u)}" stroke-linecap="round"/>`,
        );
        break;
      }
      case 'texte': {
        const taille = 4.2 * u;
        const lignes = couperLignes(a.texte);
        const tspans = lignes.map((l, i) => `<tspan x="${X(a.x)}" dy="${i ? n(taille * 1.2) : 0}">${echapper(l)}</tspan>`).join('');
        morceaux.push(
          `<text x="${X(a.x)}" y="${Y(a.y)}" ${police} font-size="${n(taille)}" text-anchor="middle" dominant-baseline="middle" fill="#fff" stroke="#000" stroke-width="${n(0.9 * u)}" paint-order="stroke" stroke-linejoin="round">${tspans}</text>`,
        );
        break;
      }
      case 'bulle': {
        const taille = 3.6 * u;
        const lignes = couperLignes(a.texte);
        const larg = Math.max(...lignes.map((l) => l.length), 3) * taille * 0.58 + 3 * u;
        const haut = lignes.length * taille * 1.2 + 2 * u;
        // La bulle reste entière dans l'image.
        const cx = Math.min(Math.max(a.x * largeur, larg / 2 + u), largeur - larg / 2 - u);
        const cy = Math.min(Math.max(a.y * hauteur, haut / 2 + u), hauteur - haut / 2 - u);
        const base = Math.min(larg, haut) / 3;
        const px = a.px * largeur;
        const py = a.py * hauteur;
        // Pointe dessinée sous la bulle : sa base est cachée par le cadre.
        const vertical = Math.abs(py - cy) * larg >= Math.abs(px - cx) * haut;
        const pointe = vertical
          ? `${n(cx - base / 2)},${n(cy)} ${n(cx + base / 2)},${n(cy)} ${n(px)},${n(py)}`
          : `${n(cx)},${n(cy - base / 2)} ${n(cx)},${n(cy + base / 2)} ${n(px)},${n(py)}`;
        const debut = cy - ((lignes.length - 1) * taille * 1.2) / 2;
        const tspans = lignes.map((l, i) => `<tspan x="${n(cx)}" y="${n(debut + i * taille * 1.2)}">${echapper(l)}</tspan>`).join('');
        morceaux.push(
          `<polygon points="${pointe}" fill="#fff" stroke="#000" stroke-width="${n(0.4 * u)}" stroke-linejoin="round"/>`,
          `<rect x="${n(cx - larg / 2)}" y="${n(cy - haut / 2)}" width="${n(larg)}" height="${n(haut)}" rx="${n(1.5 * u)}" fill="#fff" stroke="#000" stroke-width="${n(0.4 * u)}"/>`,
          `<text ${police} font-size="${n(taille)}" text-anchor="middle" dominant-baseline="middle" fill="#000">${tspans}</text>`,
        );
        break;
      }
      case 'cercle': {
        const attributs = `cx="${X(a.x)}" cy="${Y(a.y)}" rx="${X(a.rx)}" ry="${Y(a.ry)}" fill="none"`;
        morceaux.push(
          `<ellipse ${attributs} stroke="#fff" stroke-width="${n(1.6 * u)}"/>`,
          `<ellipse ${attributs} stroke="${ROUGE}" stroke-width="${n(0.9 * u)}"/>`,
        );
        break;
      }
      case 'trait': {
        if (a.points.length < 2) break;
        const pts = a.points.map(([x, y]) => `${X(x)},${Y(y)}`).join(' ');
        morceaux.push(
          `<polyline points="${pts}" fill="none" stroke="#fff" stroke-width="${n(1.6 * u)}" stroke-linecap="round" stroke-linejoin="round"/>`,
          `<polyline points="${pts}" fill="none" stroke="${ROUGE}" stroke-width="${n(0.9 * u)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
        break;
      }
    }
  }
  return morceaux.join('');
}

/** Image SVG complète des annotations (fond transparent), à superposer à la photo. */
export function svgAnnotations(annotations: Annotation[], largeur: number, hauteur: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeur} ${hauteur}">${elementsSvg(annotations, largeur, hauteur)}</svg>`;
}

const relatif = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const texteCourt = (v: unknown) => typeof v === 'string' && v.length <= TEXTE_MAX;

/** Contrôle une annotation reçue d'un autre appareil (paquet .zip). */
export function annotationValide(a: unknown): boolean {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  switch (x.type) {
    case 'ok':
    case 'nok':
      return relatif(x.x) && relatif(x.y);
    case 'texte':
      return relatif(x.x) && relatif(x.y) && texteCourt(x.texte);
    case 'bulle':
      return relatif(x.x) && relatif(x.y) && relatif(x.px) && relatif(x.py) && texteCourt(x.texte);
    case 'cercle':
      return relatif(x.x) && relatif(x.y) && relatif(x.rx) && relatif(x.ry);
    case 'trait':
      return (
        Array.isArray(x.points) &&
        x.points.length <= POINTS_MAX &&
        x.points.every((p) => Array.isArray(p) && p.length === 2 && relatif(p[0]) && relatif(p[1]))
      );
    default:
      return false;
  }
}

/** Résumé lisible (« 2 V, 1 X, 1 bulle ») pour la fiche de la photo. */
export function resumeAnnotations(annotations: Annotation[] | undefined): string {
  if (!annotations?.length) return '';
  const noms: Record<Annotation['type'], string> = { ok: 'V', nok: 'X', texte: 'texte', bulle: 'bulle', cercle: 'cercle', trait: 'trait' };
  const compte = new Map<string, number>();
  for (const a of annotations) compte.set(noms[a.type], (compte.get(noms[a.type]) ?? 0) + 1);
  return [...compte].map(([k, v]) => `${v} ${k}${v > 1 && k.length > 1 ? 's' : ''}`).join(', ');
}
