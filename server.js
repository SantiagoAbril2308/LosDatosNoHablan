import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { cargarComentarios } from './src/carga.js';
import { clasificarComentarios, hayApi } from './src/clasificador.js';
import { recomendarDocente } from './src/recomendaciones.js';
import { generarReporteHTML } from './src/reporte.js';
import { ASPECTOS, NOMBRES_ASPECTOS } from './src/aspectos.js';

const PUERTO = process.env.PORT || 3000;
const ARCHIVO_PRUEBA = path.resolve('data/comentarios_prueba.csv');
const ARCHIVO_ETIQUETAS = path.resolve('data/etiquetas_esperadas.json');

// Scoring y baseline los entrega otro módulo; si aún no existen se usan respaldos.
async function cargarScoring() {
  try {
    return { ...(await import('./src/scoring.js')), real: true };
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    return { ...(await import('./src/scoring.stub.js')), real: false };
  }
}
async function cargarBaseline() {
  try {
    return (await import('./src/baseline.js')).clasificarBaseline;
  } catch (e) {
    if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e;
    return null;
  }
}

const app = express();
const subida = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.use(express.json());
app.use(express.static('public'));
// Respaldo local de Chart.js para el modo demo sin internet.
app.use('/vendor', express.static('node_modules/chart.js/dist'));

let progreso = { activo: false, fase: 'inactivo', hechos: 0, total: 0, mensaje: '' };
let ultimo = null; // último análisis completo, para reportes

async function analizar(buffer, nombre, demo) {
  if (progreso.activo) throw Object.assign(new Error('Ya hay un análisis en curso. Espera a que termine.'), { status: 409 });
  progreso = { activo: true, fase: 'carga', hechos: 0, total: 0, mensaje: 'Leyendo archivo…' };
  try {
    const { comentarios, resumen } = cargarComentarios(buffer, nombre);
    progreso = { ...progreso, fase: 'clasificacion', total: comentarios.length, mensaje: `${comentarios.length} comentarios válidos.` };

    const clasificados = await clasificarComentarios(comentarios, {
      demo,
      onProgreso: (p) => (progreso = { ...progreso, ...p }),
    });

    progreso = { ...progreso, fase: 'puntajes', mensaje: 'Calculando puntajes bayesianos…' };
    const { calcularScores, real } = await cargarScoring();
    const scores = calcularScores(clasificados);

    const docentes = scores.ranking;
    progreso = { ...progreso, fase: 'recomendaciones', hechos: 0, total: docentes.length, mensaje: 'Generando recomendaciones…' };
    const recomendaciones = {};
    for (const d of docentes) {
      recomendaciones[d] = await recomendarDocente(d, scores.docentes[d], clasificados, { demo });
      progreso = { ...progreso, hechos: progreso.hechos + 1, mensaje: `Recomendaciones: ${d}` };
    }

    ultimo = {
      archivo: nombre,
      demo,
      resumenCarga: resumen,
      comentarios: clasificados,
      scores,
      recomendaciones,
      aspectos: { pesos: ASPECTOS, nombres: NOMBRES_ASPECTOS },
      scoringReal: real,
      generado: new Date().toISOString(),
    };
    progreso = { activo: false, fase: 'listo', hechos: docentes.length, total: docentes.length, mensaje: 'Análisis completo.' };
    return ultimo;
  } catch (e) {
    progreso = { activo: false, fase: 'error', hechos: 0, total: 0, mensaje: e.message };
    throw e;
  }
}

const enviarError = (res, e) => res.status(e.status || 400).json({ error: e.message });
const esDemo = (v) => v === true || v === 'true' || v === '1';

app.post('/api/analizar', subida.single('archivo'), async (req, res) => {
  try {
    if (!req.file) throw new Error('No se recibió ningún archivo. Sube un .csv o .xlsx en el campo "archivo".');
    res.json(await analizar(req.file.buffer, req.file.originalname, esDemo(req.body?.demo)));
  } catch (e) {
    enviarError(res, e);
  }
});

app.post('/api/analizar-prueba', async (req, res) => {
  try {
    if (!fs.existsSync(ARCHIVO_PRUEBA)) throw new Error('No existe data/comentarios_prueba.csv todavía.');
    res.json(await analizar(fs.readFileSync(ARCHIVO_PRUEBA), 'comentarios_prueba.csv', esDemo(req.body?.demo)));
  } catch (e) {
    enviarError(res, e);
  }
});

app.get('/api/progreso', (_req, res) => res.json(progreso));

app.get('/api/estado', async (_req, res) => {
  const { real } = await cargarScoring();
  res.json({ hayApi: hayApi(), scoringReal: real, baseline: Boolean(await cargarBaseline()), dataPrueba: fs.existsSync(ARCHIVO_PRUEBA), etiquetas: fs.existsSync(ARCHIVO_ETIQUETAS) });
});

app.get('/api/ultimo', (_req, res) => (ultimo ? res.json(ultimo) : res.status(404).json({ error: 'Aún no hay análisis.' })));

app.get('/api/reporte/:docente', (req, res) => {
  if (!ultimo) return res.status(404).send('Primero ejecuta un análisis.');
  const d = req.params.docente;
  const info = ultimo.scores.docentes[d];
  if (!info) return res.status(404).send('Docente no encontrado.');
  const html = generarReporteHTML(d, info, ultimo.comentarios, ultimo.recomendaciones[d] || [], ultimo.scores.ranking.indexOf(d) + 1, ultimo.scores.ranking.length);
  const archivo = `reporte_${d.normalize('NFD').replace(/[^\w]+/g, '_')}.html`;
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
  res.type('html').send(html);
});

// ---------- Antes vs Ahora ----------

const SENT_VALIDOS = ['positivo', 'negativo', 'neutral', 'mixto'];

function leerEtiquetas() {
  const crudo = JSON.parse(fs.readFileSync(ARCHIVO_ETIQUETAS, 'utf8'));
  const lista = Array.isArray(crudo) ? crudo : crudo.etiquetas || crudo.comentarios || crudo.items || crudo.datos || Object.values(crudo).find(Array.isArray) || [];
  return lista
    .map((e, i) => ({
      id: e.id ?? i + 1,
      docente: e.docente ?? '—',
      comentario: e.comentario ?? e.texto ?? '',
      esperado: String(e.sentimiento ?? e.sentimiento_general ?? e.etiqueta ?? e.esperado ?? e.sentimientoGeneral ?? '').toLowerCase(),
      aspectosEsperados: e.aspectos ?? null,
      dudosoEsperado: e.dudoso ?? null,
      banderasEsperadas: e.banderas ?? null,
    }))
    .filter((e) => e.comentario);
}

/** Sentimiento global a partir de los aspectos (para comparar con una etiqueta única). */
export function sentimientoGlobal(c) {
  const s = new Set(c.aspectos.map((a) => a.sentimiento));
  if (s.has('positivo') && s.has('negativo')) return 'mixto';
  if (s.has('negativo')) return 'negativo';
  if (s.has('positivo')) return 'positivo';
  return 'neutral';
}

app.get('/api/comparar', async (req, res) => {
  try {
    if (!fs.existsSync(ARCHIVO_ETIQUETAS)) throw new Error('No existe data/etiquetas_esperadas.json todavía.');
    const clasificarBaseline = await cargarBaseline();
    if (!clasificarBaseline) throw new Error('El baseline (src/baseline.js) aún no está disponible.');
    const etiquetas = leerEtiquetas();
    const esperaMixto = etiquetas.some((e) => e.esperado === 'mixto');
    const clasif = await clasificarComentarios(etiquetas.map((e) => ({ id: e.id, docente: e.docente, comentario: e.comentario })), { demo: esDemo(req.query.demo) });
    const filas = etiquetas.map((e, i) => {
      const b = clasificarBaseline(e.comentario);
      const v = clasif[i];
      let vSent = sentimientoGlobal(v);
      // Si las etiquetas no usan "mixto", un mixto se compara contra el sentimiento negativo (lo accionable).
      if (vSent === 'mixto' && !esperaMixto) vSent = 'negativo';
      return {
        id: e.id,
        comentario: e.comentario,
        esperado: e.esperado,
        baseline: b.sentimiento,
        baselineConfianza: b.confianza,
        vozaula: v.dudoso ? 'revisión humana' : vSent,
        vozaulaSentimiento: vSent,
        vozaulaAspectos: v.aspectos,
        banderas: v.banderas,
        dudoso: v.dudoso,
        aciertoBaseline: b.sentimiento === e.esperado,
        aciertoVozaula: vSent === e.esperado,
        // Por aspecto: ¿encontró cada par (aspecto, sentimiento) esperado? El baseline no puede hacerlo.
        paresEsperados: Array.isArray(e.aspectosEsperados) ? e.aspectosEsperados.length : 0,
        paresAcertados: Array.isArray(e.aspectosEsperados)
          ? e.aspectosEsperados.filter((x) => v.aspectos.some((a) => a.aspecto === x.aspecto && a.sentimiento === x.sentimiento)).length
          : 0,
      };
    });
    const totalPares = filas.reduce((s, f) => s + f.paresEsperados, 0);
    const aciertoAspectos = totalPares ? (100 * filas.reduce((s, f) => s + f.paresAcertados, 0)) / totalPares : null;
    const pct = (k, arr = filas) => (arr.length ? (100 * arr.filter((f) => f[k]).length) / arr.length : 0);
    const seguros = filas.filter((f) => !f.dudoso);
    res.json({
      total: filas.length,
      sentimientos: SENT_VALIDOS.filter((s) => filas.some((f) => f.esperado === s)),
      aciertoBaseline: pct('aciertoBaseline'),
      aciertoVozaula: pct('aciertoVozaula'),
      aciertoVozaulaSinDudosos: pct('aciertoVozaula', seguros),
      aciertoAspectos,
      dudosos: filas.length - seguros.length,
      filas,
    });
  } catch (e) {
    enviarError(res, e);
  }
});

app.listen(PUERTO, () => console.log(`VozAula en http://localhost:${PUERTO}  (API: ${hayApi() ? 'sí' : 'no, solo caché'})`));
