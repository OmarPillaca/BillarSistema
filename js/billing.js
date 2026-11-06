/* ============================================================
   billing.js — TODA la lógica de facturación del sistema.
   REGLA ÚNICA de cobro por tiempo (ningún otro archivo la repite):

   1) minutos = minutos completos transcurridos (segundos truncados)
   2) horasCompletas = floor(minutos / 60); minutosRestantes = minutos % 60
   3) cargo = horasCompletas × tarifaHora + adicional(minutosRestantes)

   Tabla de adicional:
     0–9  → 0            30–39 → tarifa/2
     10–19→ 1            40–49 → tarifa/2 + 1
     20–29→ 2            50–59 → tarifa/2 + 2

   Todo el cálculo de dinero se hace en CÉNTIMOS enteros y los
   resultados se exponen en soles redondeados a 2 decimales.
   ============================================================ */

import { toCents, centsToSoles } from './utils.js';

/* ---------- Validaciones internas ---------- */

/* Convierte a número rechazando tipos no numéricos (booleanos, null,
   arrays…) y textos que no representan un número. */
function coerceNumber(value, label) {
    const isNumber = typeof value === 'number';
    const isNumericString = typeof value === 'string' && value.trim() !== '';
    if (!isNumber && !isNumericString) {
        throw new Error(`${label} inválido: debe ser un número.`);
    }
    const n = Number(value);
    if (!Number.isFinite(n)) {
        throw new Error(`${label} inválido: debe ser un número.`);
    }
    return n;
}

function assertValidMinutes(minutes) {
    const n = coerceNumber(minutes, 'Minutos');
    if (n < 0) {
        throw new Error('Minutos inválidos: debe ser un número mayor o igual a 0.');
    }
    return Math.floor(n); /* los segundos se truncan */
}

function assertValidRate(hourlyRate) {
    const n = coerceNumber(hourlyRate, 'Tarifa');
    if (n <= 0) {
        throw new Error('Tarifa inválida: debe ser un número mayor a 0.');
    }
    return n;
}

/* Adicional por minutos restantes, en céntimos */
function additionalChargeCents(minutosRestantes, rateCents) {
    const halfRateCents = Math.round(rateCents / 2);
    if (minutosRestantes <= 9) return 0;
    if (minutosRestantes <= 19) return toCents(1);
    if (minutosRestantes <= 29) return toCents(2);
    if (minutosRestantes <= 39) return halfRateCents;
    if (minutosRestantes <= 49) return halfRateCents + toCents(1);
    return halfRateCents + toCents(2); /* 50–59 */
}

/* ---------- API pública ---------- */

/* Desglose del cargo por tiempo. calculateTableCharge usa esta función. */
export function getChargeBreakdown(minutes, hourlyRate) {
    const minutos = assertValidMinutes(minutes);
    const rateCents = toCents(assertValidRate(hourlyRate));

    const horasCompletas = Math.floor(minutos / 60);
    const minutosRestantes = minutos % 60;
    const cargoHorasCents = horasCompletas * rateCents;
    const cargoMinutosCents = additionalChargeCents(minutosRestantes, rateCents);

    return {
        horasCompletas,
        minutosRestantes,
        cargoHoras: centsToSoles(cargoHorasCents),
        cargoMinutos: centsToSoles(cargoMinutosCents),
        total: centsToSoles(cargoHorasCents + cargoMinutosCents),
    };
}

/* Cargo por tiempo, en soles. Ejemplos (tarifa 8):
   60→8 · 70→9 · 80→10 · 90→12 · 100→13 · 110→14 · 120→16 */
export function calculateTableCharge(minutes, hourlyRate) {
    return getChargeBreakdown(minutes, hourlyRate).total;
}

/* Minutos completos entre dos timestamps (segundos truncados). */
export function getElapsedMinutes(startMs, endMs = Date.now()) {
    const start = coerceNumber(startMs, 'Hora de inicio');
    const end = endMs === null || endMs === undefined ? Date.now() : coerceNumber(endMs, 'Hora de fin');
    if (end <= start) return 0;
    return Math.floor((end - start) / 60000);
}

/* Σ subtotal de consumos, en soles (cálculo en céntimos). */
export function calculateProductsTotal(consumos) {
    if (!Array.isArray(consumos)) return 0;
    const totalCents = consumos.reduce((acc, c) => {
        const unitCents = toCents(c && c.precioUnitario);
        const qty = Math.max(0, Math.floor(Number(c && c.cantidad) || 0));
        return acc + unitCents * qty;
    }, 0);
    return centsToSoles(totalCents);
}

/* Subtotal de un consumo suelto (precio histórico × cantidad).
   El precio 0 es válido para productos gratuitos. */
export function calculateConsumptionSubtotal(precioUnitario, cantidad) {
    const price = Number(precioUnitario);
    if (!Number.isFinite(price) || price < 0) {
        throw new Error('Precio unitario inválido: debe ser un número mayor o igual a 0.');
    }
    const qty = Math.max(0, Math.floor(Number(cantidad) || 0));
    return centsToSoles(toCents(price) * qty);
}

/* Total de la sesión = cargo por tiempo + productos.
   Devuelve el total en soles. */
export function calculateSessionTotal(sesion, ahora = Date.now()) {
    if (!sesion || typeof sesion !== 'object') {
        throw new Error('Sesión inválida para calcular el total.');
    }
    const minutos = getElapsedMinutes(sesion.inicio, ahora);
    const cargoMesa = calculateTableCharge(minutos, sesion.tarifaHora);
    const totalProductos = calculateProductsTotal(sesion.consumos);
    return centsToSoles(toCents(cargoMesa) + toCents(totalProductos));
}

/* Vuelto: positivo = sobra (vuelto); negativo = falta pagar. */
export function calculateChange(total, montoRecibido) {
    const totalCents = toCents(total);
    const recibidoCents = toCents(montoRecibido);
    return centsToSoles(recibidoCents - totalCents);
}
