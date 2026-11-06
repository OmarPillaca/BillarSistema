/* ============================================================
   comprobante.js — Comprobante de pago imprimible.
   Compartido por la página de mesas (cobro) y el historial.
   La impresión usa .print-area + @media print de global.css.
   ============================================================ */

import { openModal, formatCurrency, formatDateTime, formatTime, formatDurationShort, escapeHtml } from './utils.js';
import { getChargeBreakdown } from './billing.js';
import { db } from './db.js';

/** ¿Es una venta directa (sin mesa)? Tiene ítems y pago, no consumos ni sesión. */
export function esVentaDirecta(obj) {
    return !!obj && Array.isArray(obj.items) && !!obj.pago && !Array.isArray(obj.consumos);
}

/** Etiqueta del método de pago para mostrar ("YAPE" → "Yape"). */
function etiquetaPago(metodo) {
    const mapa = { EFECTIVO: 'Efectivo', YAPE: 'Yape', PLIN: 'Plin', TARJETA: 'Tarjeta', OTRO: 'Otro' };
    return mapa[String(metodo || '').toUpperCase()] || String(metodo || '—');
}

/** Comprobante imprimible de una VENTA DIRECTA (sin tiempo ni cargo de mesa). */
function buildComprobanteVentaDirectaHtml(venta, { nombreSalon = 'Salón de Billar', pieComprobante = '' } = {}) {
    const pago = venta.pago || {};
    const fecha = pago.pagadoEn ?? venta.creadaEn;
    const metodo = String(pago.metodoPago || '').toUpperCase();

    const itemsHtml = (venta.items || [])
        .map(
            (it) =>
                `<div class="comprobante__row"><span>${it.cantidad} × ${escapeHtml(it.nombre)} (${formatCurrency(
                    it.precioUnitario
                )})</span><span>${formatCurrency(it.subtotal)}</span></div>`
        )
        .join('');

    const filasPago =
        metodo === 'EFECTIVO'
            ? `<div class="comprobante__row"><span>Recibido</span><span>${formatCurrency(
                  pago.montoRecibido ?? 0
              )}</span></div>
               <div class="comprobante__row"><span>Vuelto</span><span>${formatCurrency(pago.vuelto ?? 0)}</span></div>`
            : pago.detalleVuelto
              ? `<div class="comprobante__row"><span>Detalle</span><span>${escapeHtml(pago.detalleVuelto)}</span></div>`
              : '';

    return `
        <div class="comprobante print-area" id="comprobante">
            <div class="comprobante__head">${escapeHtml(nombreSalon)}<br><small>Comprobante de venta directa</small></div>
            <div class="comprobante__row"><span>Fecha</span><span>${formatDateTime(fecha)}</span></div>
            <div class="comprobante__row"><span>Cliente</span><span>${escapeHtml(venta.cliente || 'Cliente general')}</span></div>
            ${
                venta.mesaReferencia
                    ? `<div class="comprobante__row"><span>Mesa</span><span>${escapeHtml(venta.mesaReferencia)}</span></div>`
                    : ''
            }
            ${
                venta.estado === 'ANULADA'
                    ? '<div class="comprobante__row comprobante__row--strong"><span>ESTADO</span><span>ANULADA</span></div>'
                    : ''
            }
            <hr class="comprobante__sep">
            <div class="comprobante__row comprobante__row--strong"><span>Productos</span><span>${formatCurrency(
                venta.total ?? 0
            )}</span></div>
            ${itemsHtml}
            <div class="comprobante__row comprobante__row--strong"><span>TOTAL</span><span>${formatCurrency(
                venta.total ?? 0
            )}</span></div>
            <hr class="comprobante__sep">
            <div class="comprobante__row"><span>Método de pago</span><span>${escapeHtml(etiquetaPago(metodo))}</span></div>
            ${filasPago}
            <div class="comprobante__foot">${escapeHtml(pieComprobante || '¡Gracias por su visita!')}</div>
        </div>`;
}

/** Construye el HTML del comprobante: sesión FINALIZADA o venta directa. */
export function buildComprobanteHtml(sesion, { nombreSalon = 'Salón de Billar', pieComprobante = '' } = {}) {
    if (esVentaDirecta(sesion)) {
        return buildComprobanteVentaDirectaHtml(sesion, { nombreSalon, pieComprobante });
    }
    const cobro = sesion.cobro || {};

    let filasTiempo = '';
    try {
        const b = getChargeBreakdown(cobro.minutos ?? 0, sesion.tarifaHora);
        if (b.horasCompletas > 0) {
            filasTiempo += `<div class="comprobante__row"><span>${b.horasCompletas} hora${
                b.horasCompletas === 1 ? '' : 's'
            } (${formatCurrency(sesion.tarifaHora)}/h)</span><span>${formatCurrency(b.cargoHoras)}</span></div>`;
        }
        if (b.minutosRestantes > 0) {
            filasTiempo += `<div class="comprobante__row"><span>${b.minutosRestantes} min (adicional)</span><span>${formatCurrency(
                b.cargoMinutos
            )}</span></div>`;
        }
        if (b.horasCompletas === 0 && b.minutosRestantes === 0) {
            filasTiempo = `<div class="comprobante__row"><span>Primeros 9 min</span><span>${formatCurrency(0)}</span></div>`;
        }
    } catch (e) {
        filasTiempo = `<div class="comprobante__row"><span>Cargo por tiempo</span><span>${formatCurrency(
            cobro.cargoMesa ?? 0
        )}</span></div>`;
    }

    const productosHtml = (sesion.consumos || [])
        .map(
            (c) =>
                `<div class="comprobante__row"><span>${c.cantidad} × ${escapeHtml(c.nombre)}</span><span>${formatCurrency(
                    c.subtotal
                )}</span></div>`
        )
        .join('');

    const personas = (sesion.personas || []).map((p) => escapeHtml(p.nombre)).join(', ') || '—';
    const fin = cobro.fin ?? sesion.fin ?? sesion.inicio;

    return `
        <div class="comprobante print-area" id="comprobante">
            <div class="comprobante__head">${escapeHtml(nombreSalon)}<br><small>Comprobante de consumo</small></div>
            <div class="comprobante__row"><span>Fecha</span><span>${formatDateTime(fin)}</span></div>
            <div class="comprobante__row"><span>Mesa</span><span>${escapeHtml(sesion.mesaNombre || '—')}</span></div>
            <div class="comprobante__row"><span>Inicio</span><span>${formatTime(sesion.inicio)}</span></div>
            <div class="comprobante__row"><span>Fin</span><span>${formatTime(fin)}</span></div>
            <div class="comprobante__row"><span>Duración</span><span>${formatDurationShort(cobro.minutos ?? 0)}</span></div>
            <div class="comprobante__row"><span>Personas</span><span>${personas}</span></div>
            <hr class="comprobante__sep">
            <div class="comprobante__row comprobante__row--strong"><span>Cargo de mesa</span><span>${formatCurrency(
                cobro.cargoMesa ?? 0
            )}</span></div>
            ${filasTiempo}
            <hr class="comprobante__sep">
            <div class="comprobante__row comprobante__row--strong"><span>Productos</span><span>${formatCurrency(
                cobro.totalProductos ?? 0
            )}</span></div>
            ${productosHtml}
            <div class="comprobante__row comprobante__row--strong"><span>TOTAL</span><span>${formatCurrency(
                cobro.total ?? 0
            )}</span></div>
            <hr class="comprobante__sep">
            <div class="comprobante__row"><span>Método de pago</span><span>${escapeHtml(cobro.metodoPago || '—')}</span></div>
            <div class="comprobante__row"><span>Recibido</span><span>${formatCurrency(cobro.montoRecibido ?? 0)}</span></div>
            <div class="comprobante__row"><span>Vuelto</span><span>${formatCurrency(cobro.vuelto ?? 0)}</span></div>
            <div class="comprobante__foot">${escapeHtml(pieComprobante || '¡Gracias por su visita!')}</div>
        </div>`;
}

/**
 * Abre el comprobante en un modal con botón Imprimir.
 * @param {object} sesion sesión FINALIZADA con cobro
 */
export async function openComprobante(sesion) {
    const directa = esVentaDirecta(sesion);
    if (!sesion || (!directa && (sesion.estado !== 'FINALIZADA' || !sesion.cobro))) {
        return null;
    }

    let cfg = {};
    try {
        cfg = await db.config.get();
    } catch (e) {
        cfg = {};
    }

    const content = buildComprobanteHtml(sesion, {
        nombreSalon: cfg.nombreSalon || 'Salón de Billar',
        pieComprobante: cfg.pieComprobante || '',
    });

    const footer = `
        <button type="button" class="btn btn--secondary no-print" data-close>Cerrar</button>
        <button type="button" class="btn btn--primary no-print" id="btn-imprimir">🖨 Imprimir</button>`;

    const modal = openModal({ title: 'Comprobante de pago', content, footer, size: 'sm' });
    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.root.querySelector('#btn-imprimir').addEventListener('click', () => window.print());
    return modal;
}
