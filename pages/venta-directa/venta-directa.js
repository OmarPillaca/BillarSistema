/* ============================================================
   venta-directa.js — Venta de productos sin sesión de mesa.
   Formulario → modal de cobro → ventana final (imprimir/WhatsApp).
   La venta se guarda en db.ventasDirectas.create() al confirmar
   el pago; los montos finales los recalcula db.js.
   ============================================================ */

import { initApp } from '../../js/app.js';
import { db } from '../../js/db.js';
import {
    formatCurrency,
    openModal,
    confirmAction,
    notify,
    escapeHtml,
    toNumber,
    includesText,
    sortBy,
} from '../../js/utils.js';
import { calculateProductsTotal, calculateChange } from '../../js/billing.js';
import { METODOS_PAGO_LISTA, soloDigitos, errorTelefono } from '../../js/venta-directa.js';
import { abrirVentanaFinal } from '../../js/venta-directa-ui.js';

/* ------------------------- Estado --------------------------- */
const state = {
    productos: [], // solo ACTIVOS y no eliminados
    mesas: [],
    cuentas: [], // una por cliente: { id, numero, cliente, telefono, mesa, carrito: Map(productoId → cantidad) }
    activaId: null,
    contador: 0,
    filtros: { texto: '', categoria: '' },
    cobrando: false,
};

const $ = (id) => document.getElementById(id);

/* ----------------- Cuentas (un cliente = una venta) ---------------- */
function crearCuenta() {
    state.contador += 1;
    return { id: `cuenta-${state.contador}`, numero: state.contador, cliente: '', telefono: '', mesa: '', carrito: new Map() };
}

function cuentaActiva() {
    return state.cuentas.find((c) => c.id === state.activaId) || state.cuentas[0];
}

/** Carrito de la cuenta que se está atendiendo. */
function carritoActivo() {
    return cuentaActiva().carrito;
}

/** Unidades de un producto ya apartadas en TODAS las cuentas abiertas. */
function reservado(productoId) {
    return state.cuentas.reduce((a, c) => a + (c.carrito.get(productoId) || 0), 0);
}

/** Unidades que aún se pueden agregar a una cuenta (stock − lo apartado por las demás). */
function libreParaCuenta(p, cuenta) {
    if (typeof p.stock !== 'number') return Infinity;
    const enOtras = reservado(p.id) - (cuenta.carrito.get(p.id) || 0);
    return Math.max(0, p.stock - enOtras);
}

const etiquetaCuenta = (c) => c.cliente.trim() || `Cliente ${c.numero}`;

/* ------------------- Arranque (al final del archivo) -------- */
await initApp({ page: 'venta-directa' });
await cargarDatos();
state.cuentas.push(crearCuenta());
state.activaId = state.cuentas[0].id;
enlazarEventos();
render();

/* ------------------------ Carga ----------------------------- */
async function cargarDatos() {
    const [productos, mesas] = await Promise.all([db.productos.getAll(), db.mesas.getAll()]);
    state.productos = sortBy(
        productos.filter((p) => p.estado === 'ACTIVO' && !p.eliminado),
        (p) => p.nombre
    );
    state.mesas = sortBy(
        mesas.filter((m) => m.estado !== 'INACTIVA'),
        (m) => m.nombre
    );
    renderFiltroCategorias();
    renderSelectMesas();
}

async function recargarProductos() {
    const productos = await db.productos.getAll();
    state.productos = sortBy(
        productos.filter((p) => p.estado === 'ACTIVO' && !p.eliminado),
        (p) => p.nombre
    );
    // Ajusta todas las cuentas a la realidad: quita productos que ya no existen y reparte
    // el stock real entre las cuentas (en orden) recortando lo que no alcance.
    const restante = new Map();
    state.cuentas.forEach((cuenta) => {
        for (const [id, cant] of [...cuenta.carrito]) {
            const p = state.productos.find((x) => x.id === id);
            if (!p) {
                cuenta.carrito.delete(id);
                continue;
            }
            if (typeof p.stock !== 'number') continue;
            const quedan = restante.has(id) ? restante.get(id) : p.stock;
            const asignado = Math.min(cant, quedan);
            restante.set(id, quedan - asignado);
            if (asignado < 1) cuenta.carrito.delete(id);
            else cuenta.carrito.set(id, asignado);
        }
    });
    renderFiltroCategorias();
}

/* ------------------------ Eventos --------------------------- */
function enlazarEventos() {
    $('vd-buscar').addEventListener('input', (e) => {
        state.filtros.texto = e.target.value;
        renderCatalogo();
    });
    $('vd-categoria').addEventListener('change', (e) => {
        state.filtros.categoria = e.target.value;
        renderCatalogo();
    });

    $('vd-productos').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-producto]');
        if (btn) agregarProducto(btn.dataset.producto);
    });

    const lista = $('vd-items');
    lista.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-accion]');
        if (!btn) return;
        const id = btn.dataset.id;
        if (btn.dataset.accion === 'mas') cambiarCantidad(id, (carritoActivo().get(id) || 0) + 1);
        if (btn.dataset.accion === 'menos') cambiarCantidad(id, (carritoActivo().get(id) || 0) - 1);
        if (btn.dataset.accion === 'quitar') cambiarCantidad(id, 0);
    });
    lista.addEventListener('change', (e) => {
        const input = e.target.closest('input[data-cantidad]');
        if (!input) return;
        cambiarCantidad(input.dataset.id, Math.trunc(toNumber(input.value)));
    });

    $('vd-cliente').addEventListener('input', (e) => {
        cuentaActiva().cliente = e.target.value;
        renderTabs();
    });
    $('vd-mesa').addEventListener('change', (e) => {
        cuentaActiva().mesa = e.target.value;
    });
    $('vd-telefono').addEventListener('input', (e) => {
        const limpio = soloDigitos(e.target.value).slice(0, 9);
        if (e.target.value !== limpio) e.target.value = limpio;
        cuentaActiva().telefono = limpio;
        mostrarErrorCampo('vd-telefono', '');
    });

    $('vd-tabs').addEventListener('click', (e) => {
        const cerrar = e.target.closest('[data-cerrar-cuenta]');
        if (cerrar) {
            cerrarCuenta(cerrar.dataset.cerrarCuenta);
            return;
        }
        const tab = e.target.closest('[data-cuenta]');
        if (tab) activarCuenta(tab.dataset.cuenta);
    });
    $('vd-agregar-cliente').addEventListener('click', agregarCuenta);

    // Evita perder cuentas abiertas por un refresco o cierre accidental de la pestaña.
    window.addEventListener('beforeunload', (e) => {
        if (state.cuentas.some((c) => c.carrito.size > 0)) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    $('vd-telefono').addEventListener('blur', () => {
        mostrarErrorCampo('vd-telefono', errorTelefono($('vd-telefono').value));
    });

    $('vd-limpiar').addEventListener('click', onLimpiar);
    $('vd-cobrar').addEventListener('click', abrirModalCobro);
}

/* ------------------------ Carrito --------------------------- */
function productoPorId(id) {
    return state.productos.find((p) => p.id === id) || null;
}

function agregarProducto(id) {
    const p = productoPorId(id);
    if (!p) return;
    const cuenta = cuentaActiva();
    const actual = cuenta.carrito.get(id) || 0;
    if (actual + 1 > libreParaCuenta(p, cuenta)) {
        notify(`Stock insuficiente de ${p.nombre} (libre: ${libreParaCuenta(p, cuenta) - actual}).`, 'warning');
        return;
    }
    cuenta.carrito.set(id, actual + 1);
    render();
}

function cambiarCantidad(id, cantidad) {
    const p = productoPorId(id);
    const cuenta = cuentaActiva();
    if (!p || !Number.isFinite(cantidad) || cantidad < 1) {
        cuenta.carrito.delete(id);
        render();
        return;
    }
    const maximo = libreParaCuenta(p, cuenta);
    if (cantidad > maximo) {
        notify(`Solo quedan ${maximo} de ${p.nombre} disponibles para este cliente.`, 'warning');
        cantidad = maximo;
    }
    if (cantidad < 1) cuenta.carrito.delete(id);
    else cuenta.carrito.set(id, cantidad);
    render();
}

/** Ítems del carrito con el formato que entiende billing.js. */
function itemsCarrito(cuenta = cuentaActiva()) {
    const items = [];
    for (const [id, cantidad] of cuenta.carrito) {
        const p = productoPorId(id);
        if (p) items.push({ productoId: id, nombre: p.nombre, precioUnitario: p.precio, cantidad });
    }
    return items;
}

function totalCarrito(cuenta = cuentaActiva()) {
    return calculateProductsTotal(itemsCarrito(cuenta));
}

/* ---------------- Gestión de cuentas (pestañas) ---------------- */
function cargarCuentaEnFormulario(cuenta) {
    $('vd-cliente').value = cuenta.cliente;
    $('vd-telefono').value = cuenta.telefono;
    $('vd-mesa').value = cuenta.mesa;
    mostrarErrorCampo('vd-telefono', '');
}

function activarCuenta(id) {
    if (id === state.activaId || !state.cuentas.some((c) => c.id === id)) return;
    state.activaId = id;
    cargarCuentaEnFormulario(cuentaActiva());
    render();
}

function agregarCuenta() {
    const nueva = crearCuenta();
    state.cuentas.push(nueva);
    state.activaId = nueva.id;
    cargarCuentaEnFormulario(nueva);
    render();
    $('vd-cliente').focus();
}

/** Quita una cuenta de la lista (libera sus productos apartados). Siempre queda al menos una. */
function quitarCuenta(id) {
    const idx = state.cuentas.findIndex((c) => c.id === id);
    if (idx === -1) return;
    if (state.cuentas.length === 1) {
        const unica = state.cuentas[0];
        unica.cliente = '';
        unica.telefono = '';
        unica.mesa = '';
        unica.carrito.clear();
        cargarCuentaEnFormulario(unica);
    } else {
        state.cuentas.splice(idx, 1);
        if (state.activaId === id) {
            state.activaId = state.cuentas[Math.max(0, idx - 1)].id;
            cargarCuentaEnFormulario(cuentaActiva());
        }
    }
    render();
}

async function cerrarCuenta(id) {
    const cuenta = state.cuentas.find((c) => c.id === id);
    if (!cuenta) return;
    if (cuenta.carrito.size > 0 || cuenta.cliente.trim()) {
        const ok = await confirmAction({
            title: 'Cerrar cuenta',
            message: `Se descartará la venta de ${etiquetaCuenta(cuenta)} (${formatCurrency(
                totalCarrito(cuenta)
            )}) sin cobrarla. ¿Continuar?`,
            confirmText: 'Sí, descartar',
            danger: true,
        });
        if (!ok) return;
    }
    quitarCuenta(id);
}

/* ------------------------ Render ---------------------------- */
function render() {
    renderTabs();
    renderCatalogo();
    renderCarrito();
}

function renderTabs() {
    const cont = $('vd-tabs');
    cont.innerHTML = '';
    const varias = state.cuentas.length > 1;

    state.cuentas.forEach((c) => {
        const activa = c.id === state.activaId;
        const total = totalCarrito(c);

        const tab = document.createElement('div');
        tab.className = `vd-tab${activa ? ' vd-tab--activa' : ''}`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vd-tab__btn';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', activa ? 'true' : 'false');
        btn.dataset.cuenta = c.id;
        btn.innerHTML = `<span class="vd-tab__nombre">${escapeHtml(etiquetaCuenta(c))}</span>
            <span class="vd-tab__total">${c.carrito.size > 0 ? formatCurrency(total) : 'Vacía'}</span>`;
        tab.appendChild(btn);

        if (varias || c.carrito.size > 0) {
            const x = document.createElement('button');
            x.type = 'button';
            x.className = 'vd-tab__cerrar';
            x.dataset.cerrarCuenta = c.id;
            x.setAttribute('aria-label', `Cerrar la cuenta de ${etiquetaCuenta(c)}`);
            x.textContent = '✕';
            tab.appendChild(x);
        }
        cont.appendChild(tab);
    });
}

function renderFiltroCategorias() {
    const select = $('vd-categoria');
    const actual = state.filtros.categoria;
    const categorias = [...new Set(state.productos.map((p) => p.categoria).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'es')
    );
    select.innerHTML = '<option value="">Todas</option>';
    categorias.forEach((c) => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    if (actual && !categorias.includes(actual)) state.filtros.categoria = '';
    select.value = state.filtros.categoria;
}

function renderSelectMesas() {
    const select = $('vd-mesa');
    select.innerHTML = '<option value="">Sin mesa</option>';
    state.mesas.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.nombre;
        opt.textContent = m.nombre;
        select.appendChild(opt);
    });
}

function renderCatalogo() {
    const cont = $('vd-productos');
    const vacio = $('vd-productos-vacio');
    const { texto, categoria } = state.filtros;

    const lista = state.productos.filter(
        (p) => (!categoria || p.categoria === categoria) && (!texto || includesText(p.nombre, texto))
    );

    cont.innerHTML = '';
    $('vd-subtitle').textContent = `${state.productos.length} producto${
        state.productos.length === 1 ? '' : 's'
    } disponible${state.productos.length === 1 ? '' : 's'} para vender`;

    if (lista.length === 0) {
        cont.classList.add('hidden');
        vacio.classList.remove('hidden');
        $('vd-vacio-titulo').textContent = state.productos.length === 0 ? 'Sin productos activos' : 'Sin resultados';
        $('vd-vacio-texto').textContent =
            state.productos.length === 0
                ? 'Agrega o activa productos en la sección Productos.'
                : 'Ningún producto coincide con la búsqueda.';
        return;
    }
    cont.classList.remove('hidden');
    vacio.classList.add('hidden');

    lista.forEach((p) => {
        const cuenta = cuentaActiva();
        const enCarrito = cuenta.carrito.get(p.id) || 0;
        const agotado = typeof p.stock === 'number' && p.stock < 1;
        const libre = libreParaCuenta(p, cuenta) - enCarrito; // lo que aún se puede sumar a esta cuenta
        const sinMas = typeof p.stock === 'number' && libre < 1;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'vd-prod';
        btn.dataset.producto = p.id;
        btn.disabled = agotado || sinMas;

        let meta = p.categoria ? escapeHtml(p.categoria) : 'Sin categoría';
        let metaClase = 'vd-prod__meta';
        if (agotado) {
            meta = 'Agotado';
            metaClase += ' vd-prod__meta--agotado';
        } else if (typeof p.stock === 'number') {
            meta += ` · Stock libre: ${Math.max(0, p.stock - reservado(p.id))}`;
        }

        btn.innerHTML = `
            <span class="vd-prod__nombre">${escapeHtml(p.nombre)}</span>
            <span class="vd-prod__precio">${formatCurrency(p.precio)}</span>
            <span class="${metaClase}">${meta}</span>
            ${enCarrito > 0 ? `<span class="vd-prod__meta">En la venta: ${enCarrito}</span>` : ''}`;
        btn.setAttribute('aria-label', `Agregar ${p.nombre}, ${formatCurrency(p.precio)}`);
        cont.appendChild(btn);
    });
}

function renderCarrito() {
    const ul = $('vd-items');
    const items = itemsCarrito();
    ul.innerHTML = '';

    items.forEach((it) => {
        const subtotal = calculateProductsTotal([it]);
        const li = document.createElement('li');
        li.className = 'vd-item';
        li.innerHTML = `
            <span class="vd-item__nombre">${escapeHtml(it.nombre)}</span>
            <span class="vd-item__subtotal">${formatCurrency(subtotal)}</span>
            <div class="vd-item__controles">
                <button type="button" class="vd-qty-btn" data-accion="menos" data-id="${it.productoId}" aria-label="Quitar una unidad de ${escapeHtml(it.nombre)}">−</button>
                <input class="form-input vd-qty-input" type="number" min="1" step="1" inputmode="numeric"
                       value="${it.cantidad}" data-cantidad data-id="${it.productoId}" aria-label="Cantidad de ${escapeHtml(it.nombre)}">
                <button type="button" class="vd-qty-btn" data-accion="mas" data-id="${it.productoId}" aria-label="Agregar una unidad de ${escapeHtml(it.nombre)}">＋</button>
                <span class="vd-item__unit">${formatCurrency(it.precioUnitario)} c/u</span>
                <button type="button" class="vd-qty-btn vd-qty-btn--quitar" data-accion="quitar" data-id="${it.productoId}" aria-label="Quitar ${escapeHtml(it.nombre)} de la venta">✕</button>
            </div>`;
        ul.appendChild(li);
    });

    $('vd-items-vacio').classList.toggle('hidden', items.length > 0);
    $('vd-total').textContent = formatCurrency(totalCarrito());
    $('vd-cobrar').disabled = items.length === 0;
}

/* ------------------- Formulario / errores ------------------- */
function mostrarErrorCampo(inputId, mensaje) {
    const input = $(inputId);
    const error = document.querySelector(`[data-error-for="${inputId}"]`);
    if (!input || !error) return;
    error.textContent = mensaje;
    error.hidden = !mensaje;
    input.toggleAttribute('aria-invalid', !!mensaje);
    input.closest('.form-group')?.classList.toggle('is-invalid', !!mensaje);
}

function datosFormulario() {
    return {
        cliente: $('vd-cliente').value.trim(),
        telefono: $('vd-telefono').value.trim(),
        mesaReferencia: $('vd-mesa').value,
    };
}

function formularioModificado() {
    const f = datosFormulario();
    return carritoActivo().size > 0 || !!(f.cliente || f.telefono || f.mesaReferencia);
}

/** Limpia solo la cuenta activa (las demás clientes no se tocan). */
function limpiarFormulario() {
    const c = cuentaActiva();
    c.carrito.clear();
    c.cliente = '';
    c.telefono = '';
    c.mesa = '';
    cargarCuentaEnFormulario(c);
    render();
}

async function onLimpiar() {
    if (!formularioModificado()) return;
    const ok = await confirmAction({
        title: 'Limpiar venta',
        message: `Se borrarán los productos y los datos de ${etiquetaCuenta(cuentaActiva())}. Las demás cuentas no se tocan. ¿Continuar?`,
        confirmText: 'Sí, limpiar',
        danger: true,
    });
    if (ok) limpiarFormulario();
}

/* ------------------- Modal de cobro ------------------------- */
function abrirModalCobro() {
    const cuenta = cuentaActiva(); // el modal bloquea la pantalla: no se puede cambiar de cuenta mientras se cobra
    const items = itemsCarrito(cuenta);
    if (items.length === 0) {
        notify('Agrega al menos un producto a la venta.', 'warning');
        return;
    }

    const msgTelefono = errorTelefono($('vd-telefono').value);
    if (msgTelefono) {
        mostrarErrorCampo('vd-telefono', msgTelefono);
        $('vd-telefono').focus();
        return;
    }

    const form = datosFormulario();
    const total = totalCarrito(cuenta);

    const filas = items
        .map(
            (it) => `<tr>
                <td>${escapeHtml(it.nombre)}</td>
                <td class="num">${it.cantidad}</td>
                <td class="num">${formatCurrency(it.precioUnitario)}</td>
                <td class="num">${formatCurrency(calculateProductsTotal([it]))}</td>
            </tr>`
        )
        .join('');

    const opcionesMetodo = METODOS_PAGO_LISTA.map(
        (m) => `<option value="${m.valor}">${m.etiqueta}</option>`
    ).join('');

    const content = `
        <p class="form-hint">Cliente: <strong>${escapeHtml(form.cliente || 'Cliente general')}</strong>${
            form.mesaReferencia ? ` · ${escapeHtml(form.mesaReferencia)}` : ''
        }</p>
        <table class="vd-cobro-tabla">
            <thead><tr><th>Producto</th><th class="num">Cant.</th><th class="num">P. unit.</th><th class="num">Subtotal</th></tr></thead>
            <tbody>${filas}</tbody>
        </table>
        <div class="kv mt-3">
            <div class="kv__row kv__row--total"><span>TOTAL A PAGAR</span><span>${formatCurrency(total)}</span></div>
        </div>

        <div class="form-group mt-4">
            <label class="form-label" for="vd-metodo">Método de pago <span class="req">*</span></label>
            <select class="form-select" id="vd-metodo">
                <option value="">Selecciona un método…</option>
                ${opcionesMetodo}
            </select>
        </div>

        <div class="form-group mt-3 hidden" id="vd-bloque-efectivo">
            <label class="form-label" for="vd-recibido">¿Con cuánto pagó? (S/) <span class="req">*</span></label>
            <input class="form-input" id="vd-recibido" type="number" min="0" step="0.1" inputmode="decimal" placeholder="0.00">
            <div class="vd-montos-rapidos" id="vd-montos-rapidos"></div>
            <div class="vd-vuelto" id="vd-vuelto" aria-live="polite">Vuelto: ${formatCurrency(0)}</div>
        </div>

        <div class="form-group mt-3 hidden" id="vd-bloque-digital">
            <label class="form-label" for="vd-detalle">Descripción del vuelto <small>(opcional)</small></label>
            <input class="form-input" id="vd-detalle" type="text" maxlength="120" autocomplete="off"
                   placeholder="Ej.: se devolvieron S/ 2 por Yape">
        </div>

        <p class="vd-pago-msg" id="vd-pago-msg" role="status" aria-live="polite"></p>`;

    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Volver</button>
        <button type="button" class="btn btn--primary" id="vd-confirmar" disabled>Confirmar pago</button>`;

    const modal = openModal({ title: 'Cobrar venta', content, footer, size: 'md' });
    const root = modal.root;

    const selMetodo = root.querySelector('#vd-metodo');
    const bloqueEfectivo = root.querySelector('#vd-bloque-efectivo');
    const bloqueDigital = root.querySelector('#vd-bloque-digital');
    const inputRecibido = root.querySelector('#vd-recibido');
    const inputDetalle = root.querySelector('#vd-detalle');
    const cajaVuelto = root.querySelector('#vd-vuelto');
    const msgPago = root.querySelector('#vd-pago-msg');
    const btnConfirmar = root.querySelector('#vd-confirmar');

    // Botones de monto rápido: Exacto, 10, 20, 50, 100 (los menores al total quedan deshabilitados).
    const rapidos = root.querySelector('#vd-montos-rapidos');
    [{ etiqueta: 'Exacto', monto: total }, ...[10, 20, 50, 100].map((m) => ({ etiqueta: String(m), monto: m }))].forEach(
        ({ etiqueta, monto }) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'btn btn--sm btn--secondary';
            b.textContent = etiqueta === 'Exacto' ? 'Exacto' : `S/ ${etiqueta}`;
            b.disabled = monto < total;
            b.addEventListener('click', () => {
                inputRecibido.value = String(monto);
                actualizar();
                inputRecibido.focus();
            });
            rapidos.appendChild(b);
        }
    );

    /** Valida el pago con las reglas del enunciado. */
    function validar() {
        if (itemsCarrito(cuenta).length === 0) return { ok: false, msg: 'No hay productos en la venta.' };
        const metodo = selMetodo.value;
        if (!metodo) return { ok: false, msg: 'Selecciona un método de pago.' };
        if (metodo === 'EFECTIVO') {
            const recibido = toNumber(inputRecibido.value);
            if (inputRecibido.value.trim() === '' || !Number.isFinite(recibido) || recibido < 0) {
                return { ok: false, msg: 'Ingresa con cuánto pagó el cliente.' };
            }
            const vuelto = calculateChange(total, recibido);
            if (vuelto < 0) return { ok: false, msg: `Faltan ${formatCurrency(-vuelto)} para completar el pago.` };
        }
        return { ok: true, msg: '' };
    }

    function actualizar() {
        const metodo = selMetodo.value;
        bloqueEfectivo.classList.toggle('hidden', metodo !== 'EFECTIVO');
        bloqueDigital.classList.toggle('hidden', metodo !== 'YAPE' && metodo !== 'PLIN');

        if (metodo === 'EFECTIVO') {
            const recibido = toNumber(inputRecibido.value);
            const hayMonto = inputRecibido.value.trim() !== '' && Number.isFinite(recibido) && recibido >= 0;
            const vuelto = calculateChange(total, hayMonto ? recibido : 0);
            if (!hayMonto) {
                cajaVuelto.textContent = `Vuelto: ${formatCurrency(0)}`;
                cajaVuelto.classList.remove('vd-vuelto--falta');
            } else if (vuelto >= 0) {
                cajaVuelto.textContent = `Vuelto: ${formatCurrency(vuelto)}`;
                cajaVuelto.classList.remove('vd-vuelto--falta');
            } else {
                cajaVuelto.textContent = `Faltan ${formatCurrency(-vuelto)} por pagar`;
                cajaVuelto.classList.add('vd-vuelto--falta');
            }
        }

        const { ok, msg } = validar();
        msgPago.textContent = msg;
        btnConfirmar.disabled = !ok || state.cobrando;
    }

    selMetodo.addEventListener('change', () => {
        actualizar();
        if (selMetodo.value === 'EFECTIVO') inputRecibido.focus();
        if (selMetodo.value === 'YAPE' || selMetodo.value === 'PLIN') inputDetalle.focus();
    });
    inputRecibido.addEventListener('input', actualizar);
    inputRecibido.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!btnConfirmar.disabled) btnConfirmar.click();
        }
    });

    root.querySelector('[data-close]').addEventListener('click', () => modal.close());

    btnConfirmar.addEventListener('click', async () => {
        if (state.cobrando) return; // evita doble clic / ventas duplicadas
        const { ok, msg } = validar();
        if (!ok) {
            msgPago.textContent = msg;
            return;
        }

        state.cobrando = true;
        btnConfirmar.disabled = true;
        btnConfirmar.textContent = 'Guardando…';

        const metodoPago = selMetodo.value;
        try {
            const venta = await db.ventasDirectas.create({
                ...form,
                items: [...cuenta.carrito].map(([productoId, cantidad]) => ({ productoId, cantidad })),
                pago: {
                    metodoPago,
                    montoRecibido: metodoPago === 'EFECTIVO' ? toNumber(inputRecibido.value) : total,
                    detalleVuelto: metodoPago === 'YAPE' || metodoPago === 'PLIN' ? inputDetalle.value : '',
                },
            });

            modal.close();
            notify(`Venta registrada · Total ${formatCurrency(venta.total)}`, 'success');

            // La venta ya está guardada: se quita esa cuenta de inmediato para que no pueda
            // registrarse dos veces aunque se cierre la ventana final. Las demás siguen abiertas.
            quitarCuenta(cuenta.id);
            await recargarProductos();
            render();

            await abrirVentanaFinal(venta, {
                onNueva: () => $('vd-cliente').focus(),
            });
        } catch (err) {
            // Error (p. ej. stock insuficiente): el modal sigue abierto y no se pierde nada.
            notify(err.message, 'error');
            btnConfirmar.textContent = 'Confirmar pago';
            try {
                await recargarProductos();
                render();
            } catch (e) {
                /* sin acción: el error original ya se mostró */
            }
        } finally {
            state.cobrando = false;
            if (document.body.contains(btnConfirmar)) actualizar();
        }
    });

    actualizar();
    selMetodo.focus();
}
