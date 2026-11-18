// Vérification du moteur sur les réseaux de référence anonymisés.
// Lancement : node outils/pertes-de-charge/verif.mjs
// Sortie en erreur (code 1) si la couverture de la fourchette tombe sous les seuils.
import { readFileSync } from 'node:fs';
import { calculerReseau, perteLineique, REGIMES } from './moteur.js';

const refs = JSON.parse(readFileSync(new URL('./references.json', import.meta.url), 'utf8')).reseaux;
let erreurs = 0;
const verifier = (cond, msg) => { if (!cond) { erreurs++; console.error('ÉCHEC :', msg); } };

// 1. Pertes linéiques : comparaison à des valeurs lues dans les notes de référence.
const cas = [
  // debit, a, b, rugosité, j attendu (Pa/m), tolérance relative
  [180, 160, null, 0.15, 0.64, 0.1],   // B : Ø160, 2,49 m/s
  [3520, 600, 400, 0.15, 0.42, 0.15],  // B : 600×400
  [29160, 900, 1300, 0.15, 0.42, 0.15],// B : 900×1300
  [9700, 500, 400, 0.5, 4.57, 0.1, true],  // A : désenfumage 500×400, rugosité 0,5 mm, vitesse réelle
  [4300, 700, 300, 0.5, 0.84, 0.1, true],  // A : 700×300
];
for (const [debit, a, b, rugosite, attendu, tol, vitesseReelle] of cas) {
  const { j, v } = perteLineique({ debit, a, b, rugosite, vitesseReelle });
  const ok = Math.abs(j - attendu) / attendu <= tol;
  console.log(`j ${debit} m³/h ${a}${b ? '×' + b : ''} : ${j.toFixed(2)} Pa/m (réf. ${attendu}) v=${v.toFixed(2)} m/s ${ok ? 'OK' : '!!'}`);
  verifier(ok, `perte linéique ${debit} m³/h ${a}×${b}`);
}

// 2. Calage des accidents de forme : la valeur observée doit tomber dans [bas, haut]
//    quand on connaît les pertes linéaires et la pression dynamique du tronc.
let dansForme = 0;
for (const r of refs) {
  const reg = REGIMES[r.regime];
  const bas = reg.kr[0] * r.lineaire + reg.zb[0] * r.pdMain;
  const haut = reg.kr[2] * r.lineaire + reg.zb[2] * r.pdMain;
  if (r.forme >= bas - 5 && r.forme <= haut + 5) dansForme++;
}
console.log(`\nAccidents de forme dans la fourchette : ${dansForme}/${refs.length}`);

// 3. Calcul « à l'aveugle » : seulement débit, longueur et éléments particuliers.
let dans = 0, ecartTotal = 0;
const lignes = [];
for (const r of refs) {
  const c = calculerReseau({ regime: r.regime, debit: r.debit, longueur: r.longueur, rugosite: r.rugosite, section: r.section, vitesseReelle: r.source === 'A', elements: r.elements });
  const f = c.fourchette;
  const ok = r.total >= f.bas && r.total <= f.haut;
  if (ok) dans++;
  const ecart = (f.probable - r.total) / r.total;
  ecartTotal += Math.abs(ecart);
  lignes.push(`${r.id.padEnd(18)} réel ${r.total.toFixed(0).padStart(5)}  fourchette ${f.bas.toFixed(0).padStart(5)} / ${f.probable.toFixed(0).padStart(5)} / ${f.haut.toFixed(0).padStart(5)}  écart probable ${(ecart * 100).toFixed(0).padStart(4)} % ${ok ? '' : '  HORS'}`);
}
console.log('\n' + lignes.join('\n'));
const couverture = dans / refs.length;
console.log(`\nCouverture à l'aveugle : ${dans}/${refs.length} (${(couverture * 100).toFixed(0)} %), écart moyen absolu de la valeur probable : ${(ecartTotal / refs.length * 100).toFixed(0)} %`);
verifier(couverture >= 0.85, 'couverture à l\'aveugle < 85 %');
verifier(ecartTotal / refs.length <= 0.2, 'écart moyen de la valeur probable > 20 %');

process.exit(erreurs ? 1 : 0);
