import { useRef, useState, type PointerEvent } from 'react';

interface Props {
  /** Convertit un point de l'écran en coordonnées relatives de la page du plan. */
  convertir: (clientX: number, clientY: number) => { x: number; y: number } | null;
  surCadre: (cadre: { x1: number; y1: number; x2: number; y2: number }) => void;
  surAnnuler: () => void;
}

/**
 * Encadré tracé sur le plan (23/11/2026) : on glisse le doigt (ou la souris) autour du nom d'un
 * local ; le cadre est rendu en coordonnées relatives de la page. Pendant le tracé, le plan ne
 * bouge pas (le calque capte les gestes).
 */
export function CadreSelection({ convertir, surCadre, surAnnuler }: Props) {
  const zone = useRef<HTMLDivElement>(null);
  const [trace, setTrace] = useState<{ x0: number; y0: number; x1: number; y1: number; cx0: number; cy0: number } | null>(null);

  const local = (e: PointerEvent) => {
    const r = zone.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div
      ref={zone}
      className="cadre-selection"
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = local(e);
        setTrace({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, cx0: e.clientX, cy0: e.clientY });
      }}
      onPointerMove={(e) => {
        if (!trace) return;
        const p = local(e);
        setTrace({ ...trace, x1: p.x, y1: p.y });
      }}
      onPointerUp={(e) => {
        if (!trace) return;
        setTrace(null);
        if (Math.abs(e.clientX - trace.cx0) < 8 || Math.abs(e.clientY - trace.cy0) < 6) return;
        const a = convertir(trace.cx0, trace.cy0);
        const b = convertir(e.clientX, e.clientY);
        if (!a || !b) return;
        surCadre({ x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) });
      }}
    >
      <div className="consigne">
        Encadrez le nom d'un local : glissez le doigt d'un coin à l'autre, autour du texte. Les étiquettes de même police et de même taille
        seront retenues.
        <button className="petit" onClick={surAnnuler}>
          Annuler
        </button>
      </div>
      {trace && (
        <div
          className="cadre-trace"
          style={{
            left: Math.min(trace.x0, trace.x1),
            top: Math.min(trace.y0, trace.y1),
            width: Math.abs(trace.x1 - trace.x0),
            height: Math.abs(trace.y1 - trace.y0),
          }}
        />
      )}
    </div>
  );
}
