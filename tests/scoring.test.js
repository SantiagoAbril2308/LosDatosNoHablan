import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calcularScores, PESOS } from '../src/scoring.js';
import { clasificarBaseline } from '../src/baseline.js';

const c = (docente, aspectos, dudoso = false) => ({ docente, aspectos, dudoso });
const a = (aspecto, sentimiento) => ({ aspecto, sentimiento });
const todos = sentimiento => Object.keys(PESOS).map(aspecto => a(aspecto, sentimiento));

test('2 perfectos no superan 40 casi perfectos con un prior global representativo', () => {
  // El contexto global contiene también docentes con dificultades; sin ese
  // contexto, un prior casi perfecto no penalizaría mucho las muestras pequeñas.
  const datos = [
    ...Array.from({ length: 2 }, () => c('Pequeña', todos('positivo'))),
    ...Array.from({ length: 38 }, () => c('Grande', todos('positivo'))),
    ...Array.from({ length: 2 }, () => c('Grande', todos('neutral'))),
    ...Array.from({ length: 30 }, () => c('Contexto', todos('negativo'))),
  ];
  const resultado = calcularScores(datos);
  assert.ok(resultado.docentes.Grande.scoreGeneral > resultado.docentes.Pequeña.scoreGeneral);
  assert.equal(resultado.ranking[0], 'Grande');
  const prior = 41 / 72;
  assert.ok(Math.abs(resultado.parametros.priors.metodologia - prior) < 1e-12);
  assert.equal(resultado.docentes.Pequeña.aspectos.metodologia.score,
    Math.round((2 + 5 * prior) / 7 * 1000) / 10);
});

test('Los dudosos se excluyen incluso del prior y se cuentan por docente', () => {
  const { docentes, parametros } = calcularScores([
    c('A', [a('metodologia', 'positivo')]),
    c('A', [a('metodologia', 'negativo')], true),
    c('B', todos('negativo'), true),
  ]);
  assert.equal(docentes.A.totalComentarios, 2);
  assert.equal(docentes.A.dudosos, 1);
  assert.equal(docentes.A.aspectos.metodologia.n, 1);
  assert.equal(docentes.A.aspectos.metodologia.mediaCruda, 1);
  assert.equal(parametros.priors.metodologia, 1);
  assert.equal(docentes.B.dudosos, 1);
  assert.equal(docentes.B.aspectoMasBajo, null);
  assert.equal(docentes.B.aspectoMasAlto, null);
});

test('Un mixto aporta sentimientos distintos a dos aspectos', () => {
  const mixto = { ...c('A', [a('metodologia', 'positivo'), a('puntualidad', 'negativo')]),
    confianza: 0.95, banderas: ['mixto'] };
  const d = calcularScores([mixto]).docentes.A;
  assert.equal(d.aspectos.metodologia.n, 1);
  assert.equal(d.aspectos.metodologia.mediaCruda, 1);
  assert.equal(d.aspectos.puntualidad.n, 1);
  assert.equal(d.aspectos.puntualidad.mediaCruda, 0);
  assert.equal(d.aspectoMasBajo, 'puntualidad');
  assert.equal(d.aspectoMasAlto, 'metodologia');
  assert.equal(d.dudosos, 0);
});

test('Un aspecto sin menciones propias recibe el prior global', () => {
  const r = calcularScores([
    c('A', [a('metodologia', 'negativo')]),
    c('B', [a('evaluacion', 'positivo')]),
    c('B', [a('evaluacion', 'neutral')]),
  ]);
  assert.deepEqual(r.docentes.A.aspectos.evaluacion,
    { score: 75, n: 0, mediaCruda: null, confianza: 'baja' });
  assert.equal(r.docentes.A.aspectos.puntualidad.score, 50);
  assert.equal(r.parametros.priors.puntualidad, 0.5);
});

test('Los PESOS suman 1 y coinciden con el contrato', () => {
  assert.ok(Math.abs(Object.values(PESOS).reduce((x, y) => x + y, 0) - 1) < 1e-12);
  assert.deepEqual(PESOS, { metodologia: 0.30, dominio_tema: 0.25,
    trato_estudiante: 0.20, evaluacion: 0.15, puntualidad: 0.10 });
});

test('Un arreglo vacío devuelve resultado vacío con priors neutrales', () => {
  const r = calcularScores([]);
  assert.deepEqual(r.docentes, {});
  assert.deepEqual(r.ranking, []);
  assert.equal(r.parametros.m, 5);
  assert.ok(Object.values(r.parametros.priors).every(x => x === 0.5));
});

test('El baseline falla con el sarcasmo de belleza como se espera', () => {
  assert.equal(clasificarBaseline('qué belleza de profe, nunca contesta').sentimiento, 'positivo');
});

test('El baseline cuenta palabras completas, mayúsculas, tildes y empates', () => {
  assert.deepEqual(clasificarBaseline('EXCELENTE, pésimo'), { sentimiento: 'neutral', confianza: 0 });
  assert.equal(clasificarBaseline('horrible y grosera').sentimiento, 'negativo');
  assert.equal(clasificarBaseline('buenamente').sentimiento, 'neutral');
  assert.deepEqual(clasificarBaseline(''), { sentimiento: 'neutral', confianza: 0 });
});

test('Los límites de confianza corresponden al número de menciones', () => {
  for (const [n, confianza] of [[2, 'baja'], [3, 'media'], [7, 'media'], [8, 'alta']]) {
    const r = calcularScores(Array.from({ length: n }, () => c('A', todos('positivo'))));
    assert.equal(r.docentes.A.aspectos.metodologia.confianza, confianza);
  }
});

test('m configurable afecta el suavizado y rechaza valores inválidos', () => {
  const datos = [c('A', todos('positivo')), c('B', todos('negativo'))];
  assert.ok(calcularScores(datos, 1).docentes.A.scoreGeneral > calcularScores(datos, 10).docentes.A.scoreGeneral);
  for (const m of [0, -1, NaN, Infinity, '5']) assert.throws(() => calcularScores([], m), RangeError);
});

test('Ignora etiquetas desconocidas sin contaminar los puntajes', () => {
  const r = calcularScores([c('__proto__', [a('otro', 'positivo'), a('metodologia', 'desconocido')])]);
  assert.equal(r.docentes['__proto__'].scoreGeneral, 50);
  assert.equal(r.docentes['__proto__'].aspectos.metodologia.n, 0);
});

test('Dataset UTF-8: 96 filas, distribución desigual y 30 referencias presentes', () => {
  const csv = readFileSync(new URL('../data/comentarios_prueba.csv', import.meta.url), 'utf8');
  const etiquetas = JSON.parse(readFileSync(new URL('../data/etiquetas_esperadas.json', import.meta.url), 'utf8'));
  assert.equal(csv.trim().split(/\r?\n/).length, 97);
  assert.equal(etiquetas.length, 30);
  assert.equal(new Set(etiquetas.map(e => e.comentario)).size, 30);
  assert.equal(etiquetas.filter(e => e.banderas.includes('sarcasmo')).length, 15);
  assert.equal(etiquetas.filter(e => e.banderas.includes('mixto')).length, 15);
  for (const etiqueta of etiquetas) {
    assert.ok(csv.includes('"' + etiqueta.comentario.replaceAll('"', '""') + '"'));
    for (const aspecto of etiqueta.aspectos) assert.ok(Object.hasOwn(PESOS, aspecto.aspecto));
  }
  const conteos = new Map();
  for (const fila of csv.trim().split(/\r?\n/).slice(1)) {
    const nombre = fila.match(/^"([^"]+)"/)[1];
    conteos.set(nombre, (conteos.get(nombre) ?? 0) + 1);
  }
  assert.deepEqual([...conteos.values()].sort((a,b) => a-b), [4,18,19,20,35]);
  assert.ok(csv.includes('Héctor') && csv.includes('evaluación'));
});

