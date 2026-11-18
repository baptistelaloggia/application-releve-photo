// Assemble l'outil en un seul fichier HTML autonome (ouvrable par double-clic, hors ligne).
// Lancement : node outils/pertes-de-charge/construire.mjs [chemin-page-sans-entete.html]
// - écrit outils/pertes-de-charge/pertes-de-charge.html (page complète) ;
// - avec un chemin en argument, écrit aussi la page sans <!doctype>/<head> (publication en Artifact).
import { readFileSync, writeFileSync } from 'node:fs';

const ici = (f) => new URL(`./${f}`, import.meta.url);
const moteur = readFileSync(ici('moteur.js'), 'utf8').replace(/^export (const|function|async function) /gm, '$1 ');
const page = readFileSync(ici('page.html'), 'utf8').replace('/*MOTEUR*/', () => moteur);

const complete = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page}
</html>
`;
writeFileSync(ici('pertes-de-charge.html'), complete);
console.log('Écrit : outils/pertes-de-charge/pertes-de-charge.html');
if (process.argv[2]) { writeFileSync(process.argv[2], page); console.log('Écrit :', process.argv[2]); }
