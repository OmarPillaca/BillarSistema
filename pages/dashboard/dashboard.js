/* ============================================================
   dashboard.js — Resumen: KPIs de hoy/mes, estado de mesas,
   últimos cobros y mini gráfico de 7 días.
   ============================================================ */

import { initApp } from '../../js/app.js';
import { db } from '../../js/db.js';
import { formatCurrency, formatDateTime, msToISO, todayISO, escapeHtml, sortBy } from '../../js/utils.js';
import { ingresosPorDia, renderBarChart, combinarIngresos } from '../../js/reports.js';

/* ------------------- Arranque (al final del archivo) -------- */
await initApp({ page: 'dashboard' });
await render();

async function render() {
    const [sesionesMesa, ventasDirectas, gastos, mesas, productos] = await Promise.all([
        db.sesiones.getAll(),
        db.ventasDirectas.getAll(),
        db.gastos.getAll(),
        db.mesas.getAll(),
        db.productos.getAll(),
    ]);
    // Las ventas directas pagadas se cuentan como cobros (las anuladas no suman).
    const sesiones = combinarIngresos(sesionesMesa, ventasDirectas);

    const hoy = todayISO();
    const mesActual = hoy.slice(0, 7);
    const mesDesde = `${mesActual}-01`;
    const finDeMes = ultimoDiaDelMes(hoy);

    const cobradasHoy = sesiones.filter(
        (s) => s.estado === 'FINALIZADA' && s.cobro && msToISO(s.cobro.fin ?? s.fin) === hoy
    );
    const cobradasMes = sesiones.filter(
        (s) => s.estado === 'FINALIZADA' && s.cobro && msToISO(s.cobro.fin ?? s.fin) >= mesDesde && msToISO(s.cobro.fin ?? s.fin) <= finDeMes
    );

    const ingresosHoy = cobradasHoy.reduce((a, s) => a + s.cobro.total, 0);
    const ingresosMes = cobradasMes.reduce((a, s) => a + s.cobro.total, 0);
    const gastosMes = gastos
        .filter((g) => g.fecha >= mesDesde && g.fecha <= finDeMes)
        .reduce((a, g) => a + g.monto, 0);
    const utilidad = ingresosMes - gastosMes;

    document.getElementById('stat-hoy').textContent = formatCurrency(ingresosHoy);
    document.getElementById('stat-mes').textContent = formatCurrency(ingresosMes);
    document.getElementById('stat-gastos').textContent = formatCurrency(gastosMes);
    const util = document.getElementById('stat-utilidad');
    util.textContent = formatCurrency(utilidad);
    util.style.color = utilidad < 0 ? 'var(--color-danger)' : '';

    document.getElementById('dash-disponibles').textContent = String(mesas.filter((m) => m.estado === 'DISPONIBLE').length);
    document.getElementById('dash-uso').textContent = String(mesas.filter((m) => m.estado === 'EN_USO').length);
    document.getElementById('dash-activas').textContent = String(sesionesMesa.filter((s) => s.estado === 'ACTIVA').length);
    document.getElementById('dash-cobradas').textContent = String(cobradasMes.length);
    document.getElementById('dash-productos').textContent = String(productos.filter((p) => p.estado === 'ACTIVO').length);

    document.getElementById('dash-subtitle').textContent =
        `${mesas.length} mesa${mesas.length === 1 ? '' : 's'} · ${cobradasMes.length} cobro${
            cobradasMes.length === 1 ? '' : 's'
        } este mes · ${formatDateTime(Date.now())}`;

    // Mini gráfico de 7 días
    const d = new Date();
    d.setDate(d.getDate() - 6);
    const desde7 = msToISO(d.getTime());
    renderBarChart(
        document.getElementById('chart-semana'),
        ingresosPorDia(sesiones, desde7, hoy).map((x) => ({ etiqueta: x.fecha.slice(5), valor: x.total })),
        { color: '#3ecf8e', alto: 180 }
    );

    // Últimas sesiones (por fin, descendente)
    const ultimas = sortBy(
        sesiones.filter((s) => s.estado !== 'ACTIVA'),
        (s) => s.fin || s.inicio,
        'desc'
    ).slice(0, 5);

    const lista = document.getElementById('ultimas-sesiones');
    lista.innerHTML = '';
    if (ultimas.length === 0) {
        lista.innerHTML = '<li><span class="dash-ultimas__fecha">Todavía no hay sesiones cerradas.</span></li>';
    } else {
        ultimas.forEach((s) => {
            const li = document.createElement('li');
            const cancelada = s.estado === 'CANCELADA';
            li.innerHTML = `
                <span class="dash-ultimas__info">
                    <span class="dash-ultimas__mesa">${escapeHtml(s.mesaNombre || 'Mesa')}</span>
                    <span class="dash-ultimas__fecha">${formatDateTime(s.fin || s.inicio)} · ${
                        cancelada ? 'CANCELADA' : 'FINALIZADA'
                    }</span>
                </span>
                <span class="dash-ultimas__total ${cancelada ? 'estado-cancelada' : ''}">${
                    cancelada ? '—' : formatCurrency(s.cobro.total)
                }</span>`;
            lista.appendChild(li);
        });
    }
}

function ultimoDiaDelMes(iso) {
    const [y, m] = iso.split('-').map(Number);
    const ultimo = new Date(Date.UTC(y, m, 0));
    return ultimo.toISOString().slice(0, 10);
}
