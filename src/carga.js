import { parse } from 'csv-parse/sync';
import XLSX from 'xlsx';
import path from 'node:path';

const OBLIGATORIAS = ['docente', 'comentario'];
const OPCIONALES = ['materia', 'semestre'];

const normalizarClave = (k) =>
  String(k ?? '')
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const limpiarTexto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

function leerFilas(buffer, nombreArchivo) {
  const ext = path.extname(nombreArchivo || '').toLowerCase();
  if (ext === '.xlsx' || ext === '.xls') {
    const libro = XLSX.read(buffer, { type: 'buffer' });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    if (!hoja) throw new Error('El archivo Excel no tiene hojas.');
    return XLSX.utils.sheet_to_json(hoja, { defval: '' });
  }
  if (ext === '.csv' || ext === '.txt' || !ext) {
    const texto = buffer.toString('utf8');
    const primeraLinea = texto.split(/\r?\n/)[0] || '';
    const delimitador = (primeraLinea.match(/;/g) || []).length > (primeraLinea.match(/,/g) || []).length ? ';' : ',';
    return parse(texto, { columns: true, skip_empty_lines: true, bom: true, delimiter: delimitador, relax_column_count: true, trim: true });
  }
  throw new Error(`Formato no soportado (${ext}). Sube un archivo .csv o .xlsx.`);
}

/**
 * Lee un CSV o XLSX y devuelve comentarios limpios:
 * [{ id, docente, comentario, materia?, semestre? }]
 */
export function cargarComentarios(buffer, nombreArchivo) {
  let filas;
  try {
    filas = leerFilas(buffer, nombreArchivo);
  } catch (e) {
    if (e.message.startsWith('Formato no soportado')) throw e;
    throw new Error(`No se pudo leer el archivo "${nombreArchivo}": ${e.message}`);
  }
  if (!filas.length) throw new Error('El archivo está vacío: no tiene filas de datos.');

  const columnas = Object.keys(filas[0]).map(normalizarClave);
  const faltantes = OBLIGATORIAS.filter((c) => !columnas.includes(c));
  if (faltantes.length) {
    throw new Error(
      `Faltan columnas obligatorias: ${faltantes.join(', ')}. ` +
        `Columnas encontradas: ${Object.keys(filas[0]).join(', ') || '(ninguna)'}. ` +
        `El archivo debe tener encabezados "docente" y "comentario" (opcionales: "materia", "semestre").`
    );
  }

  const vistos = new Set();
  const comentarios = [];
  let vacios = 0;
  let duplicados = 0;
  for (const fila of filas) {
    const f = {};
    for (const [k, v] of Object.entries(fila)) f[normalizarClave(k)] = limpiarTexto(v);
    if (!f.docente || !f.comentario) {
      vacios++;
      continue;
    }
    const llave = `${f.docente.toLowerCase()}|${f.comentario.toLowerCase()}`;
    if (vistos.has(llave)) {
      duplicados++;
      continue;
    }
    vistos.add(llave);
    const c = { id: comentarios.length + 1, docente: f.docente, comentario: f.comentario };
    for (const o of OPCIONALES) if (f[o]) c[o] = f[o];
    comentarios.push(c);
  }
  if (!comentarios.length) throw new Error('No quedó ningún comentario válido después de limpiar filas vacías.');
  return { comentarios, resumen: { filasLeidas: filas.length, validos: comentarios.length, vacios, duplicados } };
}
