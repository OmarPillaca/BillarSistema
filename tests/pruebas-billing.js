/* ============================================================
   pruebas-billing.js — Ejecuta los casos de la sección 17
   contra calculateTableCharge y las funciones de apoyo de
   billing.js, pintando ✔ / ✘ con esperado y obtenido.
   No toca localStorage ni los datos del sistema.
   ============================================================ */

import {
    calculateTableCharge,
    getChargeBreakdown,
    getElapsedMinutes,
    calculateProductsTotal,
    calculateSessionTotal,
    calculateChange,
} from '../js/billing.js';

/* ---------------------- Infraestructura ---------------------- */

let totalPasadas = 0;
let totalFallidas = 0;

const fmt = (v) =>
    typeof v === 'number'
        ? `S/ ${Number.isInteger(v) ? v : v.toFixed(2)}`
        : String(v);

const sameNumber = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;

/**
 * Registra un caso en la tabla indicada.
 * @returns {boolean} si pasó
 */
function record({ tbody, caso, esperado, obtenido, onError, expectedError = false }) {
    const tr = document.createElement('tr');
    let ok;

    if (expectedError) {
        // Caso que debe lanzar error: onError contiene el mensaje capturado (o null).
        ok = onError !== null && onError !== undefined && onError !== '';
        tr.append(
            cellTexto(caso, 'celda-caso'),
            cellTexto(typeof caso === 'string' && caso.includes('(') ? 'Error descriptivo' : 'Error descriptivo', 'small muted'),
            cellTexto(ok ? onError : 'NO lanzó error', 'valor-obtenido' + (ok ? '' : ' is-wrong')),
            cellEstado(ok)
        );
    } else if (onError) {
        // Lanzó error cuando no debía.
        ok = false;
        tr.append(
            cellTexto(caso, 'celda-caso'),
            cellTexto(fmt(esperado), 'valor-esperado'),
            cellTexto(`Excepción: ${onError}`, 'valor-obtenido is-wrong'),
            cellEstado(false)
        );
    } else {
        ok = sameNumber(obtenido, esperado);
        tr.append(
            cellTexto(caso, 'celda-caso'),
            cellTexto(fmt(esperado), 'valor-esperado'),
            cellTexto(fmt(obtenido), 'valor-obtenido' + (ok ? '' : ' is-wrong')),
            cellEstado(ok)
        );
    }

    if (!ok) tr.classList.add('fila-fail');
    tbody.appendChild(tr);
    ok ? (totalPasadas += 1) : (totalFallidas += 1);
    return ok;
}

function cellTexto(texto, clase) {
    const td = document.createElement('td');
    if (clase) td.className = clase;
    if (texto instanceof Node) td.appendChild(texto);
    else td.textContent = texto;
    return td;
}

function cellEstado(ok) {
    const td = document.createElement('td');
    td.className = ok ? 'result-ok' : 'result-fail';
    td.textContent = ok ? '✔' : '✘';
    td.setAttribute('aria-label', ok ? 'Prueba aprobada' : 'Prueba reprobada');
    return td;
}

/** Ejecuta fn capturando el error; devuelve { valor } o { error }. */
function tryCatch(fn) {
    try {
        return { valor: fn(), error: null };
    } catch (e) {
        return { valor: undefined, error: e && e.message ? e.message : String(e) };
    }
}

/* ------------------------ Casos ------------------------------ */

/** Ejecuta la tabla de casos para una tarifa dada. */
function runChargeCases(tarifa, cases, tbodyId) {
    const tbody = document.getElementById(tbodyId);
    cases.forEach((esperado) => {
        // espera: [minutos, cobroEsperado]
        const [minutos, esperadoCobro] = esperado;
        const caso = `${minutos} min → ${fmt(esperadoCobro)}   (tarifa ${fmt(tarifa)})`;
        const r = tryCatch(() => calculateTableCharge(minutos, tarifa));
        record({
            tbody,
            caso: document.createTextNode(caso),
            esperado: esperadoCobro,
            obtenido: r.valor,
            onError: r.error,
        });
    });
}

/* Casos obligatorios — sección 17 */
const CASOS_TARIFA_8 = [
    [0, 0], [9, 0], [10, 1], [30, 4], [40, 5], [50, 6],
    [60, 8], [70, 9], [80, 10], [90, 12], [100, 13], [110, 14],
    [120, 16], [125, 16], [130, 17],
];

const CASOS_TARIFA_10 = [
    [60, 10], [70, 11], [80, 12], [90, 15],
    [100, 16], [110, 17], [120, 20], [150, 25],
];

const CASOS_TARIFA_9 = [
    [90, 13.5], [100, 14.5], [110, 15.5], [120, 18],
];

function runInvalidCases() {
    const tbody = document.getElementById('tabla-invalidos');
    const casos = [
        { desc: 'Minutos negativos', llamada: 'calculateTableCharge(-5, 8)', fn: () => calculateTableCharge(-5, 8) },
        { desc: 'Minutos no numéricos', llamada: 'calculateTableCharge("treinta", 8)', fn: () => calculateTableCharge('treinta', 8) },
        { desc: 'Minutos NaN', llamada: 'calculateTableCharge(NaN, 8)', fn: () => calculateTableCharge(NaN, 8) },
        { desc: 'Tarifa 0', llamada: 'calculateTableCharge(60, 0)', fn: () => calculateTableCharge(60, 0) },
        { desc: 'Tarifa negativa', llamada: 'calculateTableCharge(60, -8)', fn: () => calculateTableCharge(60, -8) },
        { desc: 'Tarifa no numérica', llamada: 'calculateTableCharge(60, "ocho")', fn: () => calculateTableCharge(60, 'ocho') },
        { desc: 'Desglose con minutos negativos', llamada: 'getChargeBreakdown(-1, 8)', fn: () => getChargeBreakdown(-1, 8) },
        { desc: 'Minutos no numéricos (desglose)', llamada: 'getChargeBreakdown(true, 8)', fn: () => getChargeBreakdown(true, 8) },
    ];

    casos.forEach(({ desc, llamada, fn }) => {
        const r = tryCatch(fn);
        const casoWrap = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = desc;
        const code = document.createElement('code');
        code.textContent = llamada;
        casoWrap.append(strong, code);

        const tr = document.createElement('tr');
        const ok = r.error !== null;

        tr.append(
            cellTexto(strong),
            cellTexto(code, 'mono xsmall'),
            cellTexto(ok ? r.error : 'NO lanzó error', 'valor-obtenido' + (ok ? '' : ' is-wrong')),
            cellEstado(ok)
        );
        if (!ok) tr.classList.add('fila-fail');
        tbody.appendChild(tr);
        ok ? (totalPasadas += 1) : (totalFallidas += 1);
    });
}

function runSupportCases() {
    const tbody = document.getElementById('tabla-apoyo');
    const add = (caso, esperado, obtenido) =>
        record({ tbody, caso: document.createTextNode(caso), esperado, obtenido });

    /* getElapsedMinutes: minutos completos (trunca segundos) */
    const base = 1_700_000_000_000;
    add('getElapsedMinutes(+90 min 30 s) → 90 min', 90, getElapsedMinutes(base, base + 90 * 60000 + 30000));
    add('getElapsedMinutes(+59 s) → 0 min', 0, getElapsedMinutes(base, base + 59000));
    add('getElapsedMinutes(fin < inicio) → 0 min', 0, getElapsedMinutes(base, base - 5000));

    /* getChargeBreakdown (desglose visual) */
    const d1 = getChargeBreakdown(90, 8);
    add('Desglose 90 min / S/ 8 → horasCompletas', 1, d1.horasCompletas);
    add('Desglose 90 min / S/ 8 → minutosRestantes', 30, d1.minutosRestantes);
    add('Desglose 90 min / S/ 8 → cargoHoras', 8, d1.cargoHoras);
    add('Desglose 90 min / S/ 8 → cargoMinutos', 4, d1.cargoMinutos);
    add('Desglose 90 min / S/ 8 → total', 12, d1.total);

    const d2 = getChargeBreakdown(95, 9);
    add('Desglose 95 min / S/ 9 → total (9 + 4.50)', 13.5, d2.total);

    /* calculateProductsTotal */
    add(
        'calculateProductsTotal(2 × 5 + 1 × 4.50)',
        14.5,
        calculateProductsTotal([
            { precioUnitario: 5, cantidad: 2 },
            { precioUnitario: 4.5, cantidad: 1 },
        ])
    );
    add('calculateProductsTotal(lista vacía)', 0, calculateProductsTotal([]));
    add('calculateProductsTotal(no-array) → 0', 0, calculateProductsTotal('x'));

    /* calculateSessionTotal = cargoTiempo + productos */
    const sesion = { inicio: Date.now() - 90 * 60000, tarifaHora: 8, consumos: [{ precioUnitario: 5, cantidad: 2 }] };
    add('calculateSessionTotal(90 min tarifa 8 + S/ 10 productos)', 22, calculateSessionTotal(sesion, Date.now()));

    /* calculateChange */
    add('calculateChange(22, 25) → vuelto', 3, calculateChange(22, 25));
    add('calculateChange(22, 20) → falta pagar (-2)', -2, calculateChange(22, 20));
    add('calculateChange(13.5, 20) → vuelto 6.50', 6.5, calculateChange(13.5, 20));

    /* Errores en calculateSessionTotal */
    const rSesion = tryCatch(() => calculateSessionTotal(null));
    const tr = document.createElement('tr');
    const okSesion = rSesion.error !== null;
    tr.append(
        cellTexto(document.createTextNode('calculateSessionTotal(null) lanza error'), 'celda-caso'),
        cellTexto('Error descriptivo', 'small muted'),
        cellTexto(okSesion ? rSesion.error : 'NO lanzó error', 'valor-obtenido' + (okSesion ? '' : ' is-wrong')),
        cellEstado(okSesion)
    );
    if (!okSesion) tr.classList.add('fila-fail');
    tbody.appendChild(tr);
    okSesion ? (totalPasadas += 1) : (totalFallidas += 1);
}

/* ------------------------ Ejecución --------------------------- */

function renderResumen() {
    const el = document.getElementById('resumen');
    const ok = totalFallidas === 0;
    el.className = `resumen ${ok ? 'resumen--ok' : 'resumen--fail'}`;
    el.textContent = ok
        ? `✔ ${totalPasadas} pruebas pasadas, 0 fallidas`
        : `✘ ${totalFallidas} de ${totalPasadas + totalFallidas} pruebas fallidas`;
    document.title = `${ok ? '✔' : '✘'} Pruebas de facturación · Sistema de Billar`;
}

try {
    runChargeCases(8, CASOS_TARIFA_8, 'tabla-tarifa-8');
    runChargeCases(10, CASOS_TARIFA_10, 'tabla-tarifa-10');
    runChargeCases(9, CASOS_TARIFA_9, 'tabla-tarifa-9');
    runInvalidCases();
    runSupportCases();
} catch (e) {
    const el = document.getElementById('resumen');
    el.className = 'resumen resumen--fail';
    el.textContent = `Error ejecutando las pruebas: ${e.message}`;
    console.error(e);
}

renderResumen();
