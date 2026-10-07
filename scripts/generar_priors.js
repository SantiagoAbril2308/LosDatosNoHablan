// Genera data/priors_referencia.json: media institucional por aspecto calculada sobre
// data/comentarios_prueba.csv usando las clasificaciones ya guardadas en la caché.
// Uso: node scripts/generar_priors.js
import fs from 'node:fs';
import { cargarComentarios } from '../src/carga.js';
import { crearCache, hashTexto, motivoDudoso } from '../src/clasificador.js';
import { ASPECTOS } from '../src/aspectos.js';

const VALORES = { positivo: 1, neutral: 0.5, negativo: 0 };
const { comentarios } = cargarComentarios(fs.readFileSync('data/comentarios_prueba.csv'), 'comentarios_prueba.csv');
const cache = crearCache('clasificaciones.json');
const acum = Object.fromEntries(Object.keys(ASPECTOS).map((a) => [a, { suma: 0, n: 0 }]));
let sinCache = 0;
for (const c of comentarios) {
  const r = cache.get(hashTexto(c.comentario));
  if (!r) { sinCache++; continue; }
  if (motivoDudoso(r)) continue;
  for (const m of r.aspectos) {
    acum[m.aspecto].suma += VALORES[m.sentimiento];
    acum[m.aspecto].n++;
  }
}
if (sinCache) throw new Error(`${sinCache} comentarios sin clasificar en caché: corre primero el análisis.`);
// Suavizado de Laplace (2 menciones neutrales): ningún prior queda en 0 o 1 aunque todas las menciones coincidan.
const SUAVIZADO = 2;
const priors = Object.fromEntries(Object.entries(acum).map(([a, { suma, n }]) => [a, (suma + SUAVIZADO * 0.5) / (n + SUAVIZADO)]));
const menciones = Object.fromEntries(Object.entries(acum).map(([a, { n }]) => [a, n]));
fs.writeFileSync('data/priors_referencia.json', JSON.stringify({
  descripcion: 'Media institucional de referencia por aspecto (0-1), sobre data/comentarios_prueba.csv sin dudosos, con suavizado de 2 menciones neutrales.',
  fuente: 'data/comentarios_prueba.csv',
  comentarios: comentarios.length,
  menciones,
  priors,
}, null, 2) + '\n');
console.log({ menciones, priors });
