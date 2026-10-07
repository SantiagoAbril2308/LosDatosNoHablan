// Pesos de cada aspecto en el puntaje general (suman 1.0).
// Se ordenan por su impacto directo en el aprendizaje del estudiante.
export const ASPECTOS = {
  // 30%: cómo enseña (claridad, ejemplos, ritmo) es lo que más determina si el estudiante aprende.
  metodologia: 0.30,
  // 25%: sin dominio del tema no hay buena explicación posible; es la base de lo que se enseña.
  dominio_tema: 0.25,
  // 20%: el respeto y la disposición para resolver dudas condicionan si el estudiante pregunta y participa.
  trato_estudiante: 0.20,
  // 15%: evaluaciones justas y coherentes con lo enseñado miden y refuerzan el aprendizaje, pero no lo producen.
  evaluacion: 0.15,
  // 10%: la puntualidad afecta el tiempo efectivo de clase, pero por sí sola impacta menos el aprendizaje.
  puntualidad: 0.10,
};

export const NOMBRES_ASPECTOS = {
  metodologia: 'Metodología',
  dominio_tema: 'Dominio del tema',
  trato_estudiante: 'Trato al estudiante',
  evaluacion: 'Evaluación',
  puntualidad: 'Puntualidad',
};

export const SENTIMIENTOS = ['positivo', 'negativo', 'neutral'];
export const BANDERAS = ['sarcasmo', 'ambiguo', 'mixto', 'fuera_de_tema'];
