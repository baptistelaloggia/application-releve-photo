import { useEffect, useState } from 'react';
import type { Photo } from '../../domaine/types';
import type { EspaceProjet } from '../../projet/EspaceProjet';

/** Adresses des miniatures déjà lues (gardées pour la session, pour un défilement fluide). */
const cache = new Map<string, Promise<string>>();

function adresseMiniature(espace: EspaceProjet, photo: Photo): Promise<string> {
  const cle = `${photo.id}:${photo.empreinte}`;
  let p = cache.get(cle);
  if (!p) {
    p = espace.lireMiniature(photo).then((b) => URL.createObjectURL(b));
    p.catch(() => cache.delete(cle));
    cache.set(cle, p);
  }
  return p;
}

export function Miniature({ espace, photo, taille = 96 }: { espace: EspaceProjet; photo: Photo; taille?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let annule = false;
    adresseMiniature(espace, photo)
      .then((u) => !annule && setSrc(u))
      .catch(() => undefined);
    return () => {
      annule = true;
    };
  }, [espace, photo]);
  return (
    <span className="miniature" style={{ width: taille, height: taille }}>
      {src ? <img src={src} alt="" loading="lazy" /> : null}
    </span>
  );
}
