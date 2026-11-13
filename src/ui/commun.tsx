import { useEffect, useRef, type ReactNode } from 'react';

export function Journal({ lignes }: { lignes: string[] }) {
  if (lignes.length === 0) return null;
  return (
    <details className="journal" open>
      <summary>Compte rendu ({lignes.length})</summary>
      <ul>
        {lignes.map((l, i) => (
          <li key={i} className={l.startsWith('Attention') ? 'alerte' : undefined}>
            {l}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Message({ type, children }: { type: 'erreur' | 'info' | 'succes'; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const dernierTexte = useRef<string | null>(null);
  // Un message d'erreur ou d'avancement est ramené à l'écran, une seule fois par texte
  // (et non à chaque affichage, ce qui ferait bouger la page sans arrêt).
  useEffect(() => {
    const texte = ref.current?.textContent ?? '';
    if (type === 'succes' || texte === dernierTexte.current) return;
    dernierTexte.current = texte;
    ref.current?.scrollIntoView?.({ block: 'nearest' });
  });
  return (
    <div ref={ref} className={`message message-${type}`} role={type === 'erreur' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function texteErreur(e: unknown): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') {
    return "Accès refusé par le navigateur. Recommencez et acceptez l'autorisation d'accès au dossier.";
  }
  if (e instanceof DOMException && e.name === 'SecurityError') {
    return "Le navigateur interdit l'accès à cet emplacement (dossier système ?). Choisissez un autre dossier.";
  }
  if (e instanceof DOMException) return `${e.message} (${e.name})`;
  return e instanceof Error ? e.message : String(e);
}

export function tailleLisible(octets: number): string {
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} ko`;
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

export function dateLisible(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}
