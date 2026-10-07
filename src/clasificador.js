import OpenAI from 'openai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ASPECTOS, SENTIMIENTOS, BANDERAS } from './aspectos.js';

const CACHE_DIR = path.resolve('cache');
const TAM_LOTE = 10;
const ESPERA_429_MS = 20_000;
const MAX_REINTENTOS_429 = 2;

// ---------- Caché en disco (llave: sha256 del texto) ----------

export const hashTexto = (texto) => crypto.createHash('sha256').update(String(texto).trim().toLowerCase()).digest('hex');

export function crearCache(nombre) {
  const archivo = path.join(CACHE_DIR, nombre);
  let datos = {};
  try {
    datos = JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    datos = {};
  }
  return {
    get: (k) => datos[k],
    has: (k) => k in datos,
    set(k, v) {
      datos[k] = v;
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(archivo, JSON.stringify(datos, null, 1));
    },
    size: () => Object.keys(datos).length,
  };
}

const cacheClasif = crearCache('clasificaciones.json');

// ---------- Proveedores de IA (Groq principal, Gemini respaldo) ----------

function proveedores() {
  const lista = [];
  if (process.env.GROQ_API_KEY)
    lista.push({
      nombre: 'groq',
      modelo: process.env.MODEL || 'openai/gpt-oss-120b',
      cliente: new OpenAI({ baseURL: 'https://api.groq.com/openai/v1', apiKey: process.env.GROQ_API_KEY, maxRetries: 0, timeout: 60_000 }),
    });
  if (process.env.GEMINI_API_KEY)
    lista.push({
      nombre: 'gemini',
      modelo: process.env.GEMINI_MODEL || 'gemini-flash-latest',
      cliente: new OpenAI({ baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', apiKey: process.env.GEMINI_API_KEY, maxRetries: 0, timeout: 90_000 }),
    });
  return lista;
}

export const hayApi = () => proveedores().length > 0;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Llama al modelo pidiendo JSON. Groq primero; si falla o da 429, Gemini.
 * Si todos dan 429, espera 20 s y reintenta (máx. 2 veces). `validar` lanza si la respuesta no sirve.
 */
export async function llamarModeloJSON(system, user, validar = (x) => x, onEstado = () => {}) {
  const provs = proveedores();
  if (!provs.length) throw new Error('No hay API keys configuradas (GROQ_API_KEY / GEMINI_API_KEY).');
  let ultimoError;
  for (let intento = 0; intento <= MAX_REINTENTOS_429; intento++) {
    let hubo429 = false;
    for (const p of provs) {
      try {
        const r = await p.cliente.chat.completions.create({
          model: p.modelo,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        });
        const texto = r.choices?.[0]?.message?.content ?? '';
        const json = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, ''));
        return { datos: validar(json), proveedor: p.nombre };
      } catch (e) {
        ultimoError = e;
        if (e?.status === 429) hubo429 = true;
        console.warn(`[IA] ${p.nombre} falló: ${e?.status ?? ''} ${String(e?.message).slice(0, 160)}`);
      }
    }
    if (!hubo429 || intento === MAX_REINTENTOS_429) break;
    onEstado(`Límite de la API alcanzado (429). Esperando 20 s antes de reintentar (${intento + 1}/${MAX_REINTENTOS_429})…`);
    await dormir(ESPERA_429_MS);
  }
  throw ultimoError ?? new Error('Fallo desconocido al llamar al modelo');
}

// ---------- Prompt ----------

export const PROMPT_SISTEMA = `Eres un analista experto en evaluaciones docentes escritas por estudiantes universitarios colombianos, en español coloquial (con jerga, sarcasmo, doble sentido y abreviaturas como "x", "q", "profe", "parcero", "bacano", "chévere", "una nota", "un camello", "se le corre", "rajar", "corcharse").

TAREA: para cada comentario identifica TODOS los aspectos que menciona y el sentimiento hacia CADA aspecto por separado.

ASPECTOS (usa exactamente estas claves):
- metodologia: cómo enseña. Claridad, ejemplos, ritmo, dinámica de la clase, material. Ej: "explica re claro con ejemplos" (positivo); "solo lee las diapositivas, uno se duerme" (negativo).
- dominio_tema: cuánto sabe de la materia. Ej: "se nota que sabe un montón" (positivo); "no supo responder nada, se enreda con lo básico" (negativo).
- trato_estudiante: respeto, paciencia, disponibilidad, actitud. Ej: "súper buena gente, siempre resuelve dudas" (positivo); "lo humilla a uno si pregunta" (negativo).
- evaluacion: parciales, talleres, notas, coherencia con lo visto, retroalimentación. Ej: "los parciales son justos" (positivo); "evalúa cosas que nunca vimos, raja a medio salón" (negativo).
- puntualidad: llegar a tiempo, cancelar clases, cumplir horario, entregar notas a tiempo. Ej: "nunca falta y llega puntual" (positivo); "llega 30 min tarde siempre" (negativo).

SENTIMIENTO por aspecto: "positivo", "negativo" o "neutral" (mención sin juicio claro).

COMENTARIOS MIXTOS: divide por aspecto, no promedies.
- "explica bien pero llega tarde siempre" → metodologia positivo + puntualidad negativo, bandera "mixto".
- "sabe mucho pero es un ogro con los estudiantes" → dominio_tema positivo + trato_estudiante negativo, bandera "mixto".
Un mixto bien entendido debe llevar confianza ALTA: dividirlo bien no es dudar.

SARCASMO: el sentido real es el contrario al literal. Clasifica por el sentido real y agrega bandera "sarcasmo".
- "uy sí, qué puntualidad, solo 40 min tarde" → puntualidad negativo, bandera sarcasmo, confianza alta (es evidente).
- "excelente profe, si lo que uno quiere es aprender a dormir" → metodologia negativo, sarcasmo.
- "tan organizado que el parcial llegó 2 semanas tarde" → evaluacion/puntualidad negativo, sarcasmo.
Señales: "uy sí", "qué maravilla", "tan…", "si lo que uno quiere es…", "jajaja" tras una queja, elogio exagerado seguido de un hecho negativo, emojis 🙃🙄.
Si NO estás seguro de si es sarcasmo o elogio genuino, usa bandera "sarcasmo" y confianza baja (<0.7).

BANDERAS (lista, puede ir vacía):
- "sarcasmo": ironía detectada.
- "ambiguo": no se puede saber con certeza qué opina o de qué aspecto habla (ej: "pues ahí va", "es todo un personaje", "con él uno sí aprende… a sufrir?").
- "mixto": positivo en un aspecto y negativo en otro.
- "fuera_de_tema": no habla del desempeño del docente (ej: "el salón es muy caliente", "la cafetería es cara"). En ese caso "aspectos" puede ir vacío.

CONFIANZA (0 a 1): qué tan seguro estás de la clasificación completa. NO ADIVINES: si dudas, BAJA la confianza (0.3–0.6) y explica la duda en "razon". Es mucho mejor marcar una duda que inventar.

"evidencia" = fragmento LITERAL y corto del comentario que justifica ese aspecto.

RESPONDE SOLO con JSON con esta forma exacta:
{"resultados":[{"i":0,"aspectos":[{"aspecto":"metodologia","sentimiento":"positivo","evidencia":"explica bien"}],"confianza":0.9,"banderas":["mixto"],"razon":"explicación breve"}]}
Debe haber exactamente un resultado por cada comentario recibido, con el mismo "i".`;

// ---------- Validación y regla de dudoso (en código, no en el modelo) ----------

function normalizarResultado(r) {
  const aspectos = (Array.isArray(r?.aspectos) ? r.aspectos : [])
    .map((a) => ({
      aspecto: String(a?.aspecto ?? '').trim().toLowerCase(),
      sentimiento: String(a?.sentimiento ?? '').trim().toLowerCase(),
      evidencia: String(a?.evidencia ?? '').slice(0, 200),
    }))
    .filter((a) => a.aspecto in ASPECTOS && SENTIMIENTOS.includes(a.sentimiento));
  let confianza = Number(r?.confianza);
  if (!Number.isFinite(confianza)) confianza = 0.5;
  confianza = Math.min(1, Math.max(0, confianza));
  const banderas = [...new Set((Array.isArray(r?.banderas) ? r.banderas : []).map((b) => String(b).trim().toLowerCase()))].filter((b) => BANDERAS.includes(b));
  if (!aspectos.length && !banderas.includes('fuera_de_tema') && !banderas.includes('ambiguo')) banderas.push('ambiguo');
  const sents = new Set(aspectos.map((a) => a.sentimiento));
  if (sents.has('positivo') && sents.has('negativo') && !banderas.includes('mixto')) banderas.push('mixto');
  return { aspectos, confianza, banderas, razon: String(r?.razon ?? '').slice(0, 300) };
}

/** Regla de dudoso. Devuelve el motivo (string) o null si no es dudoso. */
export function motivoDudoso({ confianza, banderas }) {
  const motivos = [];
  if (confianza < 0.7) motivos.push(`confianza baja (${confianza.toFixed(2)} < 0.70)`);
  if (banderas.includes('ambiguo')) motivos.push('comentario ambiguo');
  if (banderas.includes('sarcasmo') && confianza < 0.85) motivos.push(`posible sarcasmo sin certeza suficiente (${confianza.toFixed(2)} < 0.85)`);
  if (banderas.includes('fuera_de_tema')) motivos.push('no habla del desempeño docente');
  return motivos.length ? motivos.join('; ') : null;
}

function armar(c, r, fuente) {
  const motivo = motivoDudoso(r);
  return {
    id: c.id,
    docente: c.docente,
    comentario: c.comentario,
    ...(c.materia ? { materia: c.materia } : {}),
    ...(c.semestre ? { semestre: c.semestre } : {}),
    aspectos: r.aspectos,
    confianza: r.confianza,
    banderas: r.banderas,
    dudoso: Boolean(motivo),
    motivo,
    razon: r.razon,
    fuente,
  };
}

function validarLote(n) {
  return (json) => {
    const res = json?.resultados;
    if (!Array.isArray(res)) throw new Error('La respuesta no trae "resultados"');
    const porI = new Map();
    res.forEach((r, k) => porI.set(Number.isInteger(r?.i) ? r.i : k, r));
    if (porI.size < Math.ceil(n * 0.5)) throw new Error(`Respuesta incompleta: ${porI.size}/${n}`);
    return porI;
  };
}

/**
 * Clasifica comentarios por aspecto y sentimiento.
 * opciones: { demo: boolean (solo caché), onProgreso({hechos,total,mensaje}) }
 */
export async function clasificarComentarios(comentarios, { demo = false, onProgreso = () => {} } = {}) {
  const total = comentarios.length;
  const salida = new Array(total);
  const pendientes = [];
  comentarios.forEach((c, idx) => {
    const h = hashTexto(c.comentario);
    if (cacheClasif.has(h)) salida[idx] = armar(c, cacheClasif.get(h), 'cache');
    else pendientes.push(idx);
  });
  let hechos = total - pendientes.length;
  onProgreso({ hechos, total, mensaje: `${hechos} comentarios tomados de la caché; ${pendientes.length} por clasificar.` });

  const sinClasificar = (c, motivoTexto) =>
    armar(c, { aspectos: [], confianza: 0, banderas: ['ambiguo'], razon: motivoTexto }, 'sin_clasificar');

  if (demo || !hayApi()) {
    for (const idx of pendientes) salida[idx] = sinClasificar(comentarios[idx], demo ? 'Modo demo: no estaba en la caché.' : 'Sin API configurada.');
    onProgreso({ hechos: total, total, mensaje: demo ? 'Modo demo: solo caché, sin llamar a la API.' : 'Sin API keys: solo caché.' });
    return salida;
  }

  for (let k = 0; k < pendientes.length; k += TAM_LOTE) {
    const lote = pendientes.slice(k, k + TAM_LOTE);
    const userMsg = 'Clasifica estos comentarios:\n' + JSON.stringify(lote.map((idx, i) => ({ i, comentario: comentarios[idx].comentario })), null, 0);
    let porI = null;
    let proveedor = '';
    for (let intento = 0; intento < 2 && !porI; intento++) {
      try {
        const r = await llamarModeloJSON(PROMPT_SISTEMA, userMsg, validarLote(lote.length), (mensaje) => onProgreso({ hechos, total, mensaje }));
        porI = r.datos;
        proveedor = r.proveedor;
      } catch (e) {
        console.warn(`[clasificador] lote ${k / TAM_LOTE + 1} intento ${intento + 1} falló: ${e.message}`);
      }
    }
    lote.forEach((idx, i) => {
      const c = comentarios[idx];
      const crudo = porI?.get(i);
      if (crudo) {
        const r = normalizarResultado(crudo);
        cacheClasif.set(hashTexto(c.comentario), { ...r, proveedor });
        salida[idx] = armar(c, r, proveedor);
      } else {
        // No se cachea: se podrá reintentar en otra corrida.
        salida[idx] = sinClasificar(c, 'El modelo no devolvió una clasificación válida tras reintentos.');
      }
    });
    hechos += lote.length;
    onProgreso({ hechos, total, mensaje: `Clasificados ${hechos}/${total} (${proveedor || 'sin respuesta'}).` });
  }
  return salida;
}
