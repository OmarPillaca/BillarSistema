/* ============================================================
   mesas.js — Gestión de mesas: CRUD, inicio de sesión, contador
   en vivo (un solo setInterval que actualiza SOLO texto),
   personas, detalle de sesión activa y cancelación.
   El cobro por tiempo siempre sale de billing.js.
   ============================================================ */

import { initApp } from '../../js/app.js';
import { db } from '../../js/db.js';
import {
    formatCurrency,
    formatTime,
    formatDuration,
    elapsedSeconds,
    openModal,
    confirmAction,
    notify,
    escapeHtml,
    toNumber,
    round2,
    sortBy,
} from '../../js/utils.js';
import {
    calculateTableCharge,
    getChargeBreakdown,
    getElapsedMinutes,
    calculateProductsTotal,
    calculateSessionTotal,
    calculateChange,
} from '../../js/billing.js';
import { openComprobante } from '../../js/comprobante.js';

/* ------------------------- Estado --------------------------- */
const state = {
    mesas: [],
    sesiones: [],
};

let tickerTimer = null;
let detailModal = null;
let detailMesaId = null;

/* ------------------------ Carga/render ---------------------- */
async function reload() {
    state.mesas = sortBy(await db.mesas.getAll(), (m) => m.nombre);
    state.sesiones = await db.sesiones.getAll();
    renderGrid();
    renderSubtitle();

    if (detailMesaId) {
        const sesion = activeSession(detailMesaId);
        if (sesion) renderDetail();
        else closeDetail();
    }
}

function activeSession(mesaId) {
    return state.sesiones.find((s) => s.mesaId === mesaId && s.estado === 'ACTIVA') || null;
}

function sessionById(id) {
    return state.sesiones.find((s) => s.id === id) || null;
}

function renderSubtitle() {
    const total = state.mesas.length;
    const disponibles = state.mesas.filter((m) => m.estado === 'DISPONIBLE').length;
    const enUso = state.mesas.filter((m) => m.estado === 'EN_USO').length;
    const inactivas = state.mesas.filter((m) => m.estado === 'INACTIVA').length;
    document.getElementById('mesas-subtitle').textContent =
        total === 0
            ? 'Aún no hay mesas registradas'
            : `${total} mesa${total === 1 ? '' : 's'} · ${disponibles} disponible${disponibles === 1 ? '' : 's'} · ${enUso} en uso · ${inactivas} inactiva${inactivas === 1 ? '' : 's'}`;
}

const ESTADO_BADGE = {
    DISPONIBLE: { clase: 'badge--success', texto: 'DISPONIBLE' },
    EN_USO: { clase: 'badge--danger badge--pulse', texto: 'EN USO' },
    INACTIVA: { clase: 'badge--gray', texto: 'INACTIVA' },
};

function renderGrid() {
    const grid = document.getElementById('mesas-grid');
    const vacio = document.getElementById('mesas-vacio');
    grid.innerHTML = '';

    if (state.mesas.length === 0) {
        vacio.classList.remove('hidden');
        return;
    }
    vacio.classList.add('hidden');

    state.mesas.forEach((mesa) => {
        const badge = ESTADO_BADGE[mesa.estado] || ESTADO_BADGE.DISPONIBLE;
        const claseEstado =
            mesa.estado === 'EN_USO' ? 'en-uso' : mesa.estado === 'INACTIVA' ? 'inactiva' : 'disponible';
        const sesion = mesa.estado === 'EN_USO' ? activeSession(mesa.id) : null;

        let extra = '';
        if (sesion) {
            const consumos = sesion.consumos || [];
            const totalProductos = calculateProductsTotal(consumos);
            const personasCount = sesion.personas.length;
            const productosCount = consumos.reduce((acc, c) => acc + c.cantidad, 0);
            extra = `
                <p class="mesa-card__start">Inicio: ${formatTime(sesion.inicio)}</p>
                <div class="mesa-card__live">
                    <div class="live-row live-row--tiempo">
                        <span>Tiempo</span>
                        <strong data-elapsed="${sesion.id}">${formatDuration(elapsedSeconds(sesion.inicio))}</strong>
                    </div>
                    <div class="live-row">
                        <span>Cargo mesa</span>
                        <strong data-charge="${sesion.id}">${formatCurrency(
                            calculateTableCharge(getElapsedMinutes(sesion.inicio), sesion.tarifaHora)
                        )}</strong>
                    </div>
                    <div class="live-row live-row--total">
                        <span>Total (tiempo + productos)</span>
                        <strong data-total="${sesion.id}">${formatCurrency(
                            calculateSessionTotal(sesion)
                        )}</strong>
                    </div>
                    <p class="mesa-card__meta">${personasCount} persona${personasCount === 1 ? '' : 's'} · ${productosCount} producto${productosCount === 1 ? '' : 's'} · ${formatCurrency(
                        totalProductos
                    )} en consumo</p>
                </div>`;
        }

        const card = document.createElement('article');
        card.className = `mesa-card mesa-card--${claseEstado}`;
        card.dataset.mesa = mesa.id;
        card.innerHTML = `
            <div class="mesa-card__head">
                <h2 class="mesa-card__name" title="${escapeHtml(mesa.nombre)}">${escapeHtml(mesa.nombre)}</h2>
                <span class="badge ${badge.clase}">${badge.texto}</span>
            </div>
            <div class="mesa-card__rate">${formatCurrency(mesa.tarifaHora)} <span>/ hora</span></div>
            ${extra}
            <div class="mesa-card__actions">
                ${
                    mesa.estado === 'EN_USO'
                        ? `<button type="button" class="btn btn--primary" data-action="detalle">Ver detalle</button>`
                        : mesa.estado === 'DISPONIBLE'
                          ? `<button type="button" class="btn btn--primary" data-action="iniciar">INICIAR SESIÓN</button>`
                          : `<button type="button" class="btn btn--secondary" data-action="activar">ACTIVAR</button>`
                }
                <button type="button" class="icon-btn" data-action="editar" aria-label="Editar ${escapeHtml(
                    mesa.nombre
                )}" title="Editar">✎</button>
                <button type="button" class="icon-btn icon-btn--danger" data-action="eliminar" aria-label="Eliminar ${escapeHtml(
                    mesa.nombre
                )}" title="Eliminar">🗑</button>
            </div>`;
        grid.appendChild(card);
    });
}

/* ------------------- Contador en vivo ----------------------- */
/* Un único setInterval: actualiza SOLO textos, nunca redibuja. */
function startTicker() {
    if (tickerTimer) return;
    tickerTimer = setInterval(updateLiveTexts, 1000);
    updateLiveTexts();
}

function updateLiveTexts() {
    const now = Date.now();

    document.querySelectorAll('[data-elapsed]').forEach((elm) => {
        const sesion = sessionById(elm.dataset.elapsed);
        if (!sesion || sesion.estado !== 'ACTIVA') return;
        elm.textContent = formatDuration(elapsedSeconds(sesion.inicio, now));
    });

    document.querySelectorAll('[data-charge]').forEach((elm) => {
        const sesion = sessionById(elm.dataset.charge);
        if (!sesion || sesion.estado !== 'ACTIVA') return;
        const minutos = getElapsedMinutes(sesion.inicio, now);
        elm.textContent = formatCurrency(calculateTableCharge(minutos, sesion.tarifaHora));
    });

    document.querySelectorAll('[data-breakdown]').forEach((elm) => {
        const sesion = sessionById(elm.dataset.breakdown);
        if (!sesion || sesion.estado !== 'ACTIVA') return;
        elm.textContent = breakdownText(getElapsedMinutes(sesion.inicio, now), sesion.tarifaHora);
    });

    document.querySelectorAll('[data-total]').forEach((elm) => {
        const sesion = sessionById(elm.dataset.total);
        if (!sesion || sesion.estado !== 'ACTIVA') return;
        elm.textContent = formatCurrency(calculateSessionTotal(sesion, now));
    });
}

function breakdownText(minutos, tarifa) {
    const b = getChargeBreakdown(minutos, tarifa);
    const partes = [];
    if (b.horasCompletas > 0) partes.push(`${b.horasCompletas} hora${b.horasCompletas === 1 ? '' : 's'} → ${formatCurrency(b.cargoHoras)}`);
    if (b.minutosRestantes > 0) partes.push(`${b.minutosRestantes} minutos → ${formatCurrency(b.cargoMinutos)}`);
    if (partes.length === 0) partes.push('Sin cargo por tiempo (primeros 9 minutos)');
    return partes.join('\n');
}

/* ------------------- Acciones de la cuadrícula -------------- */
function onGridClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-mesa]');
    if (!card) return;
    const mesa = state.mesas.find((m) => m.id === card.dataset.mesa);
    if (!mesa) return;

    switch (btn.dataset.action) {
        case 'iniciar':
            openStartSession(mesa);
            break;
        case 'detalle':
            openDetail(mesa.id);
            break;
        case 'editar':
            openMesaForm(mesa);
            break;
        case 'activar':
            reactivateMesa(mesa);
            break;
        case 'eliminar':
            deleteMesa(mesa);
            break;
        default:
            break;
    }
}

/* ------------------------ CRUD de mesas --------------------- */
function mesaFormHtml(mesa) {
    const esEdicion = Boolean(mesa);
    const enUso = mesa && mesa.estado === 'EN_USO';
    return `
        <div class="form-grid">
            <div class="form-group">
                <label class="form-label" for="mesa-nombre">Nombre o número <span class="req">*</span></label>
                <input class="form-input" id="mesa-nombre" type="text" maxlength="40" autocomplete="off"
                    placeholder="Ej. Mesa 5" value="${escapeHtml(mesa?.nombre ?? '')}">
                <span class="form-error" data-error-for="mesa-nombre" hidden></span>
            </div>
            <div class="form-group">
                <label class="form-label" for="mesa-tarifa">Tarifa por hora (S/) <span class="req">*</span></label>
                <input class="form-input" id="mesa-tarifa" type="number" min="0.5" step="0.5" inputmode="decimal"
                    value="${mesa ? mesa.tarifaHora : 8}">
                <span class="form-error" data-error-for="mesa-tarifa" hidden></span>
            </div>
            <div class="form-group">
                <label class="form-label" for="mesa-estado">Estado</label>
                <select class="form-select" id="mesa-estado" ${enUso ? 'disabled' : ''}>
                    <option value="DISPONIBLE" ${mesa && mesa.estado === 'DISPONIBLE' ? 'selected' : ''}>Disponible</option>
                    <option value="INACTIVA" ${mesa && mesa.estado === 'INACTIVA' ? 'selected' : ''}>Inactiva</option>
                </select>
                ${
                    enUso
                        ? '<span class="form-hint">La mesa está en uso: finaliza o cancela la sesión para cambiar su estado.</span>'
                        : esEdicion
                          ? ''
                          : '<span class="form-hint">Las nuevas mesas comienzan disponibles.</span>'
                }
            </div>
        </div>`;
}

function openMesaForm(mesa = null) {
    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" id="btn-guardar-mesa">${mesa ? 'Guardar cambios' : 'Crear mesa'}</button>`;

    const modal = openModal({
        title: mesa ? `Editar ${mesa.nombre}` : 'Nueva mesa',
        content: mesaFormHtml(mesa),
        footer,
        onClose: () => {},
    });

    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.root.querySelector('#btn-guardar-mesa').addEventListener('click', async () => {
        clearFieldErrors(modal.root);
        const nombre = modal.root.querySelector('#mesa-nombre').value.trim();
        const tarifa = toNumber(modal.root.querySelector('#mesa-tarifa').value);
        const estado = modal.root.querySelector('#mesa-estado').value;

        let valido = true;
        if (!nombre) {
            showFieldError(modal.root, 'mesa-nombre', 'El nombre de la mesa es obligatorio.');
            valido = false;
        }
        if (!Number.isFinite(tarifa) || tarifa <= 0) {
            showFieldError(modal.root, 'mesa-tarifa', 'La tarifa debe ser un número mayor a 0.');
            valido = false;
        }
        if (!valido) return;

        try {
            if (mesa) {
                await db.mesas.update(mesa.id, { nombre, tarifaHora: tarifa, estado });
                notify(`✓ Mesa "${nombre}" actualizada`, 'success');
            } else {
                await db.mesas.create({ nombre, tarifaHora: tarifa, estado });
                notify(`✓ Mesa "${nombre}" creada`, 'success');
            }
            modal.close();
            await reload();
        } catch (err) {
            notify(err.message, 'error');
        }
    });

    modal.root.querySelector('#mesa-nombre').focus();
}

async function reactivateMesa(mesa) {
    try {
        await db.mesas.update(mesa.id, { estado: 'DISPONIBLE' });
        notify(`✓ Mesa "${mesa.nombre}" reactivada`, 'success');
        await reload();
    } catch (err) {
        notify(err.message, 'error');
    }
}

async function deleteMesa(mesa) {
    const enUso = mesa.estado === 'EN_USO';
    const ok = await confirmAction({
        title: 'Eliminar mesa',
        message: enUso
            ? `La mesa "${mesa.nombre}" tiene una sesión activa. Al confirmar, la sesión se CANCELARÁ sin cobro (se devolverá el stock de sus consumos) y la mesa se eliminará. Esta acción no se puede deshacer.`
            : `¿Eliminar la mesa "${mesa.nombre}"? Se borrará de la lista (el historial de sesiones se conserva).`,
        confirmText: 'Sí, eliminar',
        danger: true,
    });
    if (!ok) return;

    try {
        await db.mesas.delete(mesa.id);
        notify(`✓ Mesa "${mesa.nombre}" eliminada${enUso ? ' y sesión cancelada' : ''}`, 'success');
        await reload();
    } catch (err) {
        notify(err.message, 'error');
    }
}

/* ------------------ Iniciar sesión en mesa ------------------ */
function openStartSession(mesa) {
    const content = `
        <p class="modal__text muted small">Mesa: <strong>${escapeHtml(mesa.nombre)}</strong> · Tarifa ${formatCurrency(
            mesa.tarifaHora
        )}/hora (se congela al iniciar)</p>
        <div class="form-group">
            <label class="form-label" for="persona-principal">Persona principal <span class="req">*</span></label>
            <input class="form-input" id="persona-principal" type="text" maxlength="60" autocomplete="off" placeholder="Nombre de quien reserva">
            <span class="form-error" data-error-for="persona-principal" hidden></span>
        </div>
        <div id="personas-adicionales" class="mt-3"></div>
        <button type="button" class="btn btn--secondary btn--sm mt-2" id="btn-add-adicional">＋ Agregar persona adicional</button>`;

    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" id="btn-iniciar">Iniciar sesión</button>`;

    const modal = openModal({
        title: `Iniciar sesión · ${mesa.nombre}`,
        content,
        footer,
        size: 'sm',
    });

    const contenedor = modal.root.querySelector('#personas-adicionales');

    modal.root.querySelector('#btn-add-adicional').addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'persona-extra-row mb-2';
        row.innerHTML = `
            <input class="form-input" type="text" maxlength="60" autocomplete="off" placeholder="Nombre adicional">
            <button type="button" class="icon-btn icon-btn--danger" aria-label="Quitar persona">✕</button>`;
        row.querySelector('button').addEventListener('click', () => row.remove());
        contenedor.appendChild(row);
        row.querySelector('input').focus();
    });

    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.root.querySelector('#btn-iniciar').addEventListener('click', async () => {
        clearFieldErrors(modal.root);
        const principal = modal.root.querySelector('#persona-principal').value.trim();
        if (!principal) {
            showFieldError(modal.root, 'persona-principal', 'Debes indicar la persona principal.');
            return;
        }

        const adicionales = [...contenedor.querySelectorAll('input')]
            .map((i) => i.value.trim())
            .filter(Boolean);

        const personas = [principal, ...adicionales].map((nombre) => ({ nombre }));

        try {
            const sesion = await db.sesiones.create({ mesaId: mesa.id, personas });
            notify(`✓ Sesión iniciada en ${mesa.nombre}`, 'success');
            modal.close();
            await reload();
            openDetail(mesa.id);
            void sesion;
        } catch (err) {
            notify(err.message, 'error');
        }
    });

    modal.root.querySelector('#persona-principal').focus();
}

/* ------------- Detalle de la sesión activa (modal) ----------- */
function openDetail(mesaId) {
    if (detailModal) {
        detailModal.close();
        detailModal = null;
    }
    detailMesaId = mesaId;
    const container = document.createElement('div');

    detailModal = openModal({
        title: 'Sesión activa',
        content: container,
        size: 'lg',
        onClose: () => {
            detailModal = null;
            detailMesaId = null;
        },
    });
    detailModal.container = container;
    renderDetail();
}

function closeDetail() {
    if (detailModal) detailModal.close();
    detailMesaId = null;
}

function renderDetail() {
    if (!detailModal || !detailMesaId) return;
    const mesa = state.mesas.find((m) => m.id === detailMesaId);
    const sesion = activeSession(detailMesaId);
    if (!mesa || !sesion) {
        closeDetail();
        return;
    }

    const minutos = getElapsedMinutes(sesion.inicio);
    const cargoMesa = calculateTableCharge(minutos, sesion.tarifaHora);
    const totalProductos = calculateProductsTotal(sesion.consumos);
    const total = calculateSessionTotal(sesion);
    const soloUnaPersona = sesion.personas.length <= 1;

    const personaPorId = (id) => sesion.personas.find((p) => p.id === id);

    const consumosHtml =
        sesion.consumos.length === 0
            ? '<p class="consumo-vacio">Sin productos todavía.</p>'
            : `<div class="consumo-list">${sesion.consumos
                  .map((c) => {
                      const persona = personaPorId(c.personaId);
                      return `<div class="consumo-row" data-consumo="${c.id}">
                          <span class="consumo-row__who">${escapeHtml(persona ? persona.nombre : '—')}</span>
                          <span class="consumo-row__what">${escapeHtml(c.nombre)}</span>
                          <span class="qty-controls">
                              <button type="button" class="qty-btn" data-qty="-1" ${c.cantidad <= 1 ? 'disabled' : ''} aria-label="Quitar una unidad de ${escapeHtml(
                                  c.nombre
                              )}" title="Reducir cantidad">−</button>
                              <span class="qty-value" aria-label="Cantidad">${c.cantidad}</span>
                              <button type="button" class="qty-btn" data-qty="1" aria-label="Agregar una unidad de ${escapeHtml(
                                  c.nombre
                              )}" title="Aumentar cantidad">＋</button>
                          </span>
                          <span class="consumo-row__sub">${formatCurrency(c.subtotal)}</span>
                          <button type="button" class="qty-btn qty-btn--remove" data-quitar title="Quitar consumo" aria-label="Quitar ${escapeHtml(
                              c.nombre
                          )}">✕</button>
                      </div>`;
                  })
                  .join('')}</div>`;

    const personasHtml = sesion.personas
        .map(
            (p) => `
            <span class="persona-chip">
                ${escapeHtml(p.nombre)}
                <button type="button" class="persona-chip__btn" data-persona-edit="${p.id}" aria-label="Editar ${escapeHtml(
                    p.nombre
                )}" title="Editar">✎</button>
                <button type="button" class="persona-chip__btn" data-persona-remove="${p.id}" aria-label="Eliminar ${escapeHtml(
                    p.nombre
                )}" title="Eliminar" ${soloUnaPersona ? 'disabled' : ''}>✕</button>
            </span>`
        )
        .join('');

    detailModal.container.innerHTML = `
        <div class="detalle-top">
            <span class="detalle-top__mesa">${escapeHtml(mesa.nombre)} · EN USO</span>
            <span class="badge badge--danger badge--pulse">EN USO</span>
        </div>

        <div class="kv">
            <div class="kv__row"><span>Inicio</span><span>${formatTime(sesion.inicio)}</span></div>
            <div class="kv__row"><span>Tarifa por hora</span><span>${formatCurrency(sesion.tarifaHora)}/h</span></div>
            <div class="kv__row">
                <span>Tiempo</span>
                <span class="tiempo-en-vivo" data-elapsed="${sesion.id}">${formatDuration(
                    elapsedSeconds(sesion.inicio)
                )}</span>
            </div>
            <div class="kv__row">
                <span>Cargo por tiempo</span>
                <span data-charge="${sesion.id}">${formatCurrency(cargoMesa)}</span>
            </div>
        </div>
        <p class="cargo-desglose" data-breakdown="${sesion.id}">${escapeHtml(breakdownText(minutos, sesion.tarifaHora))}</p>

        <section class="detalle-seccion">
            <h3 class="detalle-seccion__title">Personas</h3>
            <div class="personas-chips">${personasHtml}</div>
        </section>

        <section class="detalle-seccion">
            <h3 class="detalle-seccion__title">Productos</h3>
            ${consumosHtml}
        </section>

        <div class="kv mt-4">
            <div class="kv__row"><span>Cargo por tiempo</span><span>${formatCurrency(cargoMesa)}</span></div>
            <div class="kv__row"><span>Productos</span><span>${formatCurrency(totalProductos)}</span></div>
            <div class="kv__row kv__row--total"><span>TOTAL</span><span data-total="${sesion.id}">${formatCurrency(
                total
            )}</span></div>
        </div>

        <div class="detalle-acciones">
            <button type="button" class="btn btn--primary" id="btn-cobrar">💳 Cobrar</button>
            <button type="button" class="btn btn--secondary" id="btn-add-producto">＋ Agregar producto</button>
            <button type="button" class="btn btn--secondary" id="btn-add-persona">＋ Agregar persona</button>
            <button type="button" class="btn btn--secondary" id="btn-ver-cuenta">Ver cuenta</button>
            <button type="button" class="btn btn--danger" id="btn-cancelar-sesion">Cancelar sesión</button>
        </div>`;

    wireDetailEvents(mesa, sesion);
    updateLiveTexts();
}

function wireDetailEvents(mesa, sesion) {
    const root = detailModal.container;

    root.querySelector('#btn-add-persona').addEventListener('click', () => openAddPersona(sesion));
    root.querySelector('#btn-add-producto').addEventListener('click', () => openAddConsumo(sesion));
    root.querySelector('#btn-cobrar').addEventListener('click', () => openCobro(sesion));
    root.querySelector('#btn-ver-cuenta').addEventListener('click', () => openCuenta(sesion.id));
    root.querySelector('#btn-cancelar-sesion').addEventListener('click', () => openCancelarSesion(sesion));

    root.querySelectorAll('[data-consumo]').forEach((row) => {
        const consumoId = row.dataset.consumo;
        row.querySelectorAll('[data-qty]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const consumo = sesion.consumos.find((c) => c.id === consumoId);
                if (!consumo) return;
                const delta = Number(btn.dataset.qty);
                const nueva = consumo.cantidad + delta;
                try {
                    if (nueva < 1) {
                        await db.sesiones.removeConsumo(sesion.id, consumo.id);
                        notify(`✓ "${consumo.nombre}" quitado de la cuenta`, 'success');
                    } else {
                        await db.sesiones.updateConsumoCantidad(sesion.id, consumo.id, nueva);
                    }
                    await reload();
                } catch (err) {
                    notify(err.message, 'error');
                }
            });
        });

        const btnQuitar = row.querySelector('[data-quitar]');
        if (btnQuitar) {
            btnQuitar.addEventListener('click', async () => {
                const consumo = sesion.consumos.find((c) => c.id === consumoId);
                if (!consumo) return;
                const ok = await confirmAction({
                    title: 'Quitar consumo',
                    message: `¿Quitar "${consumo.nombre}" de la cuenta? El stock volverá a sumarse.`,
                    confirmText: 'Quitar',
                    danger: true,
                });
                if (!ok) return;
                try {
                    await db.sesiones.removeConsumo(sesion.id, consumo.id);
                    notify(`✓ "${consumo.nombre}" quitado de la cuenta`, 'success');
                    await reload();
                } catch (err) {
                    notify(err.message, 'error');
                }
            });
        }
    });

    root.querySelectorAll('[data-persona-edit]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const persona = sesion.personas.find((p) => p.id === btn.dataset.personaEdit);
            if (persona) openEditPersona(sesion, persona);
        });
    });

    root.querySelectorAll('[data-persona-remove]').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const persona = sesion.personas.find((p) => p.id === btn.dataset.personaRemove);
            if (!persona) return;
            const ok = await confirmAction({
                title: 'Quitar persona',
                message: `¿Quitar a "${persona.nombre}" de esta sesión?`,
                confirmText: 'Quitar',
                danger: true,
            });
            if (!ok) return;
            try {
                await db.sesiones.removePersona(sesion.id, persona.id);
                notify(`✓ Persona "${persona.nombre}" quitada`, 'success');
                await reload();
            } catch (err) {
                notify(err.message, 'error');
            }
        });
    });
}

/* ----------------------- Personas --------------------------- */
function openAddPersona(sesion) {
    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" id="btn-guardar-persona">Agregar</button>`;
    const modal = openModal({
        title: 'Agregar persona',
        content: `
            <div class="form-group">
                <label class="form-label" for="persona-nombre">Nombre <span class="req">*</span></label>
                <input class="form-input" id="persona-nombre" type="text" maxlength="60" autocomplete="off" placeholder="Nombre de la persona">
                <span class="form-error" data-error-for="persona-nombre" hidden></span>
            </div>`,
        footer,
        size: 'sm',
    });

    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.root.querySelector('#btn-guardar-persona').addEventListener('click', async () => {
        clearFieldErrors(modal.root);
        const nombre = modal.root.querySelector('#persona-nombre').value.trim();
        if (!nombre) {
            showFieldError(modal.root, 'persona-nombre', 'El nombre no puede estar vacío.');
            return;
        }
        try {
            await db.sesiones.addPersona(sesion.id, { nombre });
            notify(`✓ Persona "${nombre}" agregada`, 'success');
            modal.close();
            await reload();
        } catch (err) {
            notify(err.message, 'error');
        }
    });
    modal.root.querySelector('#persona-nombre').focus();
}

async function openAddConsumo(sesion) {
    let productos = [];
    try {
        productos = (await db.productos.getAll()).filter((p) => p.estado === 'ACTIVO');
    } catch (err) {
        notify(err.message, 'error');
        return;
    }

    if (productos.length === 0) {
        notify('No hay productos activos. Crea uno en la página de Productos.', 'info');
        return;
    }

    const opcionesProductos = productos
        .map(
            (p) =>
                `<option value="${p.id}">${escapeHtml(p.nombre)} — ${formatCurrency(p.precio)}${
                    typeof p.stock === 'number' ? ` (stock: ${p.stock})` : ''
                }</option>`
        )
        .join('');
    const opcionesPersonas = sesion.personas
        .map((p) => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`)
        .join('');

    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" id="btn-guardar-consumo">Agregar a la cuenta</button>`;
    const modal = openModal({
        title: 'Agregar producto',
        content: `
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label" for="consumo-producto">Producto <span class="req">*</span></label>
                    <select class="form-select" id="consumo-producto">${opcionesProductos}</select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="consumo-persona">Persona <span class="req">*</span></label>
                    <select class="form-select" id="consumo-persona">${opcionesPersonas}</select>
                    <span class="form-hint">¿Quién pidió el producto?</span>
                </div>
                <div class="form-group">
                    <label class="form-label" for="consumo-cantidad">Cantidad <span class="req">*</span></label>
                    <input class="form-input" id="consumo-cantidad" type="number" min="1" step="1" inputmode="numeric" value="1">
                    <span class="form-error" data-error-for="consumo-cantidad" hidden></span>
                </div>
            </div>
            <div class="consumo-producto-info" id="consumo-info" aria-live="polite"></div>`,
        footer,
        size: 'sm',
    });

    const root = modal.root;
    const selectProducto = root.querySelector('#consumo-producto');
    const inputCantidad = root.querySelector('#consumo-cantidad');
    const info = root.querySelector('#consumo-info');

    function actualizarInfo() {
        const producto = productos.find((p) => p.id === selectProducto.value);
        if (!producto) {
            info.textContent = '';
            return;
        }
        const stockTexto =
            typeof producto.stock === 'number'
                ? `Stock disponible: ${producto.stock}`
                : 'Sin control de stock';
        info.innerHTML = `<span>Precio unitario: <strong>${formatCurrency(producto.precio)}</strong></span>
            <span>${stockTexto}</span>`;
        if (typeof producto.stock === 'number') {
            inputCantidad.max = String(Math.max(producto.stock, 1));
            if (Number(inputCantidad.value) > producto.stock) {
                inputCantidad.value = String(Math.max(producto.stock, 1));
            }
        } else {
            inputCantidad.removeAttribute('max');
        }
    }
    selectProducto.addEventListener('change', actualizarInfo);
    actualizarInfo();

    root.querySelector('[data-close]').addEventListener('click', () => modal.close());
    root.querySelector('#btn-guardar-consumo').addEventListener('click', async () => {
        clearFieldErrors(root);
        const productoId = selectProducto.value;
        const personaId = root.querySelector('#consumo-persona').value;
        const cantidad = Number(inputCantidad.value);

        if (!Number.isInteger(cantidad) || cantidad < 1) {
            showFieldError(root, 'consumo-cantidad', 'La cantidad debe ser un entero ≥ 1.');
            return;
        }
        const producto = productos.find((p) => p.id === productoId);
        if (producto && typeof producto.stock === 'number' && cantidad > producto.stock) {
            showFieldError(
                root,
                'consumo-cantidad',
                `Stock insuficiente de ${producto.nombre} (disponible: ${producto.stock}).`
            );
            return;
        }

        try {
            await db.sesiones.addConsumo(sesion.id, { productoId, cantidad, personaId });
            const persona = sesion.personas.find((p) => p.id === personaId);
            notify(`✓ ${cantidad} × ${producto ? producto.nombre : 'producto'} para ${persona ? persona.nombre : ''}`, 'success');
            modal.close();
            await reload();
        } catch (err) {
            notify(err.message, 'error');
        }
    });
}

function openEditPersona(sesion, persona) {
    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" id="btn-guardar-persona">Guardar</button>`;
    const modal = openModal({
        title: 'Editar persona',
        content: `
            <div class="form-group">
                <label class="form-label" for="persona-nombre">Nombre <span class="req">*</span></label>
                <input class="form-input" id="persona-nombre" type="text" maxlength="60" autocomplete="off" value="${escapeHtml(
                    persona.nombre
                )}">
                <span class="form-error" data-error-for="persona-nombre" hidden></span>
            </div>`,
        footer,
        size: 'sm',
    });

    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.root.querySelector('#btn-guardar-persona').addEventListener('click', async () => {
        clearFieldErrors(modal.root);
        const nombre = modal.root.querySelector('#persona-nombre').value.trim();
        if (!nombre) {
            showFieldError(modal.root, 'persona-nombre', 'El nombre no puede estar vacío.');
            return;
        }
        try {
            await db.sesiones.updatePersona(sesion.id, persona.id, { nombre });
            notify('✓ Persona actualizada', 'success');
            modal.close();
            await reload();
        } catch (err) {
            notify(err.message, 'error');
        }
    });
    const input = modal.root.querySelector('#persona-nombre');
    input.focus();
    input.select();
}

/* ------------------- Cuenta por persona --------------------- */
function openCuenta(sesionId) {
    const sesion = sessionById(sesionId);
    if (!sesion || sesion.estado !== 'ACTIVA') {
        notify('La sesión ya no está activa.', 'warning');
        return;
    }

    const minutos = getElapsedMinutes(sesion.inicio);
    const cargoMesa = calculateTableCharge(minutos, sesion.tarifaHora);
    const totalProductos = calculateProductsTotal(sesion.consumos);
    const total = calculateSessionTotal(sesion);

    const personasHtml = sesion.personas
        .map((p) => {
            const suyos = sesion.consumos.filter((c) => c.personaId === p.id);
            const subtotal = suyos.reduce((acc, c) => acc + c.subtotal, 0);
            const items =
                suyos.length === 0
                    ? '<p class="cuenta-persona__empty">Sin consumos.</p>'
                    : suyos
                          .map(
                              (c) => `
                        <div class="cuenta-persona__item">
                            <span>${c.cantidad} × ${escapeHtml(c.nombre)} — ${formatCurrency(c.precioUnitario)}</span>
                            <span>${formatCurrency(c.subtotal)}</span>
                        </div>`
                          )
                          .join('');
            return `
                <div class="cuenta-persona">
                    <div class="cuenta-persona__head">
                        <span>${escapeHtml(p.nombre)}</span>
                        <span>${formatCurrency(subtotal)}</span>
                    </div>
                    ${items}
                </div>`;
        })
        .join('');

    const content = `
        ${personasHtml}
        <hr class="cuenta-sep">
        <div class="kv">
            <div class="kv__row"><span>Productos (total)</span><span>${formatCurrency(totalProductos)}</span></div>
            <div class="kv__row"><span>Cargo de mesa (${formatDuration(
                elapsedSeconds(sesion.inicio)
            )})</span><span>${formatCurrency(cargoMesa)}</span></div>
            <div class="kv__row kv__row--total"><span>TOTAL</span><span>${formatCurrency(total)}</span></div>
        </div>
        <p class="form-hint mt-3">El cargo de mesa es único para la mesa; el desglose por persona corresponde solo a sus productos.</p>`;

    const modal = openModal({
        title: 'Cuenta de la sesión',
        content,
        size: 'md',
        footer: '<button type="button" class="btn btn--primary" data-close>Cerrar</button>',
    });
    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
}

/* ------------------------ Cobrar sesión --------------------- */
function openCobro(sesion) {
    if (!sesion || sesion.estado !== 'ACTIVA') {
        notify('La sesión ya no está activa.', 'warning');
        return;
    }

    const ahora = Date.now();
    const minutos = getElapsedMinutes(sesion.inicio, ahora);
    const cargoMesa = calculateTableCharge(minutos, sesion.tarifaHora);
    const totalProductos = calculateProductsTotal(sesion.consumos);
    const total = round2(cargoMesa + totalProductos);

    const contenido = `
        <div class="kv">
            <div class="kv__row"><span>Inicio</span><span>${formatTime(sesion.inicio)}</span></div>
            <div class="kv__row"><span>Tiempo</span><span data-elapsed="${sesion.id}">${formatDuration(
                elapsedSeconds(sesion.inicio)
            )}</span></div>
            <div class="kv__row"><span>Tarifa por hora</span><span>${formatCurrency(sesion.tarifaHora)}/h</span></div>
            <div class="kv__row"><span>Cargo por tiempo</span><span data-charge="${sesion.id}">${formatCurrency(
                cargoMesa
            )}</span></div>
            <div class="kv__row"><span>Desglose</span><span class="cobro-desglose" data-breakdown="${sesion.id}">${breakdownText(
                minutos,
                sesion.tarifaHora
            )}</span></div>
            <div class="kv__row"><span>Productos (${(sesion.consumos || []).reduce((a, c) => a + c.cantidad, 0)})</span><span>${formatCurrency(
                totalProductos
            )}</span></div>
            <div class="kv__row kv__row--total"><span>TOTAL A PAGAR</span><span data-total="${sesion.id}">${formatCurrency(
                total
            )}</span></div>
        </div>

        <div class="form-grid mt-4">
            <div class="form-group">
                <label class="form-label" for="metodo-pago">Método de pago <span class="req">*</span></label>
                <select class="form-select" id="metodo-pago">
                    <option value="EFECTIVO">Efectivo</option>
                    <option value="YAPE">Yape</option>
                    <option value="PLIN">Plin</option>
                    <option value="TARJETA">Tarjeta</option>
                    <option value="OTRO">Otro</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="monto-recibido">Monto recibido (S/) <span class="req">*</span></label>
                <input class="form-input" id="monto-recibido" type="number" min="0" step="0.5" inputmode="decimal" value="${total}">
                <span class="form-error" data-error-for="monto-recibido" hidden></span>
            </div>
        </div>
        <div class="vuelto-box" id="vuelto-box" aria-live="polite">Vuelto: ${formatCurrency(0)}</div>`;

    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Seguir consumiendo</button>
        <button type="button" class="btn btn--primary" id="btn-confirmar-cobro">Cobrar ${formatCurrency(total)}</button>`;

    const modal = openModal({ title: 'Cobrar sesión', content: contenido, footer, size: 'md' });
    const root = modal.root;
    const inputRecibido = root.querySelector('#monto-recibido');

    function actualizarVuelto() {
        const actual = calculateSessionTotal(sesion);
        const recibido = toNumber(inputRecibido.value);
        const valido = Number.isFinite(recibido) && recibido >= 0;
        const vuelto = calculateChange(actual, valido ? recibido : 0);
        const box = root.querySelector('#vuelto-box');
        if (vuelto >= 0) {
            box.textContent = `Vuelto: ${formatCurrency(vuelto)}`;
            box.classList.remove('vuelto-box--falta');
        } else {
            box.textContent = `Faltan ${formatCurrency(-vuelto)} por pagar`;
            box.classList.add('vuelto-box--falta');
        }
    }
    inputRecibido.addEventListener('input', actualizarVuelto);

    root.querySelector('[data-close]').addEventListener('click', () => modal.close());

    root.querySelector('#btn-confirmar-cobro').addEventListener('click', async () => {
        clearFieldErrors(root);

        const fin = Date.now();
        const minutosFin = getElapsedMinutes(sesion.inicio, fin);
        const cargoFin = calculateTableCharge(minutosFin, sesion.tarifaHora);
        const productosFin = calculateProductsTotal(sesion.consumos);
        const totalFin = round2(cargoFin + productosFin);
        const metodoPago = root.querySelector('#metodo-pago').value;
        const recibido = toNumber(inputRecibido.value);

        if (!Number.isFinite(recibido) || recibido < 0) {
            showFieldError(root, 'monto-recibido', 'Ingresa el monto recibido.');
            return;
        }
        if (recibido < totalFin) {
            showFieldError(
                root,
                'monto-recibido',
                `El monto recibido es menor al total (${formatCurrency(totalFin)}).`
            );
            return;
        }
        const vuelto = calculateChange(totalFin, recibido);

        try {
            await db.sesiones.finalizar(sesion.id, {
                fin,
                minutos: minutosFin,
                cargoMesa: cargoFin,
                totalProductos: productosFin,
                total: totalFin,
                metodoPago,
                montoRecibido: recibido,
                vuelto,
            });
            notify(
                `✓ Sesión cobrada · Total ${formatCurrency(totalFin)}${
                    vuelto > 0 ? ` · Vuelto ${formatCurrency(vuelto)}` : ''
                }`,
                'success'
            );
            modal.close();
            closeDetail();
            await reload();
            const guardada = sessionById(sesion.id);
            if (guardada) await openComprobante(guardada);
        } catch (err) {
            notify(err.message, 'error');
        }
    });

    actualizarVuelto();
    inputRecibido.focus();
    inputRecibido.select();
}

/* -------------------- Cancelar sesión ----------------------- */
function openCancelarSesion(sesion) {
    const content = `
        <p class="modal__text">La sesión de <strong>${escapeHtml(
            sesion.mesaNombre
        )}</strong> se cancelará <strong>sin cobro</strong>: no generará ingresos, la mesa quedará DISPONIBLE y el stock de sus consumos se devolverá. Quedará en el historial como CANCELADA.</p>
        <div class="form-group mt-3">
            <label class="form-label" for="motivo-cancelacion">Motivo (opcional)</label>
            <textarea class="form-textarea" id="motivo-cancelacion" maxlength="200" placeholder="Ej. Error de apertura, cliente se retiró…"></textarea>
        </div>`;

    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Volver</button>
        <button type="button" class="btn btn--danger" id="btn-confirmar-cancelar">Sí, cancelar sesión</button>`;

    const modal = openModal({ title: 'Cancelar sesión', content, footer, size: 'sm' });

    modal.root.querySelector('[data-close]').addEventListener('click', () => modal.close());
    modal.root.querySelector('#btn-confirmar-cancelar').addEventListener('click', async () => {
        const motivo = modal.root.querySelector('#motivo-cancelacion').value.trim();
        try {
            await db.sesiones.cancelar(sesion.id, motivo);
            notify('✓ Sesión cancelada sin cobro · mesa liberada', 'success');
            modal.close();
            closeDetail();
            await reload();
        } catch (err) {
            notify(err.message, 'error');
        }
    });
    modal.root.querySelector('#motivo-cancelacion').focus();
}

/* ---------------------- Utilidades UI ----------------------- */
function showFieldError(root, inputId, message) {
    const input = root.querySelector(`#${inputId}`);
    const error = root.querySelector(`[data-error-for="${inputId}"]`);
    if (input) input.setAttribute('aria-invalid', 'true');
    if (error) {
        error.textContent = message;
        error.hidden = false;
        error.closest('.form-group')?.classList.add('is-invalid');
    }
}

function clearFieldErrors(root) {
    root.querySelectorAll('.form-error[data-error-for]').forEach((e) => {
        e.hidden = true;
        e.textContent = '';
        e.closest('.form-group')?.classList.remove('is-invalid');
    });
    root.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
}

/* ------------------- Arranque de la página ------------------ */
await initApp({ page: 'mesas' });
await reload();
startTicker();

document.getElementById('btn-nueva-mesa').addEventListener('click', () => openMesaForm());
document.getElementById('mesas-grid').addEventListener('click', onGridClick);
