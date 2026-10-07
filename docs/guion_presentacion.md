# VozAula — guion para el jurado

**Reto S-1 «Los datos no hablan solos» · 5 minutos**

Preparación: abrir VozAula en modo demo y cargar el dataset de prueba. Leer los bloques citados; las tablas y notas sirven de apoyo. Ensayar con cronómetro, incluyendo los cambios de pestaña.

## 0:00–0:30 · Problema (30 segundos)

> Una universidad recibe cientos de comentarios sobre sus docentes. Pero “qué belleza de profe” puede ser una queja, y “explica bien pero llega tarde” contiene dos evaluaciones distintas. Si reducimos todo a positivo o negativo, perdemos información útil. VozAula carga archivos CSV o Excel y convierte esos comentarios en evidencia por aspecto, un puntaje comparable y acciones concretas, dejando los casos dudosos para revisión humana.

## 0:30–1:30 · Por qué contar palabras falla (1 minuto)

Mostrar estos tres textos literales del dataset. **Los resultados se obtuvieron ejecutando `clasificarBaseline()`**, y se contrastaron con `data/etiquetas_esperadas.json`.

| Comentario real | Resultado ejecutado | Clasificación esperada |
| --- | --- | --- |
| «Qué belleza de profe, nunca contesta un correo.» | `positivo`, confianza `1` | Trato al estudiante negativo; sarcasmo. |
| «Siempre llega a la hora, pero esa clase es un ladrillo.» | `negativo`, confianza `1` | Puntualidad positiva y metodología negativa; mixto. |
| «Explica bien pero llega tarde siempre.» | `negativo`, confianza `1` | Metodología positiva y puntualidad negativa; mixto. |

> Corrimos el método que cuenta palabras sin interpretar contexto. En el primer ejemplo encuentra “belleza” y responde positivo: interpreta al revés el sarcasmo. En el segundo encuentra “ladrillo” y responde negativo, perdiendo el reconocimiento a la puntualidad. En el tercero encuentra “tarde” y vuelve a responder negativo, borrando que explica bien. Los tres salen con confianza uno. Esa cifra solo describe el conteo del léxico; no significa que tenga certeza de comprender. Necesitamos conservar qué se está evaluando y qué se dice sobre cada aspecto.

## 1:30–3:30 · Cómo funciona VozAula (2 minutos)

### 1:30–2:15 · IA por aspecto y detección de dudosos

Mostrar el comentario mixto en **Docente**, seguido de **Revisión humana**.

> Primero validamos las columnas docente y comentario, y retiramos vacíos y duplicados. La IA identifica metodología, dominio del tema, trato al estudiante, evaluación y puntualidad. Cada aspecto conserva sentimiento y una cita de evidencia: “explica bien” aporta a metodología y “llega tarde” a puntualidad. No se cancelan entre sí.
>
> Las reglas de revisión se aplican en código: confianza menor que 0,70, ambigüedad, fuera de tema o sarcasmo con confianza menor que 0,85. Un mixto con confianza alta sí entra al cálculo. Los dudosos se apartan y se cuentan; no alteran los puntajes ni los promedios globales. En esta corrida quedaron trece para revisión.

### 2:15–3:30 · Puntaje bayesiano: ejemplo real de Lucía Torres

Seleccionar a **Lucía Torres**, docente con cuatro comentarios. La tabla es apoyo visual; no leerla completa.

> Lucía tiene cuatro comentarios positivos, uno en cada aspecto salvo puntualidad. Es una buena señal, pero todavía poca evidencia. En vez de darle cien automáticamente, combinamos su media con la media global del mismo aspecto. Usamos cinco menciones de referencia, el parámetro m.
>
> En metodología tiene una mención positiva: media uno. El promedio global es 0,625. El cálculo es uno más cinco por 0,625, dividido entre seis: 68,8 sobre cien. En puntualidad no tiene menciones: recibe la referencia global, 73,3, señalada con cero observaciones. Eso no prueba que sea puntual.
>
> Aplicando los pesos, su puntaje general es 71,7. La confianza por cantidad de menciones es baja. Con más comentarios, la evidencia propia pesa más. Esto reduce el efecto de muestras pequeñas, pero no elimina sesgos ni garantiza que siempre gane quien tenga más comentarios. Incluso su 44,4 en evaluación convive con un elogio: refleja el ajuste, no una queja que podamos inventar.

**Ejecución real:** `calcularScores(clasificados, 5)` sobre los 96 comentarios del CSV, clasificados desde la caché actual mediante `clasificarComentarios(comentarios, { demo: true })`. No se construyó una muestra artificial ni se llamó a una API para obtener estas cifras.

| Aspecto de Lucía | Peso | n | Media propia (0–1) | Prior global (0–1) | Score (0–100) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Metodología | 0,30 | 1 | 1 | 0,625 | 68,8 |
| Dominio del tema | 0,25 | 1 | 1 | 1 | 100,0 |
| Trato al estudiante | 0,20 | 1 | 1 | 0,5238095238 | 60,3 |
| Evaluación | 0,15 | 1 | 1 | 0,3333333333 | 44,4 |
| Puntualidad | 0,10 | 0 | Sin datos | 0,7333333333 | 73,3 |

```text
Score por aspecto = 100 × (n × media + 5 × prior) / (n + 5)
Metodología = 100 × (1 × 1 + 5 × 0,625) / 6 = 68,75 → 68,8
General = suma de pesos × scores SIN redondear = 71,714285… → 71,7
```

En los cinco aspectos la confianza por volumen es **baja**. Es distinta de la confianza del clasificador al interpretar cada texto. El prior usa todas las menciones válidas del aspecto, incluidas las del propio docente. Si no existe ninguna mención global, usa 0,5. Lucía tiene cuatro comentarios totales y cero dudosos.

## 3:30–4:00 · Recomendaciones (30 segundos)

Mostrar las recomendaciones de **Paola Méndez**.

> El resultado no termina en una nota. Para Paola, los estudiantes dicen “califica sin decir qué esperaba” y “cambió la rúbrica después de calificar”. La recomendación obtenida propone publicar la rúbrica antes del primer parcial, mantenerla y devolver retroalimentación escrita en tres días hábiles. También reconocemos fortalezas como “Domina economía”. Elegimos hasta dos aspectos bajos y uno alto con evidencia; si no hay quejas, no inventamos un problema porque el score ajustado sea bajo.

Nota: la recomendación se recuperó de la caché con `recomendarDocente(..., { demo: true })`. Sin recomendación cacheada, el modo demo usa plantillas por aspecto y evidencia disponible. Es una propuesta que requiere valoración pedagógica antes de aplicarse.

## 4:00–5:00 · Cierre: los cinco puntos (1 minuto)

> VozAula responde a cinco necesidades. Primero, carga masiva desde CSV o Excel: no exige transcribir comentarios. Segundo, clasificación por aspecto y sentimiento: conserva elogios y críticas dentro de una misma frase. Tercero, un puntaje comparable: pesos explícitos y ajuste bayesiano que considera cuánta evidencia hay. Cuarto, manejo de incertidumbre: aparta dudosos, muestra el motivo y permite que una persona los revise. Quinto, recomendaciones específicas: cada acción se conecta con lo que dijeron los estudiantes y también reconoce buenas prácticas.
>
> Podemos mostrarlo sin conexión usando la caché del dataset. Esta demostración es reproducible, pero no sustituye una validación con nuevas evaluaciones reales. Nuestra propuesta es que la universidad pueda ver qué se dijo, sobre qué aspecto, con qué evidencia y qué decisión merece revisión. Los datos no hablan solos: VozAula ayuda a escucharlos con contexto.

## Cinco preguntas difíciles del jurado

1. **¿Por qué esos pesos?** Metodología 30 %, dominio 25 %, trato 20 %, evaluación 15 % y puntualidad 10 % priorizan su impacto propuesto en el aprendizaje. Son decisiones explícitas del prototipo, no parámetros validados empíricamente; deben revisarse con docentes, estudiantes y análisis de sensibilidad.
2. **¿Qué pasa si la IA se equivoca con mucha confianza?** Puede ocurrir y los umbrales no detectan todos los errores. Mostramos evidencia y apartamos casos señalados, pero también hacen falta auditorías humanas de los aceptados y evaluación con textos nuevos. La confianza del modelo no está calibrada como probabilidad de acierto.
3. **¿Por qué m = 5?** Equivale a cinco menciones con la media global y es un punto de partida configurable. Debemos comparar, por ejemplo, m = 2, 5 y 10 para medir cambios en el ranking; ese valor no tiene una garantía universal.
4. **¿Es justo que Lucía reciba 44,4 en evaluación si solo hay un elogio?** Es una limitación del ajuste: con una sola mención pesa más el prior global, que aquí es bajo. Hay que leer score, n y evidencia juntos. No atribuimos una queja inexistente ni usamos el número aislado para sancionar.
5. **¿La demo cacheada demuestra que funciona con cualquier comentario?** No. Demuestra el flujo para ese dataset. Textos nuevos necesitan API; en modo demo, los que no están cacheados quedan sin clasificación y pasan como dudosos. La generalización exige un conjunto independiente, más anotadores y evaluación por aspecto, incluyendo los casos apartados.

## Respaldo: reproducir los resultados

Desde la raíz del repositorio en PowerShell, con dependencias instaladas. El comando solo lee datos y caché: `demo: true` impide llamadas a la API. Si cambia el dataset o la caché, actualizar las cifras antes de exponer.

```powershell
@'
import fs from 'node:fs';
import { cargarComentarios } from './src/carga.js';
import { clasificarBaseline } from './src/baseline.js';
import { clasificarComentarios } from './src/clasificador.js';
import { calcularScores } from './src/scoring.js';
import { recomendarDocente } from './src/recomendaciones.js';

for (const texto of [
  'Qué belleza de profe, nunca contesta un correo.',
  'Siempre llega a la hora, pero esa clase es un ladrillo.',
  'Explica bien pero llega tarde siempre.',
]) console.log(texto, clasificarBaseline(texto));

const { comentarios } = cargarComentarios(
  fs.readFileSync('data/comentarios_prueba.csv'), 'comentarios_prueba.csv');
const clasificados = await clasificarComentarios(comentarios, { demo: true });
const resultado = calcularScores(clasificados, 5);
console.log(JSON.stringify({
  parametros: resultado.parametros,
  lucia: resultado.docentes['Lucía Torres'],
  dudosos: clasificados.filter(c => c.dudoso).length,
}, null, 2));
console.log(await recomendarDocente('Paola Méndez',
  resultado.docentes['Paola Méndez'], clasificados, { demo: true }));
'@ | node --input-type=module -
```

Fuentes locales: `data/comentarios_prueba.csv`, `data/etiquetas_esperadas.json`, `src/baseline.js`, `src/scoring.js`, `src/clasificador.js`, `src/recomendaciones.js` y las cachés de demo. Resultados verificados el **7 de octubre de 2026**, con Node **22.14.0** en el entorno disponible.
