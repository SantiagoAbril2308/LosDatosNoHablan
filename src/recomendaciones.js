import crypto from 'node:crypto';
import { NOMBRES_ASPECTOS } from './aspectos.js';
import { crearCache, hayApi, llamarModeloJSON } from './clasificador.js';

const cacheRecs = crearCache('recomendaciones.json');
const MAX_CITAS = 6;

const PROMPT_RECS = `Eres asesor pedagógico de una universidad colombiana. Recibes, para UN docente, aspectos a MEJORAR (los de puntaje más bajo) y un aspecto a RECONOCER (el más alto), cada uno con comentarios REALES de estudiantes.

Escribe recomendaciones CONCRETAS y ACCIONABLES:
- Cada recomendación debe basarse en lo que dicen los estudiantes y citar entre comillas al menos un fragmento literal de los comentarios recibidos.
- Propón una acción específica y verificable (qué hacer, cuándo, cómo medirlo). Ej: "Varios estudiantes dicen 'llega 30 min tarde': iniciar la clase a la hora en punto con un quiz de 5 min que cuente para nota de participación."
- PROHIBIDO lo genérico: "mejorar la comunicación", "ser más dinámico", "seguir así", "fortalecer la metodología", "tener en cuenta a los estudiantes", etc.
- Para "reconocer": di exactamente qué práctica valoran los estudiantes y cómo podría compartirla con colegas.
- Español claro, máximo 2 frases por recomendación.

Responde SOLO JSON: {"recomendaciones":[{"aspecto":"<clave>","tipo":"mejorar"|"reconocer","texto":"...","citas":["fragmento literal", "..."]}]}`;

/** Elige los 2 aspectos más bajos y el más alto (solo aspectos con comentarios). */
export function elegirAspectos(infoDocente) {
  const conDatos = Object.entries(infoDocente.aspectos || {})
    .filter(([, v]) => v.n > 0)
    .sort((a, b) => a[1].score - b[1].score);
  if (!conDatos.length) return { mejorar: [], reconocer: [] };
  // El más alto siempre se reconoce; de los demás, se mejoran hasta los 2 más bajos.
  const reconocer = [conDatos.at(-1)[0]];
  const mejorar = conDatos.slice(0, -1).slice(0, 2).map(([a]) => a);
  return { mejorar, reconocer };
}

function evidencias(comentarios, docente, aspecto, sentimientoPreferido) {
  const items = comentarios
    .filter((c) => c.docente === docente && !c.dudoso)
    .flatMap((c) => c.aspectos.filter((a) => a.aspecto === aspecto).map((a) => ({ ...a, comentario: c.comentario })));
  items.sort((a, b) => (b.sentimiento === sentimientoPreferido) - (a.sentimiento === sentimientoPreferido));
  return items.slice(0, MAX_CITAS);
}

// Plantillas por aspecto para cuando no hay API: acción concreta + cita real.
const PLANTILLAS = {
  mejorar: {
    metodologia: 'Cerrar cada tema con un ejemplo resuelto paso a paso y 5 minutos de preguntas; medirlo con una encuesta rápida de comprensión al final de cada unidad.',
    dominio_tema: 'Preparar una guía de respuestas para las preguntas frecuentes del tema y, si algo no se sabe en clase, traer la respuesta resuelta en la sesión siguiente.',
    trato_estudiante: 'Fijar un horario semanal de asesoría publicado en el aula virtual y responder las dudas sin juicios, especialmente las que se hacen en público.',
    evaluacion: 'Publicar con una semana de anticipación los temas y la rúbrica de cada parcial, y devolver notas con retroalimentación escrita en máximo 8 días.',
    puntualidad: 'Iniciar a la hora exacta con una actividad corta que cuente para la nota y avisar por el aula virtual con 24 h cualquier cancelación o retraso.',
  },
  reconocer: {
    metodologia: 'Reconocer su forma de explicar e invitarlo a compartir sus ejemplos y materiales en un taller con colegas del área.',
    dominio_tema: 'Reconocer su dominio del tema y proponerlo como tutor o referente para cursos relacionados.',
    trato_estudiante: 'Reconocer su disposición con los estudiantes y documentar sus prácticas de acompañamiento como referencia para otros docentes.',
    evaluacion: 'Reconocer la claridad de sus evaluaciones y compartir sus rúbricas como ejemplo en el departamento.',
    puntualidad: 'Reconocer su cumplimiento del horario como ejemplo de compromiso con el tiempo de clase.',
  },
};

function recomendacionFallback(aspecto, tipo, evs) {
  const sentimiento = tipo === 'mejorar' ? 'negativo' : 'positivo';
  const citas = evs.filter((e) => e.sentimiento === sentimiento).map((e) => e.evidencia || e.comentario).slice(0, 2);
  const prefijo = citas.length ? `Los estudiantes dicen ${citas.map((c) => `"${c}"`).join(' y ')}. ` : '';
  return { aspecto, tipo, texto: prefijo + PLANTILLAS[tipo][aspecto], citas, fuente: 'plantilla' };
}

/**
 * Genera recomendaciones para un docente. Usa caché; en modo demo o sin API usa plantillas + evidencia real.
 */
export async function recomendarDocente(docente, infoDocente, comentarios, { demo = false } = {}) {
  const { mejorar, reconocer } = elegirAspectos(infoDocente);
  // Un aspecto "bajo" sin ninguna queja real no se manda a mejorar: se reconoce.
  const tieneQuejas = (a) => evidencias(comentarios, docente, a, 'negativo').some((e) => e.sentimiento === 'negativo');
  const objetivos = [
    ...mejorar.map((a) => ({ aspecto: a, tipo: tieneQuejas(a) ? 'mejorar' : 'reconocer' })),
    ...reconocer.map((a) => ({ aspecto: a, tipo: 'reconocer' })),
  ];
  if (!objetivos.length) return [];

  const bloques = objetivos.map((o) => ({
    ...o,
    nombre: NOMBRES_ASPECTOS[o.aspecto],
    puntaje: Number(infoDocente.aspectos[o.aspecto].score.toFixed(1)),
    comentarios: evidencias(comentarios, docente, o.aspecto, o.tipo === 'mejorar' ? 'negativo' : 'positivo').map((e) => ({
      sentimiento: e.sentimiento,
      evidencia: e.evidencia,
      comentario: e.comentario,
    })),
  }));
  const llave = crypto.createHash('sha256').update(JSON.stringify({ docente, bloques })).digest('hex');
  if (cacheRecs.has(llave)) return cacheRecs.get(llave);

  const fallback = () => bloques.map((b) => recomendacionFallback(b.aspecto, b.tipo, b.comentarios));
  if (demo || !hayApi()) return fallback();

  try {
    const { datos } = await llamarModeloJSON(PROMPT_RECS, JSON.stringify({ docente, aspectos: bloques }), (json) => {
      const recs = json?.recomendaciones;
      if (!Array.isArray(recs) || !recs.length) throw new Error('Sin recomendaciones');
      return recs
        .filter((r) => objetivos.some((o) => o.aspecto === r.aspecto) && typeof r.texto === 'string' && r.texto.length > 10)
        .map((r) => ({ aspecto: r.aspecto, tipo: r.tipo === 'reconocer' ? 'reconocer' : 'mejorar', texto: r.texto, citas: Array.isArray(r.citas) ? r.citas.slice(0, 3) : [], fuente: 'ia' }));
    });
    if (!datos.length) throw new Error('Recomendaciones vacías tras validar');
    cacheRecs.set(llave, datos);
    return datos;
  } catch (e) {
    console.warn(`[recomendaciones] ${docente}: ${e.message}. Uso plantillas.`);
    return fallback();
  }
}
