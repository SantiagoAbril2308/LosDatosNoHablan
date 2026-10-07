const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const fmtConf = (c) => (typeof c === "number" ? `${Math.round(c * 100)}%` : c ?? "—");
const crudaPct = (m) => (m == null ? null : m <= 1 ? m * 100 : m);

const NOMBRES = { metodologia: 'Metodología', dominio_tema: 'Dominio del tema', trato_estudiante: 'Trato al estudiante', evaluacion: 'Evaluación', puntualidad: 'Puntualidad' };
const BANDERAS = { sarcasmo: 'Sarcasmo', ambiguo: 'Ambiguo', mixto: 'Mixto', fuera_de_tema: 'Fuera de tema' };

let datos = null;
let grafico = null;

// ---------- Pestañas ----------
document.querySelectorAll('#tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('activa', x === b));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('oculto', t.id !== `tab-${b.dataset.tab}`));
  })
);
const irA = (tab) => document.querySelector(`#tabs button[data-tab="${tab}"]`).click();

// ---------- Errores y progreso ----------
function mostrarError(msg) {
  const e = $('#error');
  e.textContent = msg || '';
  e.classList.toggle('oculto', !msg);
}

let sondeo = null;
function iniciarSondeo() {
  $('#progreso').classList.remove('oculto');
  clearInterval(sondeo);
  sondeo = setInterval(async () => {
    try {
      const p = await fetch('/api/progreso').then((r) => r.json());
      const pct = p.total ? (100 * p.hechos) / p.total : 0;
      const fases = { carga: 'Carga', clasificacion: 'Clasificando', puntajes: 'Puntajes', recomendaciones: 'Recomendaciones', listo: 'Listo', error: 'Error' };
      $('#barra').style.width = `${pct}%`;
      $('#msgProgreso').textContent = `${fases[p.fase] ?? ''} ${p.total ? `(${p.hechos}/${p.total})` : ''} — ${p.mensaje ?? ''}`;
    } catch {}
  }, 1000);
}
function detenerSondeo() {
  clearInterval(sondeo);
  setTimeout(() => $('#progreso').classList.add('oculto'), 1200);
}

async function ejecutar(peticion) {
  mostrarError('');
  $('#btnAnalizar').disabled = $('#btnPrueba').disabled = true;
  iniciarSondeo();
  try {
    const r = await peticion();
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Error desconocido');
    datos = j;
    $('#barra').style.width = '100%';
    $('#msgProgreso').textContent = `Listo: ${j.comentarios.length} comentarios, ${j.scores.ranking.length} docentes${j.demo ? ' (modo demo, solo caché)' : ''}.`;
    renderTodo();
    irA('docente');
  } catch (e) {
    mostrarError(e.message);
  } finally {
    detenerSondeo();
    $('#btnAnalizar').disabled = !$('#archivo').files.length;
    $('#btnPrueba').disabled = false;
  }
}

$('#archivo').addEventListener('change', () => {
  const f = $('#archivo').files[0];
  $('#nombreArchivo').textContent = f ? f.name : 'Elegir CSV / XLSX';
  $('#btnAnalizar').disabled = !f;
});
$('#btnAnalizar').addEventListener('click', () => {
  const fd = new FormData();
  fd.append('archivo', $('#archivo').files[0]);
  fd.append('demo', $('#demo').checked);
  ejecutar(() => fetch('/api/analizar', { method: 'POST', body: fd }));
});
$('#btnPrueba').addEventListener('click', () =>
  ejecutar(() => fetch('/api/analizar-prueba', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ demo: $('#demo').checked }) }))
);

// ---------- Render ----------
const chipsAspectos = (c) =>
  c.aspectos.map((a) => `<span class="chip ${a.sentimiento}" title="${esc(a.evidencia)}">${NOMBRES[a.aspecto] ?? a.aspecto}: ${a.sentimiento}${a.evidencia ? ` <small>«${esc(a.evidencia)}»</small>` : ''}</span>`).join('');
const chipsBanderas = (c) => c.banderas.map((b) => `<span class="chip bandera">${BANDERAS[b] ?? b}</span>`).join('');

function tarjetaComentario(c, extra = '') {
  const color = c.dudoso ? 'var(--ambar)' : c.banderas.includes('mixto') ? 'var(--azul)' : 'var(--borde)';
  return `<div class="comentario" style="border-left-color:${color}">
    <div class="texto">"${esc(c.comentario)}"</div>
    <div class="chips">${chipsAspectos(c)}${chipsBanderas(c)}</div>
    <div class="meta">${esc(c.docente)}${c.materia ? ` · ${esc(c.materia)}` : ''} · confianza ${num(c.confianza, 2)}${extra}</div>
  </div>`;
}

function renderTodo() {
  $('#vacio').classList.add('oculto');
  $('#vistaDocente').classList.remove('oculto');
  const sel = $('#selDocente');
  sel.innerHTML = datos.scores.ranking.map((d, i) => `<option value="${esc(d)}">${i + 1}. ${esc(d)}</option>`).join('');
  renderDocente(sel.value);
  renderRevision();
  renderRanking();
  $('#mParam').textContent = datos.scores.parametros?.m ?? 'm';
  $('#notaPrior').classList.toggle('oculto', datos.scores.parametros?.fuentePrior !== 'referencia');
}
$('#selDocente').addEventListener('change', (e) => renderDocente(e.target.value));

function renderDocente(nombre) {
  const info = datos.scores.docentes[nombre];
  if (!info) return;
  const pos = datos.scores.ranking.indexOf(nombre) + 1;
  $('#scoreGeneral').innerHTML = `${num(info.scoreGeneral)}<small>/100</small>`;
  $('#detalleGeneral').innerHTML = `Puesto <b>${pos}</b> de ${datos.scores.ranking.length}<br>${info.totalComentarios} comentarios · ${info.dudosos} en revisión`;
  $('#btnReporte').href = `/api/reporte/${encodeURIComponent(nombre)}`;

  const claves = Object.keys(NOMBRES);
  const asp = claves.map((a) => info.aspectos[a] || { score: null, n: 0, confianza: 0 });
  const colores = asp.map((v) => (v.n === 0 ? '#bcccdc' : v.score >= 70 ? '#2f855a' : v.score >= 50 ? '#1d4e89' : '#c0392b'));
  if (grafico) grafico.destroy();
  if (window.Chart) {
    grafico = new Chart($('#graficoAspectos'), {
      type: 'bar',
      data: {
        labels: claves.map((a, i) => [NOMBRES[a], `n=${asp[i].n} · conf ${fmtConf(asp[i].confianza)}`]),
        datasets: [{ data: asp.map((v) => v.score), backgroundColor: colores, borderRadius: 6 }],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `Puntaje ${num(ctx.raw)} · media cruda ${num(crudaPct(asp[ctx.dataIndex].mediaCruda))} · n=${asp[ctx.dataIndex].n}` } } },
        scales: { x: { min: 0, max: 100, ticks: { font: { size: 16 } } }, y: { ticks: { font: { size: 17 } } } },
      },
    });
  }

  const recs = datos.recomendaciones[nombre] || [];
  const li = (r) => `<li><b>${NOMBRES[r.aspecto] ?? r.aspecto} (${num(info.aspectos[r.aspecto]?.score)}):</b> ${esc(r.texto)}${r.citas?.length ? `<span class="cita">${r.citas.map((c) => `«${esc(c)}»`).join(' · ')}</span>` : ''}</li>`;
  $('#recsReconocer').innerHTML = recs.filter((r) => r.tipo === 'reconocer').map(li).join('') || '<li>Sin datos suficientes.</li>';
  $('#recsMejorar').innerHTML = recs.filter((r) => r.tipo === 'mejorar').map(li).join('') || '<li>Sin datos suficientes.</li>';

  const propios = datos.comentarios.filter((c) => c.docente === nombre);
  const sarcasmos = propios.filter((c) => c.banderas.includes('sarcasmo'));
  $('#nSarcasmos').textContent = sarcasmos.length || '';
  $('#sarcasmos').innerHTML =
    sarcasmos
      .map(
        (c) => `<div class="sarcasmo">
        <span class="insignia">Sarcasmo detectado</span>${c.dudoso ? ' <span class="chip bandera">en revisión humana</span>' : ''}
        <div class="literal"><b>Dice:</b> "${esc(c.comentario)}"</div>
        <div class="real"><b>Se interpretó como:</b> <span class="chips">${chipsAspectos(c)}</span></div>
        ${c.razon ? `<div class="meta">${esc(c.razon)} · confianza ${num(c.confianza, 2)}</div>` : ''}
      </div>`
      )
      .join('') || '<p class="ayuda">No se detectó sarcasmo en los comentarios de este docente.</p>';

  const mixtos = propios.filter((c) => c.banderas.includes('mixto') && !c.dudoso);
  $('#mixtos').innerHTML = mixtos.map((c) => tarjetaComentario(c)).join('') || '<p class="ayuda">Este docente no tiene comentarios mixtos.</p>';
  $('#todos').innerHTML = propios.map((c) => tarjetaComentario(c, c.dudoso ? ' · <b>en revisión humana</b>' : '')).join('');
}

function renderRevision() {
  const dudosos = datos.comentarios.filter((c) => c.dudoso);
  $('#badgeDudosos').textContent = dudosos.length || '';
  $('#listaDudosos').innerHTML =
    dudosos.map((c) => tarjetaComentario(c, `<br><b>Motivo:</b> ${esc(c.motivo)}${c.razon ? `<br><b>Lectura del modelo:</b> ${esc(c.razon)}` : ''}`)).join('') ||
    '<p class="ayuda">No hay comentarios dudosos.</p>';
}

function renderRanking() {
  const { docentes, ranking } = datos.scores;
  const claves = Object.keys(NOMBRES);
  const filas = ranking
    .map((d, i) => {
      const v = docentes[d];
      return `<tr class="clic" data-docente="${esc(d)}"><td class="pos">${i + 1}</td><td><b>${esc(d)}</b></td>
        <td class="num"><b>${num(v.scoreGeneral)}</b></td><td class="num">${v.totalComentarios}</td><td class="num">${v.dudosos}</td>
        ${claves.map((a) => `<td class="num" title="n=${v.aspectos[a]?.n ?? 0}">${v.aspectos[a]?.n ? num(v.aspectos[a].score, 0) : '<span class="ayuda">—</span>'}</td>`).join('')}
        <td>${NOMBRES[v.aspectoMasAlto] ?? '—'}</td><td>${NOMBRES[v.aspectoMasBajo] ?? '—'}</td></tr>`;
    })
    .join('');
  $('#tablaRanking').innerHTML = `<table class="tabla"><thead><tr><th>#</th><th>Docente</th><th>Puntaje</th><th>Coment.</th><th>Dudosos</th>
    ${claves.map((a) => `<th>${NOMBRES[a]}</th>`).join('')}<th>Fortaleza</th><th>A mejorar</th></tr></thead><tbody>${filas}</tbody></table>`;
  document.querySelectorAll('#tablaRanking tr.clic').forEach((tr) =>
    tr.addEventListener('click', () => {
      $('#selDocente').value = tr.dataset.docente;
      renderDocente(tr.dataset.docente);
      irA('docente');
    })
  );
}

// ---------- Antes vs Ahora ----------
$('#btnComparar').addEventListener('click', async () => {
  mostrarError('');
  $('#btnComparar').disabled = true;
  $('#tablaComparacion').innerHTML = '<p class="ayuda">Clasificando…</p>';
  try {
    const r = await fetch(`/api/comparar?demo=${$('#demo').checked}`);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    $('#resumenComparacion').innerHTML = `
      <div class="kpi antes"><div class="valor">${num(j.aciertoBaseline, 0)}%</div>Antes: conteo de palabras</div>
      <div class="kpi ahora"><div class="valor">${num(j.aciertoVozaula, 0)}%</div>Ahora: VozAula</div>
      <div class="kpi"><div class="valor">${num(j.aciertoVozaulaSinDudosos, 0)}%</div>VozAula sin los ${j.dudosos} dudosos<br><small>(los que sí se puntúan)</small></div>
      ${j.aciertoAspectos != null ? `<div class="kpi ahora"><div class="valor">${num(j.aciertoAspectos, 0)}%</div>Aspecto + sentimiento correctos<br><small>(el método anterior no puede hacerlo: 0%)</small></div>` : ''}`;
    const marca = (ok) => (ok ? '<span class="ok">✔</span>' : '<span class="mal">✘</span>');
    $('#tablaComparacion').innerHTML = `<table class="tabla"><thead><tr><th>Comentario</th><th>Correcta</th><th>Antes</th><th>VozAula</th></tr></thead><tbody>
      ${j.filas
        .map(
          (f) => `<tr><td>"${esc(f.comentario)}"<div class="chips">${f.banderas.map((b) => `<span class="chip bandera">${BANDERAS[b] ?? b}</span>`).join('')}</div></td>
          <td><b>${esc(f.esperado)}</b></td>
          <td>${marca(f.aciertoBaseline)} ${esc(f.baseline)}</td>
          <td>${marca(f.aciertoVozaula)} ${esc(f.vozaulaSentimiento)}${f.dudoso ? '<br><small class="ayuda">→ revisión humana</small>' : ''}
            <div class="chips">${f.vozaulaAspectos.map((a) => `<span class="chip ${a.sentimiento}">${NOMBRES[a.aspecto]}</span>`).join('')}</div></td></tr>`
        )
        .join('')}</tbody></table>`;
  } catch (e) {
    $('#tablaComparacion').innerHTML = '';
    mostrarError(e.message);
  } finally {
    $('#btnComparar').disabled = false;
  }
});

// Estado inicial
fetch('/api/estado')
  .then((r) => r.json())
  .then((s) => {
    if (!s.hayApi) $('#demo').checked = true;
    if (!s.dataPrueba) $('#btnPrueba').title = 'Aún no existe data/comentarios_prueba.csv';
  })
  .catch(() => {});
fetch('/api/ultimo')
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    if (j) {
      datos = j;
      renderTodo();
    }
  })
  .catch(() => {});
