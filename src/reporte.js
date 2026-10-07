import { ASPECTOS, NOMBRES_ASPECTOS } from './aspectos.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(1));

/** Reporte HTML autocontenido para un docente. */
export function generarReporteHTML(docente, info, comentarios, recomendaciones, posicion, totalDocentes) {
  const propios = comentarios.filter((c) => c.docente === docente);
  const dudosos = propios.filter((c) => c.dudoso);
  const filas = Object.keys(ASPECTOS)
    .map((a) => {
      const v = info.aspectos[a] || {};
      const ancho = Math.max(0, Math.min(100, v.score ?? 0));
      return `<tr><td>${NOMBRES_ASPECTOS[a]} <small>(peso ${Math.round(ASPECTOS[a] * 100)}%)</small></td>
        <td><div class="barra"><span style="width:${ancho}%"></span></div></td>
        <td class="n">${num(v.score)}</td><td class="n">${v.n ?? 0}</td><td class="n">${typeof v.confianza === "number" ? Math.round(v.confianza * 100) + "%" : esc(v.confianza ?? "—")}</td></tr>`;
    })
    .join('');
  const lista = (tipo) =>
    recomendaciones
      .filter((r) => r.tipo === tipo)
      .map((r) => `<li><b>${NOMBRES_ASPECTOS[r.aspecto] ?? esc(r.aspecto)}:</b> ${esc(r.texto)}</li>`)
      .join('') || '<li>Sin datos suficientes.</li>';
  const dud = dudosos.map((c) => `<li>"${esc(c.comentario)}" <small>— ${esc(c.banderas.join(', '))}: ${esc(c.motivo)}</small></li>`).join('') || '<li>Ninguno.</li>';

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>VozAula – ${esc(docente)}</title>
<style>
body{font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#1f2933;line-height:1.5}
h1{margin:0}.sub{color:#52606d}.score{font-size:64px;font-weight:700;color:#1d4e89;margin:8px 0}
table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:8px;border-bottom:1px solid #e4e7eb;text-align:left}.n{text-align:right;width:80px}
.barra{background:#e4e7eb;height:14px;border-radius:7px;overflow:hidden}.barra span{display:block;height:100%;background:#1d4e89}
h2{border-left:5px solid #1d4e89;padding-left:10px;margin-top:32px}.ok h2{border-color:#2f855a}.mal h2{border-color:#c05621}
small{color:#7b8794}li{margin:6px 0}footer{margin-top:40px;color:#7b8794;font-size:13px}
</style></head><body>
<h1>${esc(docente)}</h1>
<div class="sub">Reporte de evaluación docente · VozAula · ${new Date().toLocaleDateString('es-CO')}</div>
<div class="score">${num(info.scoreGeneral)}<small style="font-size:24px"> / 100</small></div>
<div class="sub">Puesto ${posicion} de ${totalDocentes} · ${info.totalComentarios} comentarios · ${info.dudosos} en revisión humana</div>
<h2>Puntaje por aspecto</h2>
<table><tr><th>Aspecto</th><th></th><th class="n">Puntaje</th><th class="n">n</th><th class="n">Confianza</th></tr>${filas}</table>
<p><small>Puntaje bayesiano 0–100: cada aspecto se ajusta hacia el promedio institucional cuando hay pocos comentarios, para que sea comparable entre docentes.</small></p>
<div class="ok"><h2>Fortalezas a reconocer</h2><ul>${lista('reconocer')}</ul></div>
<div class="mal"><h2>A mejorar</h2><ul>${lista('mejorar')}</ul></div>
<h2>Comentarios en revisión humana (${dudosos.length})</h2><ul>${dud}</ul>
<footer>Generado por VozAula. Los comentarios dudosos (sarcasmo incierto, ambiguos o fuera de tema) no se incluyen en el puntaje hasta que una persona los revise.</footer>
</body></html>`;
}
