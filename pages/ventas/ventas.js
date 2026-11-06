/* ============================================================
   ventas.js — Historial de sesiones: filtros por fecha, estado,
   método de pago y mesa; KPIs; comprobante y detalle.
   ============================================================ */

import { initApp } from '../../js/app.js';
import { db } from '../../js/db.js';
import {
    formatCurrency,
    formatDateTime,
    formatDurationShort,
    msToISO,
    elapsedSeconds,
    openModal,
    notify,
    escapeHtml,
    sortBy,
} from '../../js/utils.js';
import { openComprobante } from '../../js/comprobante.js';
import { abrirVentanaFinal } from '../../js/venta-directa-ui.js';
import { etiquetaMetodo } from '../../js/venta-directa.js';

/* ------------------------- Estado --------------------------- */
const state = {
    sesiones: [], // sesiones de mesa + ventas directas adaptadas (ver adaptarVentaDirecta)
    mesas: [],
    filtros: { desde: '', hasta: '', tipo: '', estado: '', metodo: '', mesa: '' },
};

/**
 * Presenta una venta directa con la forma de una sesión para reutilizar filtros,
 * tabla y KPIs. PAGADA → FINALIZADA, ANULADA → CANCELADA (se rotula "ANULADA").
 * La venta original viaja en `venta` para comprobante, WhatsApp y anulación.
 */
function adaptarVentaDirecta(v) {
    const pagada = v.estado === 'PAGADA';
    const pagadoEn = v.pago?.pagadoEn ?? v.creadaEn;
    return {
        id: v.id,
        tipo: 'VENTA_DIRECTA',
        venta: v,
        mesaId: null,
        mesaNombre: 'Venta directa',
        inicio: v.creadaEn,
        fin: pagada ? pagadoEn : v.anuladaEn ?? v.creadaEn,
        estado: pagada ? 'FINALIZADA' : 'CANCELADA',
        personas: [],
        consumos: [],
        cobro: pagada
            ? {
                  minutos: 0,
                  cargoMesa: 0,
                  totalProductos: v.total,
                  total: v.total,
                  metodoPago: v.pago.metodoPago,
                  fin: pagadoEn,
              }
            : null,
    };
}

const esDirecta = (s) => s.tipo === 'VENTA_DIRECTA';

/* ------------------- Arranque (al final del archivo) -------- */
await initApp({ page: 'ventas' });
await reload();

document.getElementById('filtro-desde').addEventListener('change', (e) => {
    state.filtros.desde = e.target.value;
    render();
});
document.getElementById('filtro-hasta').addEventListener('change', (e) => {
    state.filtros.hasta = e.target.value;
    render();
});
document.getElementById('filtro-tipo').addEventListener('change', (e) => {
    state.filtros.tipo = e.target.value;
    render();
});
document.getElementById('filtro-estado').addEventListener('change', (e) => {
    state.filtros.estado = e.target.value;
    render();
});
document.getElementById('filtro-metodo').addEventListener('change', (e) => {
    state.filtros.metodo = e.target.value;
    render();
});
document.getElementById('filtro-mesa').addEventListener('change', (e) => {
    state.filtros.mesa = e.target.value;
    render();
});
document.getElementById('ventas-tbody').addEventListener('click', onTableClick);

/* ------------------------ Carga/render ---------------------- */
async function reload() {
    const [sesionesMesa, ventasDirectas] = await Promise.all([db.sesiones.getAll(), db.ventasDirectas.getAll()]);
    state.sesiones = [...sesionesMesa, ...ventasDirectas.map(adaptarVentaDirecta)];
    state.mesas = sortBy(await db.mesas.getAll({ incluirEliminadas: true }), (m) => m.nombre);
    renderFiltroMesas();
    render();
}

function renderFiltroMesas() {
    const select = document.getElementById('filtro-mesa');
    const actual = state.filtros.mesa;
    select.innerHTML = '<option value="">Todas</option>';
    state.mesas.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.nombre;
        if (m.id === actual) opt.selected = true;
        select.appendChild(opt);
    });
    if (actual && !state.mesas.some((m) => m.id === actual)) {
        state.filtros.mesa = '';
        select.value = '';
    }
}

function filteredSessions() {
    let list = [...state.sesiones];
    const f = state.filtros;

    if (f.tipo === 'MESA') list = list.filter((s) => !esDirecta(s));
    if (f.tipo === 'DIRECTA') list = list.filter((s) => esDirecta(s));
    if (f.estado) list = list.filter((s) => s.estado === f.estado);
    if (f.mesa) list = list.filter((s) => s.mesaId === f.mesa);
    if (f.metodo) list = list.filter((s) => s.cobro && s.cobro.metodoPago === f.metodo);
    if (f.desde) list = list.filter((s) => msToISO(sessionEnd(s)) >= f.desde);
    if (f.hasta) list = list.filter((s) => msToISO(sessionEnd(s)) <= f.hasta);

    return list.sort((a, b) => sessionEnd(b) - sessionEnd(a));
}

function sessionEnd(s) {
    if (s.estado === 'ACTIVA') return Date.now();
    return s.fin || s.inicio || 0;
}

function render() {
    const lista = filteredSessions();
    const tbody = document.getElementById('ventas-tbody');
    const wrap = document.getElementById('ventas-table-wrap');
    const vacio = document.getElementById('ventas-vacio');
    tbody.innerHTML = '';

    const hayFiltro = Object.values(state.filtros).some(Boolean);

    if (lista.length === 0) {
        wrap.classList.add('hidden');
        vacio.classList.remove('hidden');
        if (state.sesiones.length === 0) {
            document.getElementById('ventas-vacio-titulo').textContent = 'Sin sesiones todavía';
            document.getElementById('ventas-vacio-texto').textContent =
                'Cuando finalices o canceles sesiones aparecerán aquí.';
        } else {
            document.getElementById('ventas-vacio-titulo').textContent = 'Sin resultados';
            document.getElementById('ventas-vacio-texto').textContent = hayFiltro
                ? 'Ninguna sesión coincide con los filtros aplicados.'
                : 'No hay sesiones que mostrar.';
        }
    } else {
        wrap.classList.remove('hidden');
        vacio.classList.add('hidden');
        lista.forEach((s) => tbody.appendChild(buildRow(s)));
    }

    renderStats(lista);
    renderSubtitle(lista);
}

function buildRow(s) {
    const tr = document.createElement('tr');
    const cobro = s.cobro;
    const fin = sessionEnd(s);

    const directa = esDirecta(s);
    const duracion = directa
        ? '—'
        : s.estado === 'FINALIZADA'
            ? formatDurationShort(cobro.minutos)
            : s.estado === 'CANCELADA'
              ? formatDurationShort(Math.floor((s.fin - s.inicio) / 60000))
              : formatDurationShort(Math.floor(elapsedSeconds(s.inicio) / 60));

    const badgeEstado =
        s.estado === 'FINALIZADA'
            ? `<span class="badge badge--success">${directa ? 'PAGADA' : 'FINALIZADA'}</span>`
            : s.estado === 'CANCELADA'
              ? `<span class="badge badge--gray">${directa ? 'ANULADA' : 'CANCELADA'}</span>`
              : '<span class="badge badge--danger badge--pulse">EN CURSO</span>';

    const acciones = directa
        ? s.estado === 'FINALIZADA'
            ? `<button type="button" class="btn btn--sm btn--secondary" data-vd-comprobante="${s.id}">Comprobante / WhatsApp</button>
               <button type="button" class="btn btn--sm btn--danger" data-vd-anular="${s.id}">Anular</button>`
            : `<button type="button" class="btn btn--sm btn--secondary" data-vd-detalle="${s.id}">Detalle</button>`
        : s.estado === 'FINALIZADA'
          ? `<button type="button" class="btn btn--sm btn--secondary" data-ver-comprobante="${s.id}">Comprobante</button>`
          : `<button type="button" class="btn btn--sm btn--secondary" data-ver-detalle="${s.id}">Detalle</button>`;

    const celdaMesa = directa
        ? `<strong>Venta directa</strong><br><small>${escapeHtml(s.venta.cliente || 'Cliente general')}${
              s.venta.mesaReferencia ? ` · ${escapeHtml(s.venta.mesaReferencia)}` : ''
          }</small>`
        : `<strong>${escapeHtml(s.mesaNombre || '—')}</strong>`;

    tr.innerHTML = `
        <td data-label="Fecha">${formatDateTime(fin)}</td>
        <td data-label="Mesa">${celdaMesa}</td>
        <td class="num" data-label="Duración">${duracion}</td>
        <td class="num" data-label="Tiempo">${cobro ? formatCurrency(cobro.cargoMesa) : '—'}</td>
        <td class="num" data-label="Productos">${cobro ? formatCurrency(cobro.totalProductos) : '—'}</td>
        <td class="num" data-label="Total"><strong>${
            cobro ? formatCurrency(cobro.total) : '—'
        }</strong></td>
        <td data-label="Estado">${badgeEstado}</td>
        <td data-label="Pago">${
            cobro ? `<span class="badge badge--pago">${escapeHtml(directa ? etiquetaMetodo(cobro.metodoPago).toUpperCase() : cobro.metodoPago)}</span>` : '—'
        }</td>
        <td class="actions-cell" data-label="Acciones"><div class="ventas-acciones">${acciones}</div></td>`;
    return tr;
}

function renderStats(lista) {
    const finalizadas = lista.filter((s) => s.estado === 'FINALIZADA' && s.cobro);
    const cobrado = finalizadas.reduce((a, s) => a + s.cobro.total, 0);
    const tiempo = finalizadas.reduce((a, s) => a + s.cobro.cargoMesa, 0);
    const productos = finalizadas.reduce((a, s) => a + s.cobro.totalProductos, 0);
    const canceladas = lista.filter((s) => s.estado === 'CANCELADA').length;

    document.getElementById('stat-cobrado').textContent = formatCurrency(cobrado);
    document.getElementById('stat-tiempo').textContent = formatCurrency(tiempo);
    document.getElementById('stat-productos').textContent = formatCurrency(productos);
    document.getElementById('stat-canceladas').textContent = String(canceladas);
}

function renderSubtitle(lista) {
    const total = state.sesiones.length;
    if (total === 0) {
        document.getElementById('ventas-subtitle').textContent = 'Aún no hay sesiones ni ventas registradas';
        return;
    }
    const fin = lista.filter((s) => s.estado === 'FINALIZADA').length;
    const can = lista.filter((s) => s.estado === 'CANCELADA').length;
    const act = lista.filter((s) => s.estado === 'ACTIVA').length;
    const parte = `${lista.length} en la vista · ${fin} finalizada${fin === 1 ? '' : 's'} · ${can} cancelada${
        can === 1 ? '' : 's'
    }${act ? ` · ${act} en curso` : ''}`;
    document.getElementById('ventas-subtitle').textContent = `${total} ${
        total === 1 ? 'sesión' : 'sesiones'
    } · ${parte}`;
}

/* ------------------------ Acciones -------------------------- */
async function onTableClick(e) {
    const btn = e.target.closest(
        '[data-ver-comprobante], [data-ver-detalle], [data-vd-comprobante], [data-vd-anular], [data-vd-detalle]'
    );
    if (!btn) return;

    // ----- Ventas directas -----
    const idDirecta = btn.dataset.vdComprobante || btn.dataset.vdAnular || btn.dataset.vdDetalle;
    if (idDirecta) {
        const item = state.sesiones.find((x) => x.id === idDirecta);
        if (!item || !item.venta) return;
        if (btn.dataset.vdComprobante) {
            await abrirVentanaFinal(item.venta, { titulo: 'Venta directa' });
        } else if (btn.dataset.vdAnular) {
            anularVentaDirecta(item.venta);
        } else {
            openDetalleVentaDirecta(item.venta);
        }
        return;
    }

    if (btn.dataset.verComprobante) {
        const sesion = state.sesiones.find((s) => s.id === btn.dataset.verComprobante);
        if (!sesion) return;
        try {
            await openComprobante(sesion);
        } catch (err) {
            notify(err.message, 'error');
        }
        return;
    }

    const sesion = state.sesiones.find((s) => s.id === btn.dataset.verDetalle);
    if (sesion) openDetalle(sesion);
}

function openDetalle(sesion) {
    const cancelada = sesion.estado === 'CANCELADA';
    const personas = sesion.personas.map((p) => escapeHtml(p.nombre)).join(', ') || '—';
    const consumos = sesion.consumos.length
        ? sesion.consumos
              .map(
                  (c) =>
                      `<div class="comprobante__row"><span>${c.cantidad} × ${escapeHtml(c.nombre)}</span><span>${formatCurrency(
                          c.subtotal
                      )}</span></div>`
              )
              .join('')
        : '<p class="form-hint">Sin productos.</p>';

    const content = `
        <div class="kv">
            <div class="kv__row"><span>Mesa</span><span>${escapeHtml(sesion.mesaNombre || '—')}</span></div>
            <div class="kv__row"><span>Inicio</span><span>${formatDateTime(sesion.inicio)}</span></div>
            <div class="kv__row"><span>Fin</span><span>${sesion.fin ? formatDateTime(sesion.fin) : '—'}</span></div>
            <div class="kv__row"><span>Tarifa</span><span>${formatCurrency(sesion.tarifaHora)}/h</span></div>
            <div class="kv__row"><span>Personas</span><span>${personas}</span></div>
        </div>
        <hr class="cuenta-sep">
        <div class="comprobante__row comprobante__row--strong"><span>Productos</span><span>${formatCurrency(
            sesion.consumos.reduce((a, c) => a + c.subtotal, 0)
        )}</span></div>
        ${consumos}
        ${
            cancelada
                ? `<hr class="cuenta-sep">
                   <p class="modal__text">Sesión <strong>CANCELADA</strong>${
                       sesion.motivoCancelacion ? ` — Motivo: ${escapeHtml(sesion.motivoCancelacion)}` : ''
                   }. Sin cobro; el stock de sus consumos fue devuelto.</p>`
                : '<p class="form-hint mt-3">Sesión aún en curso. Cómprala desde la página de Mesas.</p>'
        }`;

    const modal = openModal({
        title: cancelada ? 'Detalle de sesión cancelada' : 'Detalle de sesión',
        content,
        size: 'md',
        footer: '<button type="button" class="btn btn--secondary" data-close>Cerrar</button>',
    });
    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
}

/* ------------------ Ventas directas: anular y detalle ------------------ */
function anularVentaDirecta(venta) {
    const content = `
        <p class="modal__text">Se anulará la venta de <strong>${escapeHtml(venta.cliente || 'Cliente general')}</strong>
        por <strong>${formatCurrency(venta.total)}</strong>. El stock de sus productos se devolverá y dejará de sumar a los ingresos.</p>
        <div class="form-group mt-3">
            <label class="form-label" for="vd-motivo">Motivo <small>(opcional)</small></label>
            <input class="form-input" id="vd-motivo" type="text" maxlength="120" autocomplete="off" placeholder="Ej.: error al cobrar">
        </div>`;
    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Volver</button>
        <button type="button" class="btn btn--danger" id="vd-confirmar-anular">Anular venta</button>`;

    const modal = openModal({ title: 'Anular venta directa', content, footer, size: 'sm' });
    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());

    const btn = modal.root.querySelector('#vd-confirmar-anular');
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
            await db.ventasDirectas.anular(venta.id, modal.root.querySelector('#vd-motivo').value);
            modal.close();
            notify('Venta anulada. El stock fue devuelto.', 'success');
            await reload();
        } catch (err) {
            btn.disabled = false;
            notify(err.message, 'error');
        }
    });
}

function openDetalleVentaDirecta(venta) {
    const items = (venta.items || [])
        .map(
            (it) =>
                `<div class="comprobante__row"><span>${it.cantidad} × ${escapeHtml(it.nombre)}</span><span>${formatCurrency(
                    it.subtotal
                )}</span></div>`
        )
        .join('');

    const content = `
        <div class="kv">
            <div class="kv__row"><span>Cliente</span><span>${escapeHtml(venta.cliente || 'Cliente general')}</span></div>
            <div class="kv__row"><span>Fecha</span><span>${formatDateTime(venta.creadaEn)}</span></div>
            ${venta.mesaReferencia ? `<div class="kv__row"><span>Mesa</span><span>${escapeHtml(venta.mesaReferencia)}</span></div>` : ''}
            <div class="kv__row"><span>Total</span><span>${formatCurrency(venta.total)}</span></div>
        </div>
        <hr class="cuenta-sep">
        ${items}
        <hr class="cuenta-sep">
        <p class="modal__text">Venta <strong>ANULADA</strong>${
            venta.motivoAnulacion ? ` — Motivo: ${escapeHtml(venta.motivoAnulacion)}` : ''
        }. El stock de sus productos fue devuelto.</p>`;

    const modal = openModal({
        title: 'Detalle de venta anulada',
        content,
        size: 'md',
        footer: '<button type="button" class="btn btn--secondary" data-close>Cerrar</button>',
    });
    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
}
