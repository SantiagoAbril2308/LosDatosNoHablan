import { readFileSync } from 'node:fs';

/** Pesos por impacto: enseñar con claridad, rigor, respeto, evaluación y tiempo útil. */
export const PESOS = Object.freeze({
  metodologia: 0.30, // Las actividades y explicaciones permiten construir aprendizaje.
  dominio_tema: 0.25, // El rigor evita aprender conceptos incorrectos.
  trato_estudiante: 0.20, // El respeto permite preguntar y participar sin temor.
  evaluacion: 0.15, // Criterios y retroalimentación guían la mejora.
  puntualidad: 0.10, // Cumplir el horario protege el tiempo de aprendizaje.
});
const VALORES = { positivo: 1, neutral: 0.5, negativo: 0 };
const ASPECTOS = Object.keys(PESOS);
const redondear = valor => Math.round((valor + Number.EPSILON) * 10) / 10;
const tiene = (objeto, clave) => Object.hasOwn(objeto, clave);
const MIN_DOCENTES = 3;
const MIN_MENCIONES = 10;

/** Priors institucionales de referencia (data/priors_referencia.json); null si no existe. */
function leerPriorsReferencia() {
  try {
    const { priors } = JSON.parse(readFileSync(new URL('../data/priors_referencia.json', import.meta.url), 'utf8'));
    return priors && typeof priors === 'object' ? priors : null;
  } catch {
    return null;
  }
}
export const PRIORS_REFERENCIA = leerPriorsReferencia();

/**
 * Calcula puntajes comparables mediante suavizado bayesiano por aspecto.
 * Cada prior es la media de todas las menciones válidas del aspecto; si no hay
 * ninguna, usamos 0.5. El parámetro m equivale a m menciones de esa media.
 * Así una muestra pequeña se acerca más al contexto global y no ocupa el
 * primer lugar solo por dos elogios: una muestra grande aporta más evidencia.
 * No garantiza que cualquier muestra grande gane: también importa su calidad.
 * Los dudosos se cuentan para revisión, pero nunca alteran medias ni priors.
 * La confianza describe cantidad de evidencia, no una probabilidad estadística.
 * Un comentario mixto aporta a cada aspecto con su sentimiento específico.
 *
 * @param {Array<{id?: string, docente: string, comentario?: string,
 * aspectos: Array<{aspecto: string, sentimiento: string, evidencia?: string}>,
 * confianza?: number, banderas?: string[], dudoso?: boolean}>} comentarios
 * Si el archivo tiene menos de 3 docentes, o un aspecto tiene menos de 10
 * menciones válidas, ese prior sale de la referencia institucional (o 0.5 si
 * no hay referencia): así un solo docente no se compara contra sí mismo.
 * @param {number} [m=5] Fuerza del prior, finita y estrictamente positiva.
 * @param {{priorsReferencia?: Object|null}} [opciones] Para pruebas: priors de referencia a usar.
 * @returns {{docentes: Object, ranking: string[], parametros: Object}}
 */
export function calcularScores(comentarios, m = 5, { priorsReferencia = PRIORS_REFERENCIA } = {}) {
  if (!Array.isArray(comentarios)) throw new TypeError('comentarios debe ser un arreglo');
  if (!Number.isFinite(m) || m <= 0) throw new RangeError('m debe ser un número finito mayor que cero');
  const acumulados = new Map();
  const globales = Object.fromEntries(ASPECTOS.map(a => [a, { suma: 0, n: 0 }]));
  for (const comentario of comentarios) {
    if (!comentario || typeof comentario.docente !== 'string' || !comentario.docente.trim()) {
      throw new TypeError('Cada comentario debe tener un docente no vacío');
    }
    const nombre = comentario.docente.trim();
    if (!acumulados.has(nombre)) acumulados.set(nombre, {
      totalComentarios: 0, dudosos: 0,
      aspectos: Object.fromEntries(ASPECTOS.map(a => [a, { suma: 0, n: 0 }])),
    });
    const docente = acumulados.get(nombre);
    docente.totalComentarios++;
    if (comentario.dudoso === true) { docente.dudosos++; continue; }
    for (const mencion of comentario.aspectos ?? []) {
      if (!mencion || !tiene(PESOS, mencion.aspecto) || !tiene(VALORES, mencion.sentimiento)) continue;
      const valor = VALORES[mencion.sentimiento];
      docente.aspectos[mencion.aspecto].suma += valor;
      docente.aspectos[mencion.aspecto].n++;
      globales[mencion.aspecto].suma += valor;
      globales[mencion.aspecto].n++;
    }
  }
  const pocosDocentes = acumulados.size < MIN_DOCENTES;
  const fuentePorAspecto = {};
  const priors = Object.fromEntries(ASPECTOS.map(a => {
    if (!pocosDocentes && globales[a].n >= MIN_MENCIONES) {
      fuentePorAspecto[a] = 'archivo';
      return [a, globales[a].suma / globales[a].n];
    }
    fuentePorAspecto[a] = 'referencia';
    const ref = Number(priorsReferencia?.[a]);
    return [a, Number.isFinite(ref) ? ref : 0.5];
  }));
  const fuentePrior = Object.values(fuentePorAspecto).includes('referencia') ? 'referencia' : 'archivo';
  const entradas = [];
  for (const [nombre, docente] of acumulados) {
    let general = 0;
    const scores = {};
    const aspectos = Object.fromEntries(ASPECTOS.map(a => {
      const { suma, n } = docente.aspectos[a];
      const score = (suma + m * priors[a]) / (n + m);
      general += PESOS[a] * score;
      scores[a] = score;
      return [a, { score: redondear(score * 100), n,
        mediaCruda: n ? suma / n : null,
        confianza: n < 3 ? 'baja' : n < 8 ? 'media' : 'alta' }];
    }));
    // No presentamos como fortaleza o debilidad un aspecto sin evidencia propia.
    const observados = ASPECTOS.filter(a => aspectos[a].n > 0)
      .sort((a, b) => scores[a] - scores[b]);
    entradas.push([nombre, { scoreGeneral: redondear(general * 100), aspectos,
      totalComentarios: docente.totalComentarios, dudosos: docente.dudosos,
      aspectoMasBajo: observados[0] ?? null,
      aspectoMasAlto: observados.at(-1) ?? null }]);
  }
  const docentes = Object.fromEntries(entradas);
  const ranking = entradas.map(([nombre]) => nombre).sort((a, b) =>
    docentes[b].scoreGeneral - docentes[a].scoreGeneral || a.localeCompare(b, 'es'));
  return { docentes, ranking, parametros: { m, pesos: { ...PESOS }, priors, fuentePrior, fuentePorAspecto } };
}
