/* ============================================================
   reportes.js — Gráficos y KPIs por rango de fechas.
   Todos los cálculos salen de reports.js (agregaciones puras).
   ============================================================ */

import { initApp } from '../../js/app.js';
import { db } from '../../js/db.js';
import { msToISO, todayISO, formatCurrency } from '../../js/utils.js';
import {
    finalizadasEnRango,
    gastosEnRango,
    resumen,
    ingresosPorDia,
    gastosPorDia,
    gastosPorCategoria,
    ingresosPorMetodo,
    topProductos,
    sesionesPorHora,
    combinarIngresos,
    renderBarChart,
    renderDonut,
    renderHBars,
} from '../../js/reports.js';

/* ------------------------- Estado --------------------------- */
const state = {
    sesiones: [],
    gastos: [],
    desde: '',
    hasta: '',
};

/* ------------------- Arranque (al final del archivo) -------- */
await initApp({ page: 'reportes' });

const hoy = todayISO();
setRango('7d', { inicial: true });

document.getElementById('rangos-rapidos').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-rango]');
    if (!btn) return;
    setRango(btn.dataset.rango);
});
document.getElementById('rango-desde').addEventListener('change', (e) => {
    state.desde = e.target.value;
    markCustom();
    render();
});
document.getElementById('rango-hasta').addEventListener('change', (e) => {
    state.hasta = e.target.value;
    markCustom();
    render();
});

await reload();

/* ------------------------ Rangos ---------------------------- */
function setRango(rango, { inicial = false } = {}) {
    if (rango === 'hoy') {
        state.desde = hoy;
        state.hasta = hoy;
    } else if (rango === '7d') {
        const d = new Date();
        d.setDate(d.getDate() - 6);
        state.desde = msToISO(d.getTime());
        state.hasta = hoy;
    } else if (rango === 'mes') {
        state.desde = `${hoy.slice(0, 7)}-01`;
        state.hasta = hoy;
    } else {
        state.desde = '';
        state.hasta = '';
    }

    document.getElementById('rango-desde').value = state.desde;
    document.getElementById('rango-hasta').value = state.hasta;

    if (!inicial) {
        document.querySelectorAll('#rangos-rapidos [data-rango]').forEach((b) => {
            const activo = b.dataset.rango === rango;
            b.classList.toggle('active', activo);
            b.setAttribute('aria-pressed', activo ? 'true' : 'false');
        });
    }
    render();
}

function markCustom() {
    document.querySelectorAll('#rangos-rapidos [data-rango]').forEach((b) => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
    });
}

/* ------------------------ Carga/render ---------------------- */
async function reload() {
    // Sesiones de mesa + ventas directas pagadas (las anuladas no suman).
    state.sesiones = combinarIngresos(await db.sesiones.getAll(), await db.ventasDirectas.getAll());
    state.gastos = await db.gastos.getAll();
    render();
}

function render() {
    const fin = finalizadasEnRango(state.sesiones, state.desde, state.hasta);
    const gas = gastosEnRango(state.gastos, state.desde, state.hasta);
    const r = resumen(fin, gas);

    document.getElementById('stat-ingresos').textContent = formatCurrency(r.ingresos);
    document.getElementById('stat-gastos').textContent = formatCurrency(r.gastos);
    const utilidad = document.getElementById('stat-utilidad');
    utilidad.textContent = formatCurrency(r.utilidad);
    utilidad.style.color = r.utilidad < 0 ? 'var(--color-danger)' : '';
    document.getElementById('stat-sesiones').textContent = String(r.sesiones);

    const rangoTexto = state.desde || state.hasta
        ? `${state.desde || 'inicio'} → ${state.hasta || 'hoy'}`
        : 'historial completo';
    document.getElementById('reportes-subtitle').textContent =
        `${r.sesiones} cobro${r.sesiones === 1 ? '' : 's'} (mesas y ventas directas) · ${rangoTexto}`;

    // Ingresos por día
    const porDia = ingresosPorDia(state.sesiones, state.desde, state.hasta);
    renderBarChart(
        document.getElementById('chart-ingresos'),
        porDia.map((d) => ({ etiqueta: d.fecha.slice(5), valor: d.total })),
        { color: '#3ecf8e' }
    );

    // Métodos de pago (dona)
    renderDonut(
        document.getElementById('chart-metodos'),
        ingresosPorMetodo(fin).map((m) => ({ etiqueta: m.metodo, valor: m.total }))
    );

    // Gastos por categoría (dona)
    renderDonut(
        document.getElementById('chart-gastos-cat'),
        gastosPorCategoria(gas).map((g) => ({ etiqueta: g.categoria, valor: g.total }))
    );

    // Gastos por día
    renderBarChart(
        document.getElementById('chart-gastos-dia'),
        gastosPorDia(state.gastos, state.desde, state.hasta).map((d) => ({ etiqueta: d.fecha.slice(5), valor: d.total })),
        { color: '#ef5b8e' }
    );

    // Top productos
    renderHBars(
        document.getElementById('chart-top'),
        topProductos(fin).map((p) => ({
            etiqueta: p.nombre,
            valor: p.cantidad,
            extra: formatCurrency(p.total),
        })),
        { formatter: (v) => `${v} u.` }
    );

    // Sesiones por hora (etiquetas 00–23, valores son conteos)
    renderBarChart(
        document.getElementById('chart-horas'),
        sesionesPorHora(fin).map((h) => ({
            etiqueta: String(h.hora).padStart(2, '0'),
            valor: h.cantidad,
        })),
        { color: '#5b9dff', formatter: (v) => String(v) }
    );
}
