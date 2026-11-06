/* ============================================================
   gastos.js — Gastos del salón: CRUD con categoría, monto y
   fecha; filtros por mes/categoría/búsqueda; KPIs.
   ============================================================ */

import { initApp } from '../../js/app.js';
import { db, CATEGORIAS_GASTO } from '../../js/db.js';
import {
    formatCurrency,
    formatISODate,
    msToISO,
    todayISO,
    openModal,
    confirmAction,
    notify,
    escapeHtml,
    toNumber,
    includesText,
    sortBy,
} from '../../js/utils.js';

/* ------------------------- Estado --------------------------- */
const state = {
    gastos: [],
    filtros: { q: '', mes: '', categoria: '', orden: 'fecha-desc' },
};

/* ------------------- Arranque (al final del archivo) -------- */
await initApp({ page: 'gastos' });
await reload();

document.getElementById('btn-nuevo-gasto').addEventListener('click', () => openGastoForm());
document.getElementById('gastos-tbody').addEventListener('click', onTableClick);
document.getElementById('filtro-busqueda').addEventListener('input', (e) => {
    state.filtros.q = e.target.value;
    render();
});
document.getElementById('filtro-mes').addEventListener('change', (e) => {
    state.filtros.mes = e.target.value;
    render();
});
document.getElementById('filtro-categoria').addEventListener('change', (e) => {
    state.filtros.categoria = e.target.value;
    render();
});
document.getElementById('filtro-orden').addEventListener('change', (e) => {
    state.filtros.orden = e.target.value;
    render();
});

/* ------------------------ Carga/render ---------------------- */
async function reload() {
    state.gastos = await db.gastos.getAll();
    renderFiltroCategorias();
    render();
}

function renderFiltroCategorias() {
    const select = document.getElementById('filtro-categoria');
    const actual = state.filtros.categoria;
    select.innerHTML = '<option value="">Todas</option>';
    CATEGORIAS_GASTO.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (cat === actual) opt.selected = true;
        select.appendChild(opt);
    });
    if (actual && !CATEGORIAS_GASTO.includes(actual)) {
        state.filtros.categoria = '';
        select.value = '';
    }
}

function filteredGastos() {
    let list = [...state.gastos];
    const f = state.filtros;

    if (f.q) list = list.filter((g) => includesText(g.descripcion, f.q));
    if (f.mes) list = list.filter((g) => g.fecha.startsWith(f.mes));
    if (f.categoria) list = list.filter((g) => g.categoria === f.categoria);

    switch (f.orden) {
        case 'fecha-asc':
            return list.sort((a, b) => a.fecha.localeCompare(b.fecha));
        case 'monto-desc':
            return sortBy(list, (g) => g.monto, 'desc');
        case 'monto-asc':
            return sortBy(list, (g) => g.monto, 'asc');
        case 'fecha-desc':
        default:
            return list.sort((a, b) => b.fecha.localeCompare(a.fecha));
    }
}

function render() {
    const lista = filteredGastos();
    const tbody = document.getElementById('gastos-tbody');
    const wrap = document.getElementById('gastos-table-wrap');
    const vacio = document.getElementById('gastos-vacio');
    tbody.innerHTML = '';

    const hayFiltro = Boolean(state.filtros.q || state.filtros.mes || state.filtros.categoria);

    if (lista.length === 0) {
        wrap.classList.add('hidden');
        vacio.classList.remove('hidden');
        if (state.gastos.length === 0) {
            document.getElementById('gastos-vacio-titulo').textContent = 'Sin gastos';
            document.getElementById('gastos-vacio-texto').textContent =
                'Registra tu primer gasto para controlar los costos del salón.';
        } else {
            document.getElementById('gastos-vacio-titulo').textContent = 'Sin resultados';
            document.getElementById('gastos-vacio-texto').textContent = hayFiltro
                ? 'Ningún gasto coincide con la búsqueda o los filtros aplicados.'
                : 'No hay gastos que mostrar.';
        }
    } else {
        wrap.classList.remove('hidden');
        vacio.classList.add('hidden');
        lista.forEach((g) => tbody.appendChild(buildRow(g)));
    }

    renderStats(lista);
    renderSubtitle();
}

function buildRow(g) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td data-label="Fecha">${formatISODate(g.fecha)}</td>
        <td data-label="Descripción"><strong>${escapeHtml(g.descripcion)}</strong></td>
        <td data-label="Categoría"><span class="badge badge--info">${escapeHtml(g.categoria)}</span></td>
        <td class="num" data-label="Monto"><strong>${formatCurrency(g.monto)}</strong></td>
        <td class="actions-cell" data-label="Acciones">
            <div class="gasto-acciones">
                <button type="button" class="btn btn--sm btn--secondary" data-editar="${g.id}">Editar</button>
                <button type="button" class="btn btn--sm btn--danger" data-eliminar="${g.id}">Eliminar</button>
            </div>
        </td>`;
    return tr;
}

function renderStats(lista) {
    const totalVista = lista.reduce((a, g) => a + g.monto, 0);
    const mesActual = todayISO().slice(0, 7);
    const totalMes = state.gastos.filter((g) => g.fecha.startsWith(mesActual)).reduce((a, g) => a + g.monto, 0);

    document.getElementById('stat-total-vista').textContent = formatCurrency(totalVista);
    document.getElementById('stat-total-mes').textContent = formatCurrency(totalMes);
    document.getElementById('stat-count').textContent = String(lista.length);
}

function renderSubtitle() {
    const total = state.gastos.length;
    document.getElementById('gastos-subtitle').textContent =
        total === 0
            ? 'Aún no hay gastos registrados'
            : `${total} gasto${total === 1 ? '' : 's'} registrado${total === 1 ? '' : 's'}`;
}

/* ------------------------ Acciones -------------------------- */
function onTableClick(e) {
    const btn = e.target.closest('[data-editar], [data-eliminar]');
    if (!btn) return;
    const gasto = state.gastos.find((g) => g.id === (btn.dataset.editar || btn.dataset.eliminar));
    if (!gasto) return;

    if (btn.dataset.editar) openGastoForm(gasto);
    else deleteGasto(gasto);
}

async function deleteGasto(gasto) {
    const ok = await confirmAction({
        title: 'Eliminar gasto',
        message: `¿Eliminar el gasto "${gasto.descripcion}" (${formatCurrency(gasto.monto)})? Esta acción no se puede deshacer.`,
        confirmText: 'Sí, eliminar',
        danger: true,
    });
    if (!ok) return;

    try {
        await db.gastos.delete(gasto.id);
        notify('✓ Gasto eliminado', 'success');
        await reload();
    } catch (err) {
        notify(err.message, 'error');
    }
}

/* ------------------ Modal crear/editar ---------------------- */
function openGastoForm(gasto = null) {
    const opciones = CATEGORIAS_GASTO.map(
        (c) => `<option value="${c}" ${gasto && gasto.categoria === c ? 'selected' : ''}>${c}</option>`
    ).join('');

    const content = `
        <div class="form-grid">
            <div class="form-group" style="grid-column: 1 / -1;">
                <label class="form-label" for="gasto-descripcion">Descripción <span class="req">*</span></label>
                <input class="form-input" id="gasto-descripcion" type="text" maxlength="120" autocomplete="off"
                    placeholder="Ej. Compra de queroseno" value="${escapeHtml(gasto?.descripcion ?? '')}">
                <span class="form-error" data-error-for="gasto-descripcion" hidden></span>
            </div>
            <div class="form-group">
                <label class="form-label" for="gasto-monto">Monto (S/) <span class="req">*</span></label>
                <input class="form-input" id="gasto-monto" type="number" min="0.01" step="0.5" inputmode="decimal"
                    value="${gasto ? gasto.monto : ''}">
                <span class="form-error" data-error-for="gasto-monto" hidden></span>
                <span class="form-hint">Debe ser mayor que 0.</span>
            </div>
            <div class="form-group">
                <label class="form-label" for="gasto-categoria">Categoría <span class="req">*</span></label>
                <select class="form-select" id="gasto-categoria">
                    <option value="">Selecciona…</option>
                    ${opciones}
                </select>
                <span class="form-error" data-error-for="gasto-categoria" hidden></span>
            </div>
            <div class="form-group">
                <label class="form-label" for="gasto-fecha">Fecha <span class="req">*</span></label>
                <input class="form-input" id="gasto-fecha" type="date" value="${gasto ? gasto.fecha : todayISO()}">
                <span class="form-error" data-error-for="gasto-fecha" hidden></span>
            </div>
        </div>`;

    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" id="btn-guardar-gasto">${gasto ? 'Guardar cambios' : 'Crear gasto'}</button>`;

    const modal = openModal({
        title: gasto ? 'Editar gasto' : 'Nuevo gasto',
        content,
        footer,
        size: 'md',
    });

    const root = modal.root;
    root.querySelector('[data-close]').addEventListener('click', () => modal.close());

    root.querySelector('#btn-guardar-gasto').addEventListener('click', async () => {
        clearFieldErrors(root);
        const descripcion = root.querySelector('#gasto-descripcion').value.trim();
        const monto = toNumber(root.querySelector('#gasto-monto').value);
        const categoria = root.querySelector('#gasto-categoria').value;
        const fecha = root.querySelector('#gasto-fecha').value;

        let valido = true;
        if (!descripcion) {
            showFieldError(root, 'gasto-descripcion', 'La descripción es obligatoria.');
            valido = false;
        }
        if (!Number.isFinite(monto) || monto <= 0) {
            showFieldError(root, 'gasto-monto', 'El monto debe ser un número mayor que 0.');
            valido = false;
        }
        if (!categoria) {
            showFieldError(root, 'gasto-categoria', 'Selecciona una categoría.');
            valido = false;
        }
        if (!fecha) {
            showFieldError(root, 'gasto-fecha', 'Indica la fecha del gasto.');
            valido = false;
        }
        if (!valido) return;

        try {
            if (gasto) {
                await db.gastos.update(gasto.id, { descripcion, monto, categoria, fecha });
                notify('✓ Gasto actualizado', 'success');
            } else {
                await db.gastos.create({ descripcion, monto, categoria, fecha });
                notify(`✓ Gasto "${descripcion}" registrado`, 'success');
            }
            modal.close();
            await reload();
        } catch (err) {
            notify(err.message, 'error');
        }
    });

    root.querySelector('#gasto-descripcion').focus();
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
