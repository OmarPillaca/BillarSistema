/* ============================================================
   reports.js — Agregaciones de datos y gráficos SVG hechos a
   mano (sin librerías). Solo consumen datos de db.js; el cálculo
   de dinero por tiempo siempre viene de billing.js vía sesiones
   ya cobradas (sesion.cobro).
   ============================================================ */

import { formatCurrency, msToISO, escapeHtml } from './utils.js';

/* ----------------- Ventas directas → "sesión" ---------------- */

/**
 * Convierte las ventas directas PAGADAS al mismo formato que una sesión
 * FINALIZADA, para que todas las agregaciones (ingresos, métodos de pago,
 * top productos, ventas por hora) las cuenten sin duplicar lógica.
 * Los ingresos van como "productos" (cargoMesa = 0). Las ANULADAS no suman.
 */
export function ventasDirectasComoSesiones(ventas) {
    return (ventas || [])
        .filter((v) => v && v.estado === 'PAGADA' && v.pago)
        .map((v) => {
            const pagadoEn = v.pago.pagadoEn ?? v.creadaEn;
            return {
                id: v.id,
                tipo: 'VENTA_DIRECTA',
                estado: 'FINALIZADA',
                mesaId: null,
                mesaNombre: 'Venta directa',
                inicio: v.creadaEn,
                fin: pagadoEn,
                consumos: (v.items || []).map((it) => ({
                    nombre: it.nombre,
                    cantidad: it.cantidad,
                    subtotal: it.subtotal,
                })),
                cobro: {
                    minutos: 0,
                    cargoMesa: 0,
                    totalProductos: v.total,
                    total: v.total,
                    metodoPago: v.pago.metodoPago,
                    fin: pagadoEn,
                    pagadoEn,
                },
            };
        });
}

/** Sesiones de mesa + ventas directas pagadas, listas para las agregaciones. */
export function combinarIngresos(sesiones, ventasDirectas) {
    return [...(sesiones || []), ...ventasDirectasComoSesiones(ventasDirectas)];
}

/* --------------------- Fechas/rangos ------------------------ */

/** Lista de fechas ISO (AAAA-MM-DD) entre dos fechas inclusive. */
export function eachDayISO(desdeISO, hastaISO) {
    const salida = [];
    const d = new Date(`${desdeISO}T12:00:00`);
    const fin = new Date(`${hastaISO}T12:00:00`);
    if (Number.isNaN(d.getTime()) || Number.isNaN(fin.getTime()) || fin < d) return salida;
    while (d.getTime() <= fin.getTime()) {
        salida.push(msToISO(d.getTime()));
        d.setDate(d.getDate() + 1);
        if (salida.length > 400) break;
    }
    return salida;
}

function inRange(iso, desdeISO, hastaISO) {
    if (desdeISO && iso < desdeISO) return false;
    if (hastaISO && iso > hastaISO) return false;
    return true;
}

const sessionISO = (s) => msToISO(s.fin || s.inicio);

/* --------------------- Filtrado base ------------------------ */

export function finalizadasEnRango(sesiones, desdeISO = '', hastaISO = '') {
    return (sesiones || []).filter(
        (s) => s.estado === 'FINALIZADA' && s.cobro && inRange(sessionISO(s), desdeISO, hastaISO)
    );
}

export function gastosEnRango(gastos, desdeISO = '', hastaISO = '') {
    return (gastos || []).filter((g) => inRange(g.fecha, desdeISO, hastaISO));
}

/* ---------------------- Agregaciones ------------------------ */

/** Resumen económico del período. */
export function resumen(finalizadas, gastos) {
    const ingresos = finalizadas.reduce((a, s) => a + s.cobro.total, 0);
    const ingresosTiempo = finalizadas.reduce((a, s) => a + s.cobro.cargoMesa, 0);
    const ingresosProductos = finalizadas.reduce((a, s) => a + s.cobro.totalProductos, 0);
    const totalGastos = (gastos || []).reduce((a, g) => a + g.monto, 0);
    return {
        ingresos: Math.round(ingresos * 100) / 100,
        ingresosTiempo: Math.round(ingresosTiempo * 100) / 100,
        ingresosProductos: Math.round(ingresosProductos * 100) / 100,
        gastos: Math.round(totalGastos * 100) / 100,
        utilidad: Math.round((ingresos - totalGastos) * 100) / 100,
        sesiones: finalizadas.length,
    };
}

/** Ingresos por día (todos los días del rango, aunque estén en 0). */
export function ingresosPorDia(sesiones, desdeISO, hastaISO) {
    const mapa = new Map();
    finalizadasEnRango(sesiones, desdeISO, hastaISO).forEach((s) => {
        const key = msToISO(s.cobro.fin ?? s.fin ?? s.inicio);
        const actual = mapa.get(key) || { total: 0, sesiones: 0 };
        actual.total += s.cobro.total;
        actual.sesiones += 1;
        mapa.set(key, actual);
    });
    return eachDayISO(desdeISO, hastaISO).map((fecha) => {
        const v = mapa.get(fecha) || { total: 0, sesiones: 0 };
        return { fecha, total: Math.round(v.total * 100) / 100, sesiones: v.sesiones };
    });
}

/** Gastos por día (todos los días del rango). */
export function gastosPorDia(gastos, desdeISO, hastaISO) {
    const mapa = new Map();
    gastosEnRango(gastos, desdeISO, hastaISO).forEach((g) => {
        mapa.set(g.fecha, (mapa.get(g.fecha) || 0) + g.monto);
    });
    return eachDayISO(desdeISO, hastaISO).map((fecha) => ({
        fecha,
        total: Math.round((mapa.get(fecha) || 0) * 100) / 100,
    }));
}

/** Gastos agrupados por categoría, de mayor a menor. */
export function gastosPorCategoria(gastos) {
    const mapa = new Map();
    (gastos || []).forEach((g) => mapa.set(g.categoria, (mapa.get(g.categoria) || 0) + g.monto));
    return [...mapa.entries()]
        .map(([categoria, total]) => ({ categoria, total: Math.round(total * 100) / 100 }))
        .sort((a, b) => b.total - a.total);
}

/** Ingresos agrupados por método de pago. */
export function ingresosPorMetodo(finalizadas) {
    const mapa = new Map();
    (finalizadas || []).forEach((s) => {
        const m = s.cobro.metodoPago || 'OTRO';
        mapa.set(m, (mapa.get(m) || 0) + s.cobro.total);
    });
    return [...mapa.entries()]
        .map(([metodo, total]) => ({ metodo, total: Math.round(total * 100) / 100 }))
        .sort((a, b) => b.total - a.total);
}

/** Productos más vendidos (por cantidad) de las sesiones del período. */
export function topProductos(finalizadas, limite = 6) {
    const mapa = new Map();
    (finalizadas || []).forEach((s) => {
        (s.consumos || []).forEach((c) => {
            const actual = mapa.get(c.nombre) || { nombre: c.nombre, cantidad: 0, total: 0 };
            actual.cantidad += c.cantidad;
            actual.total += c.subtotal;
            mapa.set(c.nombre, actual);
        });
    });
    return [...mapa.values()]
        .map((p) => ({ ...p, total: Math.round(p.total * 100) / 100 }))
        .sort((a, b) => b.cantidad - a.cantidad || b.total - a.total)
        .slice(0, limite);
}

/** Sesiones finalizadas por hora de inicio en Lima (0–23). */
const fmtHoraLima = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    hourCycle: 'h23',
});

export function sesionesPorHora(finalizadas) {
    const horas = Array.from({ length: 24 }, (_, hora) => ({ hora, cantidad: 0 }));
    (finalizadas || []).forEach((s) => {
        const h = Number(fmtHoraLima.format(new Date(s.inicio)));
        if (Number.isInteger(h) && h >= 0 && h < 24) horas[h].cantidad += 1;
    });
    return horas;
}

/* --------------------- Gráficos (SVG) ----------------------- */

const PALETA = ['#3ecf8e', '#5b9dff', '#f5a623', '#ef5b8e', '#9b6dff', '#4bc0c0', '#f7d154', '#ff7b72'];

function svgEl(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
    return el;
}

/**
 * Gráfico de barras verticales.
 * @param {HTMLElement} contenedor
 * @param {Array<{etiqueta:string, valor:number}>} puntos
 */
export function renderBarChart(contenedor, puntos, { formatter = formatCurrency, alto = 200, color = '#3ecf8e' } = {}) {
    contenedor.innerHTML = '';
    if (!puntos.length || puntos.every((p) => p.valor === 0)) {
        contenedor.innerHTML = '<p class="chart-vacio">Sin datos en este período.</p>';
        return;
    }

    const W = 640;
    const H = alto;
    const padTop = 26;
    const padBottom = 30;
    const padLeft = 8;
    const max = Math.max(...puntos.map((p) => p.valor), 0.01);
    const n = puntos.length;
    const gap = n > 40 ? 1 : n > 20 ? 3 : 6;
    const barW = Math.max(3, (W - padLeft * 2 - gap * (n - 1)) / n);
    const usableH = H - padTop - padBottom;

    const svg = svgEl('svg', {
        viewBox: `0 0 ${W} ${H}`,
        role: 'img',
        class: 'chart-svg',
        'aria-label': 'Gráfico de barras',
    });

    const everyN = Math.ceil(n / 12);

    puntos.forEach((p, i) => {
        const h = Math.max(p.valor > 0 ? 2 : 0, (p.valor / max) * usableH);
        const x = padLeft + i * (barW + gap);
        const y = padTop + usableH - h;
        const rect = svgEl('rect', {
            x: x.toFixed(1),
            y: y.toFixed(1),
            width: barW.toFixed(1),
            height: h.toFixed(1),
            rx: Math.min(3, barW / 2),
            fill: color,
        });
        const title = svgEl('title');
        title.textContent = `${p.etiqueta}: ${formatter(p.valor)}`;
        rect.appendChild(title);
        svg.appendChild(rect);

        if (p.valor > 0 && (n <= 14 || i % everyN === 0)) {
            const label = svgEl('text', {
                x: (x + barW / 2).toFixed(1),
                y: (y - 6).toFixed(1),
                'text-anchor': 'middle',
                class: 'chart-value',
            });
            label.textContent = formatter(p.valor);
            svg.appendChild(label);
        }

        if (i % everyN === 0) {
            const xl = svgEl('text', {
                x: (x + barW / 2).toFixed(1),
                y: H - 8,
                'text-anchor': 'middle',
                class: 'chart-label',
            });
            xl.textContent = p.etiqueta;
            svg.appendChild(xl);
        }
    });

    contenedor.appendChild(svg);
}

/**
 * Dona (pastel) con leyenda.
 * @param {HTMLElement} contenedor
 * @param {Array<{etiqueta:string, valor:number}>} segmentos
 */
export function renderDonut(contenedor, segmentos, { formatter = formatCurrency } = {}) {
    contenedor.innerHTML = '';
    const validos = segmentos.filter((s) => s.valor > 0);
    if (!validos.length) {
        contenedor.innerHTML = '<p class="chart-vacio">Sin datos en este período.</p>';
        return;
    }

    const total = validos.reduce((a, s) => a + s.valor, 0);
    const r = 54;
    const c = 2 * Math.PI * r;

    const wrap = document.createElement('div');
    wrap.className = 'donut';

    const svg = svgEl('svg', { viewBox: '0 0 140 140', class: 'donut__svg', role: 'img', 'aria-label': 'Gráfico de dona' });
    svg.appendChild(svgEl('circle', { cx: 70, cy: 70, r, fill: 'none', stroke: 'var(--color-surface-2)', 'stroke-width': 22 }));

    let offset = 0;
    validos.forEach((s, i) => {
        const frac = s.valor / total;
        const circle = svgEl('circle', {
            cx: 70,
            cy: 70,
            r,
            fill: 'none',
            stroke: PALETA[i % PALETA.length],
            'stroke-width': 22,
            'stroke-dasharray': `${(frac * c).toFixed(2)} ${(c - frac * c).toFixed(2)}`,
            'stroke-dashoffset': (-offset * c).toFixed(2),
            transform: 'rotate(-90 70 70)',
        });
        const title = svgEl('title');
        title.textContent = `${s.etiqueta}: ${formatter(s.valor)}`;
        circle.appendChild(title);
        svg.appendChild(circle);
        offset += frac;
    });

    const centro = svgEl('text', { x: 70, y: 66, 'text-anchor': 'middle', class: 'donut__center' });
    centro.textContent = 'Total';
    const centro2 = svgEl('text', { x: 70, y: 84, 'text-anchor': 'middle', class: 'donut__center donut__center--valor' });
    centro2.textContent = formatter(total);
    svg.append(centro, centro2);

    const leyenda = document.createElement('ul');
    leyenda.className = 'donut__leyenda';
    validos.forEach((s, i) => {
        const li = document.createElement('li');
        const pct = Math.round((s.valor / total) * 1000) / 10;
        li.innerHTML = `<span class="donut__punto" style="background:${PALETA[i % PALETA.length]}"></span>
            <span class="donut__nombre">${escapeHtml(s.etiqueta)}</span>
            <span class="donut__valor">${formatter(s.valor)} · ${pct}%</span>`;
        leyenda.appendChild(li);
    });

    wrap.append(svg, leyenda);
    contenedor.appendChild(wrap);
}

/**
 * Barras horizontales (top productos / ranking).
 * @param {HTMLElement} contenedor
 * @param {Array<{etiqueta:string, valor:number, extra?:string}>} items
 */
export function renderHBars(contenedor, items, { formatter = formatCurrency } = {}) {
    contenedor.innerHTML = '';
    const validos = items.filter((i) => i.valor > 0);
    if (!validos.length) {
        contenedor.innerHTML = '<p class="chart-vacio">Sin datos en este período.</p>';
        return;
    }
    const max = Math.max(...validos.map((i) => i.valor));

    const lista = document.createElement('ul');
    lista.className = 'hbars';
    validos.forEach((item, idx) => {
        const li = document.createElement('li');
        li.className = 'hbars__item';
        const pct = Math.max(3, Math.round((item.valor / max) * 100));
        li.innerHTML = `
            <span class="hbars__rank">${idx + 1}.</span>
            <span class="hbars__nombre">${escapeHtml(item.etiqueta)}</span>
            <span class="hbars__barra-wrap"><span class="hbars__barra" style="width:${pct}%"></span></span>
            <span class="hbars__valor">${formatter(item.valor)}${
                item.extra ? ` <small>${escapeHtml(item.extra)}</small>` : ''
            }</span>`;
        lista.appendChild(li);
    });
    contenedor.appendChild(lista);
}
