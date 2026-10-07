// STUB TEMPORAL: misma firma que src/scoring.js (lo entrega Codex). Borrar al integrar el real.
import { ASPECTOS } from './aspectos.js';

const VALOR = { positivo: 1, neutral: 0.5, negativo: 0 };

export function calcularScores(comentarios, m = 5) {
  const validos = comentarios.filter((c) => !c.dudoso);
  const priors = {};
  for (const a of Object.keys(ASPECTOS)) {
    const vals = validos.flatMap((c) => c.aspectos.filter((x) => x.aspecto === a).map((x) => VALOR[x.sentimiento]));
    priors[a] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0.5;
  }
  const docentes = {};
  for (const nombre of [...new Set(comentarios.map((c) => c.docente))]) {
    const propios = comentarios.filter((c) => c.docente === nombre);
    const ok = propios.filter((c) => !c.dudoso);
    const aspectos = {};
    let general = 0;
    for (const [a, peso] of Object.entries(ASPECTOS)) {
      const vals = ok.flatMap((c) => c.aspectos.filter((x) => x.aspecto === a).map((x) => VALOR[x.sentimiento]));
      const n = vals.length;
      const mediaCruda = n ? vals.reduce((s, v) => s + v, 0) / n : null;
      const score = ((n * (mediaCruda ?? 0) + m * priors[a]) / (n + m)) * 100;
      aspectos[a] = { score, n, mediaCruda: mediaCruda === null ? null : mediaCruda * 100, confianza: n / (n + m) };
      general += score * peso;
    }
    const conDatos = Object.entries(aspectos).filter(([, v]) => v.n > 0).sort((x, y) => x[1].score - y[1].score);
    docentes[nombre] = {
      scoreGeneral: general,
      aspectos,
      totalComentarios: propios.length,
      dudosos: propios.length - ok.length,
      aspectoMasBajo: conDatos[0]?.[0] ?? null,
      aspectoMasAlto: conDatos.at(-1)?.[0] ?? null,
    };
  }
  const ranking = Object.keys(docentes).sort((a, b) => docentes[b].scoreGeneral - docentes[a].scoreGeneral);
  return { docentes, ranking, parametros: { m, pesos: ASPECTOS, priors } };
}
