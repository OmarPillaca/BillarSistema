/* ============================================================
   venta-directa.js — Funciones PURAS de la Venta Directa.
   Sin DOM ni localStorage: validación de teléfono, armado del
   mensaje de WhatsApp y del enlace wa.me. Se prueban en
   tests/pruebas-venta-directa.html.
   ============================================================ */

import { round2, formatDate } from './utils.js';

export const NOMBRE_SALON_POR_DEFECTO = 'Billar Punto 8';
export const PREFIJO_PAIS = '51';

export const METODOS_PAGO_LISTA = [
    { valor: 'EFECTIVO', etiqueta: 'Efectivo' },
    { valor: 'YAPE', etiqueta: 'Yape' },
    { valor: 'PLIN', etiqueta: 'Plin' },
    { valor: 'TARJETA', etiqueta: 'Tarjeta' },
    { valor: 'OTRO', etiqueta: 'Otro' },
];

/** Etiqueta legible de un método de pago ("YAPE" → "Yape"). */
export function etiquetaMetodo(metodo) {
    const m = METODOS_PAGO_LISTA.find((x) => x.valor === String(metodo || '').toUpperCase());
    return m ? m.etiqueta : String(metodo || '—');
}

/* --------------------------- Teléfono --------------------------- */

/** Deja solo dígitos. */
export const soloDigitos = (valor) => String(valor ?? '').replace(/\D+/g, '');

/** Celular peruano: exactamente 9 dígitos y empieza con 9. */
export const esTelefonoValido = (valor) => /^9\d{8}$/.test(String(valor ?? ''));

/** Mensaje de error de teléfono ('' si es válido o está vacío y es opcional). */
export function errorTelefono(valor, { obligatorio = false } = {}) {
    const t = String(valor ?? '').trim();
    if (!t) return obligatorio ? 'Ingresa el número de WhatsApp.' : '';
    if (/\D/.test(t)) return 'Usa solo números, sin espacios ni símbolos.';
    if (t.length !== 9) return 'El número debe tener 9 dígitos.';
    if (!t.startsWith('9')) return 'Un celular peruano empieza con 9.';
    return '';
}

/* ------------------------ Fecha y hora -------------------------- */

const fmtHora12 = new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Lima',
});

/** Hora "hh:mm a. m./p. m." en zona Lima (espacios normales, sin NBSP). */
export function formatHora12(ms) {
    if (!Number.isFinite(ms)) return '—';
    return fmtHora12
        .format(new Date(ms))
        .replace(/[\u00A0\u202F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/* --------------------------- Dinero ----------------------------- */

/** "S/ 12.50" siempre con 2 decimales y sin separadores especiales. */
export const soles = (n) => `S/ ${round2(n).toFixed(2)}`;

/** Quita saltos de línea y caracteres de control (evita romper el mensaje). */
function limpiarLinea(texto) {
    return String(texto ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u001F\u007F]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/* ------------------------- WhatsApp ----------------------------- */

/**
 * Arma el texto del mensaje (saltos de línea reales "\n").
 * @param {object} venta venta directa guardada
 * @param {string} [nombreSalon]
 */
export function buildMensajeWhatsApp(venta, nombreSalon = NOMBRE_SALON_POR_DEFECTO) {
    const pago = venta.pago || {};
    const salon = limpiarLinea(nombreSalon) || NOMBRE_SALON_POR_DEFECTO;
    const momento = venta.pago?.pagadoEn ?? venta.creadaEn;

    const lineas = [
        `🎱 *${salon}*`,
        '',
        `📅 Fecha: ${formatDate(momento)}`,
        `🕐 Hora: ${formatHora12(momento)}`,
        `👤 Cliente: ${limpiarLinea(venta.cliente) || 'Cliente general'}`,
        '',
        '🛒 *DETALLE DE CONSUMO*',
        ...(venta.items || []).map(
            (it) => `• ${limpiarLinea(it.nombre)} x${it.cantidad} — ${soles(it.subtotal)}`
        ),
        '',
        `💰 *TOTAL: ${soles(venta.total)}*`,
        '',
        `💳 Medio de pago: ${etiquetaMetodo(pago.metodoPago)}`,
    ];

    if (String(pago.metodoPago).toUpperCase() === 'EFECTIVO') {
        lineas.push(`  Pagó con: ${soles(pago.montoRecibido)}`);
        lineas.push(`  Vuelto: ${soles(pago.vuelto)}`);
    } else if (pago.detalleVuelto && limpiarLinea(pago.detalleVuelto)) {
        lineas.push(`  Detalle: ${limpiarLinea(pago.detalleVuelto)}`);
    }

    lineas.push('', '¡Gracias por su visita! 🎱');
    return lineas.join('\n');
}

/**
 * Enlace wa.me: prefijo 51 SIN "+", solo dígitos y texto codificado.
 * @throws {Error} si el teléfono no es un celular peruano válido.
 */
export function buildWhatsAppUrl(telefono, mensaje) {
    const digitos = soloDigitos(telefono);
    if (!esTelefonoValido(digitos)) {
        throw new Error('El número de WhatsApp debe tener 9 dígitos y empezar con 9.');
    }
    return `https://wa.me/${PREFIJO_PAIS}${digitos}?text=${encodeURIComponent(mensaje)}`;
}
