/* ============================================================
   venta-directa-ui.js — Ventana final de una venta directa
   (imprimir + enviar por WhatsApp). La usan la página de Venta
   Directa y el Historial para no duplicar código.
   ============================================================ */

import { openModal, notify, escapeHtml, formatCurrency, formatDateTime } from './utils.js';
import { db } from './db.js';
import { openComprobante } from './comprobante.js';
import {
    NOMBRE_SALON_POR_DEFECTO,
    etiquetaMetodo,
    soloDigitos,
    errorTelefono,
    buildMensajeWhatsApp,
    buildWhatsAppUrl,
} from './venta-directa.js';

async function obtenerNombreSalon() {
    try {
        const cfg = await db.config.get();
        return (cfg.nombreSalon || '').trim() || NOMBRE_SALON_POR_DEFECTO;
    } catch (e) {
        return NOMBRE_SALON_POR_DEFECTO;
    }
}

/** Abre un enlace en pestaña nueva sin depender de window.open (que puede bloquearse). */
function abrirEnlaceExterno(url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Muestra la ventana final de una venta ya guardada.
 * @param {object} venta venta directa
 * @param {{onNueva?:()=>void, titulo?:string}} [opciones] onNueva: callback de "Nueva venta".
 */
export async function abrirVentanaFinal(venta, { onNueva = null, titulo = 'Venta registrada' } = {}) {
    const nombreSalon = await obtenerNombreSalon();
    const telefonoGuardado = soloDigitos(venta.telefono);
    const tieneTelefono = !errorTelefono(telefonoGuardado) && telefonoGuardado !== '';
    const pago = venta.pago || {};
    const anulada = venta.estado === 'ANULADA';

    const content = `
        <div class="kv">
            <div class="kv__row"><span>Cliente</span><span>${escapeHtml(venta.cliente || 'Cliente general')}</span></div>
            <div class="kv__row"><span>Fecha</span><span>${formatDateTime(pago.pagadoEn ?? venta.creadaEn)}</span></div>
            <div class="kv__row"><span>Método de pago</span><span>${escapeHtml(etiquetaMetodo(pago.metodoPago))}</span></div>
            ${
                String(pago.metodoPago).toUpperCase() === 'EFECTIVO'
                    ? `<div class="kv__row"><span>Vuelto</span><span>${formatCurrency(pago.vuelto ?? 0)}</span></div>`
                    : ''
            }
            <div class="kv__row kv__row--total"><span>TOTAL</span><span>${formatCurrency(venta.total)}</span></div>
        </div>
        ${anulada ? '<p class="modal__text mt-3"><strong>Esta venta está ANULADA.</strong></p>' : ''}

        <div class="vd-final-acciones">
            <button type="button" class="btn btn--secondary" id="vd-btn-imprimir">🖨 Imprimir</button>
            <button type="button" class="btn btn--primary" id="vd-btn-whatsapp-abrir">💬 Enviar por WhatsApp</button>
        </div>

        <div class="vd-whatsapp hidden" id="vd-whatsapp-panel">
            <p class="form-hint" id="vd-whatsapp-info"></p>
            <div class="form-group" id="vd-whatsapp-grupo">
                <label class="form-label" for="vd-whatsapp-numero">Número de WhatsApp (9 dígitos)</label>
                <input class="form-input" id="vd-whatsapp-numero" type="tel" inputmode="numeric"
                       maxlength="9" autocomplete="off" placeholder="987654321">
                <span class="form-error" data-error-for="vd-whatsapp-numero" hidden></span>
            </div>
            <button type="button" class="btn btn--primary" id="vd-btn-whatsapp-enviar">Abrir WhatsApp</button>
            <p class="form-hint mt-2">Se abrirá WhatsApp con el mensaje ya escrito. Pulsa «Enviar» allí para mandarlo.</p>
        </div>`;

    const footer = onNueva
        ? `<button type="button" class="btn btn--secondary" data-close>Cerrar</button>
           <button type="button" class="btn btn--primary" id="vd-btn-nueva">＋ Nueva venta</button>`
        : '<button type="button" class="btn btn--secondary" data-close>Cerrar</button>';

    const modal = openModal({ title: titulo, content, footer, size: 'md' });
    const root = modal.root;

    const panel = root.querySelector('#vd-whatsapp-panel');
    const info = root.querySelector('#vd-whatsapp-info');
    const grupo = root.querySelector('#vd-whatsapp-grupo');
    const input = root.querySelector('#vd-whatsapp-numero');
    const error = root.querySelector('[data-error-for="vd-whatsapp-numero"]');

    function mostrarError(msg) {
        error.textContent = msg;
        error.hidden = !msg;
        input.toggleAttribute('aria-invalid', !!msg);
        grupo.classList.toggle('is-invalid', !!msg);
    }

    root.querySelector('[data-close]').addEventListener('click', () => modal.close());

    if (onNueva) {
        root.querySelector('#vd-btn-nueva').addEventListener('click', () => {
            modal.close();
            onNueva();
        });
    }

    root.querySelector('#vd-btn-imprimir').addEventListener('click', async () => {
        try {
            await openComprobante(venta);
        } catch (err) {
            notify(err.message, 'error');
        }
    });

    root.querySelector('#vd-btn-whatsapp-abrir').addEventListener('click', () => {
        panel.classList.remove('hidden');
        if (tieneTelefono) {
            // Número ya ingresado en la venta: se usa automáticamente (se puede cambiar).
            input.value = telefonoGuardado;
            info.textContent = `Se usará el número registrado: ${telefonoGuardado}. Puedes cambiarlo si hace falta.`;
        } else {
            info.textContent = 'La venta no tiene número registrado. Ingresa el WhatsApp del cliente.';
        }
        input.focus();
    });

    input.addEventListener('input', () => {
        const limpio = soloDigitos(input.value).slice(0, 9);
        if (input.value !== limpio) input.value = limpio;
        mostrarError('');
    });

    function enviar() {
        const numero = soloDigitos(input.value);
        const msg = errorTelefono(numero, { obligatorio: true });
        if (msg) {
            mostrarError(msg);
            input.focus();
            return;
        }
        try {
            const mensaje = buildMensajeWhatsApp(venta, nombreSalon);
            abrirEnlaceExterno(buildWhatsAppUrl(numero, mensaje));
            notify('Abriendo WhatsApp…', 'info');
        } catch (err) {
            notify(err.message, 'error');
        }
    }

    root.querySelector('#vd-btn-whatsapp-enviar').addEventListener('click', enviar);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            enviar();
        }
    });

    return modal;
}
