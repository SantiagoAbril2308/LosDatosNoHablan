// Referencia deliberadamente ingenua: no entiende negaciones, ironía ni aspectos.
const POSITIVAS = new Set(`bueno buena buenos buenas excelente excelentes genial maravilloso maravillosa
belleza bonito bonita claro clara claros claras fácil fáciles útil útiles amable amables respetuoso
respetuosa puntual puntuales organizado organizada dinámico dinámica entretenido entretenida paciente
paciencia domina sabe aprende aprender ayuda justo justa`.split(/\s+/));
const NEGATIVAS = new Set(`malo mala malos malas pésimo pésima horrible aburrido aburrida confuso confusa
difícil difíciles inútil inútiles grosero grosera irrespetuoso irrespetuosa impuntual tarde desorganizado
desorganizada injusto injusta humilla humillar grita gritó burla ridiculiza ladrillo lento lenta tedioso
tediosa error errores falla frustrante`.split(/\s+/));

/**
 * Cuenta palabras positivas y negativas sin interpretar contexto.
 * «Qué belleza de profe, nunca contesta» resulta positivo: falla intencional
 * del método de referencia que permite explicar el valor del análisis por aspecto.
 * La confianza es la proporción de coincidencias de la clase ganadora; un
 * empate sin dirección devuelve neutral con confianza cero.
 * @param {string} texto
 * @returns {{sentimiento: 'positivo'|'negativo'|'neutral', confianza: number}}
 */
export function clasificarBaseline(texto) {
  const palabras = String(texto ?? '').toLocaleLowerCase('es').normalize('NFC').match(/\p{L}+/gu) ?? [];
  let positivos = 0, negativos = 0;
  for (const palabra of palabras) {
    if (POSITIVAS.has(palabra)) positivos++;
    if (NEGATIVAS.has(palabra)) negativos++;
  }
  if (positivos === negativos) return { sentimiento: 'neutral', confianza: 0 };
  return { sentimiento: positivos > negativos ? 'positivo' : 'negativo',
    confianza: Math.max(positivos, negativos) / (positivos + negativos) };
}
