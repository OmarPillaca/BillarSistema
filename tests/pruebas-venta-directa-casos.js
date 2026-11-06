/* ============================================================
   pruebas-venta-directa-casos.js — Casos de prueba de la Venta
   Directa. Módulo SIN DOM: lo usan la página
   tests/pruebas-venta-directa.html y cualquier ejecutor (Node).

   Las pruebas de datos escriben en localStorage, así que antes
   de empezar se hace un RESPALDO de todas las claves "billar:*"
   y al terminar se RESTAURAN (aunque algo falle).
   ============================================================ */

import { db } from '../js/db.js';
import { calculateProductsTotal, calculateChange } from '../js/billing.js';
import { combinarIngresos, resumen, finalizadasEnRango, ingresosPorMetodo, topProductos } from '../js/reports.js';
import {
    esTelefonoValido,
    errorTelefono,
    buildMensajeWhatsApp,
    buildWhatsAppUrl,
} from '../js/venta-directa.js';

/* ---------------------- Infraestructura ---------------------- */
const resultados = [];

const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function caso(grupo, nombre, esperado, obtenido) {
    resultados.push({
        grupo,
        nombre,
        ok: iguales(esperado, obtenido),
        esperado: JSON.stringify(esperado),
        obtenido: JSON.stringify(obtenido),
    });
}

function verdadero(grupo, nombre, condicion, detalle = '') {
    resultados.push({
        grupo,
        nombre,
        ok: !!condicion,
        esperado: 'true',
        obtenido: String(!!condicion) + (detalle ? ` (${detalle})` : ''),
    });
}

/** El caso pasa solo si la función lanza un error (opcionalmente con cierto texto). */
async function lanza(grupo, nombre, fn, textoEsperado = '') {
    let mensaje = null;
    try {
        await fn();
    } catch (e) {
        mensaje = e.message || String(e);
    }
    const ok = mensaje !== null && (!textoEsperado || mensaje.includes(textoEsperado));
    resultados.push({
        grupo,
        nombre,
        ok,
        esperado: textoEsperado ? `Error que contiene «${textoEsperado}»` : 'Lanza un error',
        obtenido: mensaje === null ? 'NO lanzó error' : mensaje,
    });
}

/* Respaldo / restauración de localStorage (solo claves del sistema). */
function respaldar() {
    const copia = {};
    for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('billar:')) copia[k] = localStorage.getItem(k);
    }
    return copia;
}

function restaurar(copia) {
    const claves = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('billar:')) claves.push(k);
    }
    claves.forEach((k) => localStorage.removeItem(k));
    Object.entries(copia).forEach(([k, v]) => localStorage.setItem(k, v));
}

/* ------------------------ Casos puros ------------------------ */
function pruebasTotales() {
    const g = '1. Totales y subtotales';
    const items = [
        { precioUnitario: 2.5, cantidad: 3 },
        { precioUnitario: 1.3, cantidad: 1 },
    ];
    caso(g, '3 × 2.50 + 1 × 1.30 = 8.80', 8.8, calculateProductsTotal(items));
    caso(g, '0.1 × 3 + 0.2 × 3 = 0.90 (sin error de coma flotante)', 0.9, calculateProductsTotal([
        { precioUnitario: 0.1, cantidad: 3 },
        { precioUnitario: 0.2, cantidad: 3 },
    ]));
    caso(g, 'Lista vacía = 0', 0, calculateProductsTotal([]));
}

function pruebasVuelto() {
    const g = '2. Vuelto en efectivo';
    caso(g, 'Pago exacto → vuelto 0', 0, calculateChange(8.8, 8.8));
    caso(g, 'Paga 10 con total 8.80 → vuelto 1.20', 1.2, calculateChange(8.8, 10));
    caso(g, 'Paga 5 con total 8.80 → faltan 3.80 (negativo)', -3.8, calculateChange(8.8, 5));
    caso(g, 'Paga 20 con total 14.50 → vuelto 5.50', 5.5, calculateChange(14.5, 20));
}

function pruebasTelefono() {
    const g = '3. Validación de teléfono';
    caso(g, '987654321 es válido', true, esTelefonoValido('987654321'));
    caso(g, '98765432 (8 dígitos) no es válido', false, esTelefonoValido('98765432'));
    caso(g, '9876543210 (10 dígitos) no es válido', false, esTelefonoValido('9876543210'));
    caso(g, '887654321 (no empieza con 9) no es válido', false, esTelefonoValido('887654321'));
    caso(g, '98765a321 (con letras) no es válido', false, esTelefonoValido('98765a321'));
    caso(g, 'Vacío es válido cuando es opcional', '', errorTelefono(''));
    caso(g, 'Vacío da error cuando es obligatorio', 'Ingresa el número de WhatsApp.', errorTelefono('', { obligatorio: true }));
    verdadero(g, 'Con letras muestra mensaje de "solo números"', errorTelefono('98765a321').includes('solo números'));
}

function pruebasWhatsApp() {
    const g = '7. Enlace y mensaje de WhatsApp';
    const ahora = Date.UTC(2026, 10, 4, 22, 5); // 04/11/2026 17:05 en Lima
    const ventaEfectivo = {
        cliente: 'Juan Pérez',
        creadaEn: ahora,
        items: [
            { nombre: 'Gaseosa', cantidad: 2, subtotal: 10 },
            { nombre: 'Snack', cantidad: 1, subtotal: 4.5 },
        ],
        total: 14.5,
        pago: { metodoPago: 'EFECTIVO', montoRecibido: 20, vuelto: 5.5, detalleVuelto: '', pagadoEn: ahora },
    };
    const msgEfectivo = buildMensajeWhatsApp(ventaEfectivo, 'Billar Punto 8');
    const url = buildWhatsAppUrl('987654321', msgEfectivo);

    verdadero(g, 'La URL empieza con https://wa.me/51987654321?text=', url.startsWith('https://wa.me/51987654321?text='));
    verdadero(g, 'El número NO lleva "+"', !url.split('?')[0].includes('+'));
    verdadero(g, 'Los saltos de línea van como %0A', url.includes('%0A') && !url.includes('\n'));
    verdadero(g, 'El texto va codificado (sin espacios crudos)', !/\s/.test(url));
    caso(g, 'decodeURIComponent devuelve el mensaje original', msgEfectivo, decodeURIComponent(url.split('?text=')[1]));
    verdadero(g, 'Incluye nombre del salón, cliente y total', msgEfectivo.includes('Billar Punto 8') && msgEfectivo.includes('Juan Pérez') && msgEfectivo.includes('TOTAL: S/ 14.50'));
    verdadero(g, 'Incluye fecha 04/11/2026 y hora 05:05 p. m. (Lima)', msgEfectivo.includes('04/11/2026') && msgEfectivo.includes('05:05 p. m.'));
    verdadero(g, 'Efectivo muestra "Pagó con" y "Vuelto"', msgEfectivo.includes('Pagó con: S/ 20.00') && msgEfectivo.includes('Vuelto: S/ 5.50'));
    verdadero(g, 'Los ítems llevan cantidad y subtotal', msgEfectivo.includes('Gaseosa x2 — S/ 10.00') && msgEfectivo.includes('Snack x1 — S/ 4.50'));

    const ventaYape = {
        ...ventaEfectivo,
        pago: { metodoPago: 'YAPE', montoRecibido: 14.5, vuelto: 0, detalleVuelto: 'Se devolvieron S/ 2 por Yape', pagadoEn: ahora },
    };
    const msgYape = buildMensajeWhatsApp(ventaYape);
    verdadero(g, 'Yape con detalle muestra "Detalle:" y no "Vuelto"', msgYape.includes('Detalle: Se devolvieron S/ 2 por Yape') && !msgYape.includes('Vuelto:'));

    const ventaYapeSinDetalle = { ...ventaYape, pago: { ...ventaYape.pago, detalleVuelto: '' } };
    verdadero(g, 'Yape sin detalle no muestra línea de detalle', !buildMensajeWhatsApp(ventaYapeSinDetalle).includes('Detalle:'));

    const ventaSaltos = { ...ventaEfectivo, cliente: 'Ana\nLópez\r\n*x*' };
    verdadero(g, 'El nombre del cliente no rompe líneas del mensaje', buildMensajeWhatsApp(ventaSaltos).includes('👤 Cliente: Ana López *x*'));
}

async function pruebasUrlInvalida() {
    const g = '7. Enlace y mensaje de WhatsApp';
    await lanza(g, 'buildWhatsAppUrl rechaza un número de 8 dígitos', () => buildWhatsAppUrl('98765432', 'hola'), '9 dígitos');
    await lanza(g, 'buildWhatsAppUrl rechaza un número que no empieza con 9', () => buildWhatsAppUrl('887654321', 'hola'), 'empezar con 9');
}

/* --------------------- Casos con datos reales --------------------- */
async function prepararDatos() {
    await db.clearAll();
    const gaseosa = await db.productos.create({ nombre: 'Gaseosa', categoria: 'Bebidas', precio: 5, stock: 10 });
    const snack = await db.productos.create({ nombre: 'Snack', categoria: 'Snacks', precio: 4.5, stock: null });
    const agua = await db.productos.create({ nombre: 'Agua', categoria: 'Bebidas', precio: 3, stock: 2 });
    const inactivo = await db.productos.create({ nombre: 'Descontinuado', categoria: '', precio: 2, estado: 'INACTIVO', stock: 5 });
    return { gaseosa, snack, agua, inactivo };
}

const stockDe = async (id) => (await db.productos.getById(id)).stock;

async function pruebasCreate() {
    const g4 = '4. Crear venta: stock y montos';
    const { gaseosa, snack, agua } = await prepararDatos();

    const venta = await db.ventasDirectas.create({
        cliente: '  Luis  ',
        telefono: '987654321',
        mesaReferencia: 'Mesa 2',
        items: [
            { productoId: gaseosa.id, cantidad: 2 },
            { productoId: snack.id, cantidad: 1 },
        ],
        pago: { metodoPago: 'EFECTIVO', montoRecibido: 20 },
    });

    caso(g4, 'Estado PAGADA', 'PAGADA', venta.estado);
    caso(g4, 'Total = 2 × 5 + 1 × 4.50 = 14.50 (calculado en db.js)', 14.5, venta.total);
    caso(g4, 'Vuelto = 20 − 14.50 = 5.50', 5.5, venta.pago.vuelto);
    caso(g4, 'Cliente se recorta', 'Luis', venta.cliente);
    caso(g4, 'Guarda mesa de referencia', 'Mesa 2', venta.mesaReferencia);
    caso(g4, 'Guarda precio unitario histórico', 5, venta.items[0].precioUnitario);
    caso(g4, 'Descuenta stock (10 − 2 = 8)', 8, await stockDe(gaseosa.id));
    caso(g4, 'Producto sin control de stock sigue en null', null, await stockDe(snack.id));
    caso(g4, 'La venta queda guardada', 1, (await db.ventasDirectas.getAll()).length);

    // La UI no puede imponer montos: aunque mande basura, el total sale de los precios reales.
    const v2 = await db.ventasDirectas.create({
        cliente: '',
        items: [{ productoId: snack.id, cantidad: 2, subtotal: 0.01, precioUnitario: 0.01 }],
        total: 0.01,
        pago: { metodoPago: 'TARJETA' },
    });
    caso(g4, 'Cliente vacío → "Cliente general"', 'Cliente general', v2.cliente);
    caso(g4, 'Ignora montos enviados por la UI (2 × 4.50 = 9)', 9, v2.total);
    caso(g4, 'Tarjeta: recibido = total y vuelto 0', [9, 0], [v2.pago.montoRecibido, v2.pago.vuelto]);

    const v3 = await db.ventasDirectas.create({
        cliente: 'Rosa',
        items: [{ productoId: agua.id, cantidad: 1 }],
        pago: { metodoPago: 'YAPE', detalleVuelto: 'Se devolvió S/ 1 por Yape' },
    });
    caso(g4, 'Yape guarda el detalle del vuelto', 'Se devolvió S/ 1 por Yape', v3.pago.detalleVuelto);

    // Stock insuficiente: no cambia nada.
    const ventasAntes = (await db.ventasDirectas.getAll()).length;
    const stockAntes = await stockDe(agua.id);
    await lanza(g4, 'Stock insuficiente lanza error', () =>
        db.ventasDirectas.create({
            cliente: 'X',
            items: [{ productoId: agua.id, cantidad: 5 }],
            pago: { metodoPago: 'TARJETA' },
        }), 'Stock insuficiente');
    caso(g4, 'Tras el error no se guardó ninguna venta', ventasAntes, (await db.ventasDirectas.getAll()).length);
    caso(g4, 'Tras el error el stock no cambió', stockAntes, await stockDe(agua.id));

    // Atomicidad con varios ítems: si el 2.º falla, el 1.º no descuenta.
    const stockGaseosaAntes = await stockDe(gaseosa.id);
    await lanza(g4, 'Si un ítem falla, toda la venta falla', () =>
        db.ventasDirectas.create({
            cliente: 'X',
            items: [
                { productoId: gaseosa.id, cantidad: 1 },
                { productoId: agua.id, cantidad: 99 },
            ],
            pago: { metodoPago: 'TARJETA' },
        }));
    caso(g4, 'El ítem válido tampoco descontó stock (atómico)', stockGaseosaAntes, await stockDe(gaseosa.id));

    // Mismo producto repetido: el stock se valida sobre el acumulado.
    await lanza(g4, 'Producto repetido valida el stock acumulado', () =>
        db.ventasDirectas.create({
            cliente: 'X',
            items: [
                { productoId: agua.id, cantidad: 1 },
                { productoId: agua.id, cantidad: 1 },
            ],
            pago: { metodoPago: 'TARJETA' },
        }), 'Stock insuficiente'); // agua quedó con 1 tras la venta de Rosa
}

async function pruebasRechazos() {
    const g = '5. Crear venta: validaciones';
    const { gaseosa, inactivo } = await prepararDatos();
    const base = { cliente: 'X', items: [{ productoId: gaseosa.id, cantidad: 1 }], pago: { metodoPago: 'TARJETA' } };

    await lanza(g, 'Rechaza producto inactivo', () =>
        db.ventasDirectas.create({ ...base, items: [{ productoId: inactivo.id, cantidad: 1 }] }), 'inactivo');
    await lanza(g, 'Rechaza cantidad 0', () =>
        db.ventasDirectas.create({ ...base, items: [{ productoId: gaseosa.id, cantidad: 0 }] }), 'cantidad');
    await lanza(g, 'Rechaza cantidad decimal', () =>
        db.ventasDirectas.create({ ...base, items: [{ productoId: gaseosa.id, cantidad: 1.5 }] }), 'cantidad');
    await lanza(g, 'Rechaza venta sin productos', () => db.ventasDirectas.create({ ...base, items: [] }), 'al menos un producto');
    await lanza(g, 'Rechaza producto inexistente', () =>
        db.ventasDirectas.create({ ...base, items: [{ productoId: 'no-existe', cantidad: 1 }] }), 'no existe');
    await lanza(g, 'Rechaza efectivo menor al total (5 con total 5 → 4.99)', () =>
        db.ventasDirectas.create({ ...base, pago: { metodoPago: 'EFECTIVO', montoRecibido: 4.99 } }), 'menor al total');
    await lanza(g, 'Rechaza efectivo sin monto', () =>
        db.ventasDirectas.create({ ...base, pago: { metodoPago: 'EFECTIVO' } }));
    await lanza(g, 'Rechaza método de pago vacío', () =>
        db.ventasDirectas.create({ ...base, pago: { metodoPago: '' } }), 'método de pago');
    await lanza(g, 'Rechaza método de pago desconocido', () =>
        db.ventasDirectas.create({ ...base, pago: { metodoPago: 'BITCOIN' } }), 'método de pago');
    await lanza(g, 'Rechaza teléfono inválido', () => db.ventasDirectas.create({ ...base, telefono: '12345' }), '9 dígitos');

    const ok = await db.ventasDirectas.create({ ...base, pago: { metodoPago: 'EFECTIVO', montoRecibido: 5 } });
    caso(g, 'Efectivo exacto (5 con total 5) se acepta con vuelto 0', 0, ok.pago.vuelto);
    caso(g, 'Después de los rechazos solo hay 1 venta guardada', 1, (await db.ventasDirectas.getAll()).length);
}

async function pruebasAnular() {
    const g = '6. Anular venta';
    const { gaseosa } = await prepararDatos();
    const venta = await db.ventasDirectas.create({
        cliente: 'Mario',
        items: [{ productoId: gaseosa.id, cantidad: 3 }],
        pago: { metodoPago: 'YAPE' },
    });
    caso(g, 'Antes de anular: stock 10 − 3 = 7', 7, await stockDe(gaseosa.id));

    const sesionesVacias = await db.sesiones.getAll();
    const antes = resumen(finalizadasEnRango(combinarIngresos(sesionesVacias, await db.ventasDirectas.getAll())), []);
    caso(g, 'Antes de anular suma 15.00 a ingresos', 15, antes.ingresos);

    const anulada = await db.ventasDirectas.anular(venta.id, 'Error al cobrar');
    caso(g, 'Estado ANULADA', 'ANULADA', anulada.estado);
    caso(g, 'Guarda el motivo', 'Error al cobrar', anulada.motivoAnulacion);
    caso(g, 'Devuelve el stock (7 + 3 = 10)', 10, await stockDe(gaseosa.id));

    const despues = resumen(finalizadasEnRango(combinarIngresos(sesionesVacias, await db.ventasDirectas.getAll())), []);
    caso(g, 'La venta anulada deja de sumar a ingresos', 0, despues.ingresos);

    await lanza(g, 'No se puede anular dos veces', () => db.ventasDirectas.anular(venta.id), 'Solo se pueden anular ventas pagadas');
    await lanza(g, 'Anular una venta inexistente lanza error', () => db.ventasDirectas.anular('no-existe'), 'no existe');
    caso(g, 'El stock no se devolvió dos veces', 10, await stockDe(gaseosa.id));
}

async function pruebasReportes() {
    const g = '6. Reportes con ventas directas';
    const { gaseosa, snack } = await prepararDatos();
    await db.ventasDirectas.create({ cliente: 'A', items: [{ productoId: gaseosa.id, cantidad: 2 }], pago: { metodoPago: 'EFECTIVO', montoRecibido: 10 } });
    await db.ventasDirectas.create({ cliente: 'B', items: [{ productoId: gaseosa.id, cantidad: 1 }, { productoId: snack.id, cantidad: 2 }], pago: { metodoPago: 'YAPE' } });

    const todas = combinarIngresos(await db.sesiones.getAll(), await db.ventasDirectas.getAll());
    const fin = finalizadasEnRango(todas);
    const r = resumen(fin, []);
    caso(g, 'Ingresos totales = 10 + 14 = 24', 24, r.ingresos);
    caso(g, 'Cuentan como ingreso por productos (no por mesa)', [0, 24], [r.ingresosTiempo, r.ingresosProductos]);
    caso(g, 'Ingresos por método de pago', [{ metodo: 'EFECTIVO', total: 10 }, { metodo: 'YAPE', total: 14 }].sort((a, b) => b.total - a.total), ingresosPorMetodo(fin));
    const top = topProductos(fin);
    caso(g, 'Top productos: Gaseosa vendió 3 unidades', 3, top.find((p) => p.nombre === 'Gaseosa')?.cantidad);
}

async function pruebasImportacion() {
    const g = '8. Exportar / importar respaldos';
    const { gaseosa } = await prepararDatos();
    await db.ventasDirectas.create({ cliente: 'Z', items: [{ productoId: gaseosa.id, cantidad: 1 }], pago: { metodoPago: 'TARJETA' } });

    const respaldoNuevo = await db.exportAll();
    verdadero(g, 'exportAll incluye la colección ventasDirectas', Array.isArray(respaldoNuevo.ventasDirectas) && respaldoNuevo.ventasDirectas.length === 1);

    // Respaldo antiguo: sin la clave ventasDirectas.
    const respaldoAntiguo = JSON.parse(JSON.stringify(respaldoNuevo));
    delete respaldoAntiguo.ventasDirectas;
    let error = null;
    try {
        await db.importAll(respaldoAntiguo);
    } catch (e) {
        error = e.message;
    }
    caso(g, 'Importar un respaldo antiguo (sin ventasDirectas) no falla', null, error);
    caso(g, 'Tras importar el antiguo, ventasDirectas queda vacía', 0, (await db.ventasDirectas.getAll()).length);

    await db.importAll(respaldoNuevo);
    caso(g, 'Importar un respaldo con la colección la restaura', 1, (await db.ventasDirectas.getAll()).length);

    // Importación inválida: no debe modificar nada.
    const malo = JSON.parse(JSON.stringify(respaldoNuevo));
    malo.ventasDirectas[0].pago.metodoPago = 'BITCOIN';
    await lanza(g, 'Un respaldo con ventas inválidas se rechaza', () => db.importAll(malo), 'ventasDirectas');
    caso(g, 'Tras el rechazo los datos siguen intactos', 1, (await db.ventasDirectas.getAll()).length);

    const noLista = JSON.parse(JSON.stringify(respaldoNuevo));
    noLista.ventasDirectas = 'hola';
    await lanza(g, 'ventasDirectas que no es lista se rechaza', () => db.importAll(noLista), 'no es una lista');

    await db.clearAll();
    caso(g, 'clearAll también borra las ventas directas', 0, (await db.ventasDirectas.getAll()).length);
}

/* ------------------------ Ejecución --------------------------- */
/**
 * Ejecuta todas las pruebas. Respalda y restaura localStorage.
 * @returns {Promise<Array<{grupo,nombre,ok,esperado,obtenido}>>}
 */
export async function correrPruebas() {
    resultados.length = 0;

    pruebasTotales();
    pruebasVuelto();
    pruebasTelefono();
    pruebasWhatsApp();
    await pruebasUrlInvalida();

    const copia = respaldar();
    try {
        await pruebasCreate();
        await pruebasRechazos();
        await pruebasAnular();
        await pruebasReportes();
        await pruebasImportacion();
    } catch (e) {
        resultados.push({
            grupo: 'Ejecución',
            nombre: 'Las pruebas con datos terminaron sin excepciones',
            ok: false,
            esperado: 'sin errores',
            obtenido: e.stack || e.message,
        });
    } finally {
        restaurar(copia);
    }

    return resultados.slice().sort((a, b) => a.grupo.localeCompare(b.grupo, 'es', { numeric: true }));
}
