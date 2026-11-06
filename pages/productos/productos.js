/* ============================================================
   productos.js — Catálogo de productos: CRUD, búsqueda,
   filtros (categoría y estado), orden y control de stock.
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

/* ------------------------- Estado --------------------------- */
const state = {
    productos: [],
    filtros: { q: '', categoria: '', estado: '', orden: 'nombre-asc' },
};

const IMAGEN_MAX_CHARS = 400000; // ~300 KB en base64, cuida la cuota de localStorage

/* ------------------- Arranque (al final del archivo) -------- */
await initApp({ page: 'productos' });
await reload();

document.getElementById('btn-nuevo-producto').addEventListener('click', () => openProductoForm());
document.getElementById('productos-grid').addEventListener('click', onGridClick);
document.getElementById('filtro-busqueda').addEventListener('input', (e) => {
    state.filtros.q = e.target.value;
    render();
});
document.getElementById('filtro-categoria').addEventListener('change', (e) => {
    state.filtros.categoria = e.target.value;
    render();
});
document.getElementById('filtro-estado').addEventListener('change', (e) => {
    state.filtros.estado = e.target.value;
    render();
});
document.getElementById('filtro-orden').addEventListener('change', (e) => {
    state.filtros.orden = e.target.value;
    render();
});

/* ------------------------ Carga/render ---------------------- */
async function reload() {
    state.productos = sortBy(await db.productos.getAll({ incluirEliminados: false }), (p) => p.nombre);
    renderFiltroCategorias();
    render();
}

function renderFiltroCategorias() {
    const select = document.getElementById('filtro-categoria');
    const actual = state.filtros.categoria;
    const categorias = [...new Set(state.productos.map((p) => p.categoria).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'es')
    );

    select.innerHTML = '<option value="">Todas</option>';
    categorias.forEach((cat) => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (cat === actual) opt.selected = true;
        select.appendChild(opt);
    });

    // Si la categoría filtrada ya no existe, limpiar el filtro.
    if (actual && !categorias.includes(actual)) {
        state.filtros.categoria = '';
        select.value = '';
    }
}

function filteredProducts() {
    let list = [...state.productos];

    if (state.filtros.q) list = list.filter((p) => includesText(p.nombre, state.filtros.q));
    if (state.filtros.categoria) list = list.filter((p) => p.categoria === state.filtros.categoria);
    if (state.filtros.estado) list = list.filter((p) => p.estado === state.filtros.estado);

    switch (state.filtros.orden) {
        case 'nombre-desc':
            return sortBy(list, (p) => p.nombre, 'desc');
        case 'precio-asc':
            return sortBy(list, (p) => p.precio, 'asc');
        case 'precio-desc':
            return sortBy(list, (p) => p.precio, 'desc');
        case 'recientes':
            return [...list].reverse();
        case 'nombre-asc':
        default:
            return sortBy(list, (p) => p.nombre);
    }
}

function render() {
    const grid = document.getElementById('productos-grid');
    const vacio = document.getElementById('productos-vacio');
    const lista = filteredProducts();
    grid.innerHTML = '';

    const hayFiltro = Boolean(state.filtros.q || state.filtros.categoria || state.filtros.estado);

    if (lista.length === 0) {
        vacio.classList.remove('hidden');
        if (state.productos.length === 0) {
            document.getElementById('productos-vacio-titulo').textContent = 'No hay productos';
            document.getElementById('productos-vacio-texto').textContent =
                'Crea tu primer producto para poder venderlo en las mesas.';
        } else {
            document.getElementById('productos-vacio-titulo').textContent = 'Sin resultados';
            document.getElementById('productos-vacio-texto').textContent = hayFiltro
                ? 'Ningún producto coincide con la búsqueda o los filtros aplicados.'
                : 'No hay productos que mostrar.';
        }
        renderSubtitle(lista);
        return;
    }
    vacio.classList.add('hidden');

    lista.forEach((p) => {
        const card = document.createElement('article');
        card.className = `producto-card${p.estado === 'INACTIVO' ? ' producto-card--inactivo' : ''}`;
        card.dataset.producto = p.id;

        const media = p.imagen
            ? `<div class="producto-card__media"><img src="${escapeHtml(p.imagen)}" alt="" loading="lazy" data-img></div>`
            : `<div class="producto-card__media"><span class="producto-card__placeholder" aria-hidden="true">🍽️</span></div>`;

        card.innerHTML = `
            ${media}
            <div class="producto-card__body">
                <div class="producto-card__head">
                    <h2 class="producto-card__name">${escapeHtml(p.nombre)}</h2>
                    <span class="badge ${p.estado === 'ACTIVO' ? 'badge--success' : 'badge--gray'}">${
                        p.estado === 'ACTIVO' ? 'ACTIVO' : 'INACTIVO'
                    }</span>
                </div>
                ${p.categoria ? `<span class="producto-card__cat">${escapeHtml(p.categoria)}</span>` : ''}
                <p class="producto-card__price">${formatCurrency(p.precio)}</p>
                <p class="producto-card__stock ${stockClass(p.stock)}">${stockText(p.stock)}</p>
                <p class="producto-card__id" title="${escapeHtml(p.id)}">ID: ${escapeHtml(p.id)}</p>
            </div>
            <div class="producto-card__actions">
                <button type="button" class="btn btn--sm ${
                    p.estado === 'ACTIVO' ? 'btn--secondary' : 'btn--success'
                }" data-action="toggle">${p.estado === 'ACTIVO' ? 'Desactivar' : 'Activar'}</button>
                <button type="button" class="icon-btn" data-action="editar" aria-label="Editar ${escapeHtml(
                    p.nombre
                )}" title="Editar">✎</button>
                <button type="button" class="icon-btn icon-btn--danger" data-action="eliminar" aria-label="Eliminar ${escapeHtml(
                    p.nombre
                )}" title="Eliminar">🗑</button>
            </div>`;

        grid.appendChild(card);
    });

    renderSubtitle(lista);
}

function renderSubtitle(lista) {
    const total = state.productos.length;
    const activos = state.productos.filter((p) => p.estado === 'ACTIVO').length;
    const texto =
        total === 0
            ? 'Aún no hay productos registrados'
            : `${total} producto${total === 1 ? '' : 's'} · ${activos} activo${activos === 1 ? '' : 's'}${
                  lista.length !== total ? ` · ${lista.length} en la vista actual` : ''
              }`;
    document.getElementById('productos-subtitle').textContent = texto;
}

function stockText(stock) {
    if (stock === null || stock === undefined) return 'Sin control de stock';
    if (stock === 0) return 'Agotado (stock: 0)';
    if (stock <= 5) return `Stock bajo: ${stock} unidades`;
    return `Stock: ${stock} unidades`;
}

function stockClass(stock) {
    if (stock === null || stock === undefined) return '';
    if (stock === 0) return 'producto-card__stock--agotado';
    if (stock <= 5) return 'producto-card__stock--bajo';
    return '';
}

/* ------------------------ Acciones -------------------------- */
function onGridClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const card = btn.closest('[data-producto]');
    if (!card) return;
    const producto = state.productos.find((p) => p.id === card.dataset.producto);
    if (!producto) return;

    switch (btn.dataset.action) {
        case 'toggle':
            toggleProducto(producto);
            break;
        case 'editar':
            openProductoForm(producto);
            break;
        case 'eliminar':
            deleteProducto(producto);
            break;
        default:
            break;
    }
}

async function toggleProducto(producto) {
    try {
        const nuevo = producto.estado === 'ACTIVO' ? 'INACTIVO' : 'ACTIVO';
        await db.productos.update(producto.id, { estado: nuevo });
        notify(
            `✓ "${producto.nombre}" ${nuevo === 'ACTIVO' ? 'activado' : 'desactivado'}${
                nuevo === 'INACTIVO' ? ': no aparecerá para agregar a las mesas' : ''
            }`,
            'success'
        );
        await reload();
    } catch (err) {
        notify(err.message, 'error');
    }
}

async function deleteProducto(producto) {
    const ok = await confirmAction({
        title: 'Eliminar producto',
        message: `¿Eliminar "${producto.nombre}"? Dejará de aparecer en el catálogo; las ventas anteriores se conservan con su precio histórico.`,
        confirmText: 'Sí, eliminar',
        danger: true,
    });
    if (!ok) return;

    try {
        await db.productos.delete(producto.id);
        notify(`✓ Producto "${producto.nombre}" eliminado`, 'success');
        await reload();
    } catch (err) {
        notify(err.message, 'error');
    }
}

/* ------------------ Modal crear/editar ---------------------- */
function productoFormHtml(producto) {
    return `
        ${producto ? `<p class="form-hint mono mb-4">ID: ${escapeHtml(producto.id)}</p>` : ''}
        <div class="form-grid">
            <div class="form-group">
                <label class="form-label" for="prod-nombre">Nombre <span class="req">*</span></label>
                <input class="form-input" id="prod-nombre" type="text" maxlength="60" autocomplete="off"
                    placeholder="Ej. Gaseosa" value="${escapeHtml(producto?.nombre ?? '')}">
                <span class="form-error" data-error-for="prod-nombre" hidden></span>
            </div>
            <div class="form-group">
                <label class="form-label" for="prod-categoria">Categoría</label>
                <input class="form-input" id="prod-categoria" type="text" maxlength="40" autocomplete="off"
                    list="lista-categorias" placeholder="Opcional (Ej. Bebidas)"
                    value="${escapeHtml(producto?.categoria ?? '')}">
                <datalist id="lista-categorias"></datalist>
            </div>
            <div class="form-group">
                <label class="form-label" for="prod-precio">Precio (S/) <span class="req">*</span></label>
                <input class="form-input" id="prod-precio" type="number" min="0" step="0.5" inputmode="decimal"
                    value="${producto ? producto.precio : ''}">
                <span class="form-error" data-error-for="prod-precio" hidden></span>
                <span class="form-hint">No puede ser negativo.</span>
            </div>
            <div class="form-group">
                <label class="form-label" for="prod-estado">Estado</label>
                <select class="form-select" id="prod-estado">
                    <option value="ACTIVO" ${!producto || producto.estado === 'ACTIVO' ? 'selected' : ''}>Activo</option>
                    <option value="INACTIVO" ${producto && producto.estado === 'INACTIVO' ? 'selected' : ''}>Inactivo</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="prod-stock">Stock</label>
                <input class="form-input" id="prod-stock" type="number" min="0" step="1" inputmode="numeric"
                    placeholder="Vacío = sin control" value="${producto && producto.stock !== null ? producto.stock : ''}">
                <span class="form-error" data-error-for="prod-stock" hidden></span>
                <span class="form-hint">Entero ≥ 0. Vacío si no controlas stock.</span>
            </div>
            <div class="form-group">
                <label class="form-label" for="prod-imagen-url">Imagen (URL)</label>
                <input class="form-input" id="prod-imagen-url" type="url" maxlength="2048"
                    placeholder="https://…" value="${producto && producto.imagen && !String(producto.imagen).startsWith('data:')
                      ? escapeHtml(producto.imagen)
                      : ''}">
                <span class="form-error" data-error-for="prod-imagen-url" hidden></span>
                <label class="form-label mt-2" for="prod-imagen-archivo">…o subir archivo pequeño</label>
                <input class="form-input imagen-file" id="prod-imagen-archivo" type="file" accept="image/*">
                <span class="form-hint">Máx. ~300 KB (se guarda en el navegador).</span>
                <div class="imagen-preview" id="imagen-preview" hidden>
                    <img id="imagen-preview-img" alt="Vista previa">
                    <button type="button" class="btn btn--sm btn--secondary" id="btn-quitar-imagen">Quitar imagen</button>
                </div>
            </div>
        </div>`;
}

function openProductoForm(producto = null) {
    const footer = `
        <button type="button" class="btn btn--secondary" data-close>Cancelar</button>
        <button type="button" class="btn btn--primary" id="btn-guardar-producto">${producto ? 'Guardar cambios' : 'Crear producto'}</button>`;

    const modal = openModal({
        title: producto ? `Editar ${producto.nombre}` : 'Nuevo producto',
        content: productoFormHtml(producto),
        footer,
        size: 'lg',
    });

    const root = modal.root;
    let imagenData = producto?.imagen ?? null;

    // Datalist de categorías existentes
    const datalist = root.querySelector('#lista-categorias');
    [...new Set(state.productos.map((p) => p.categoria).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'es'))
        .forEach((cat) => {
            const opt = document.createElement('option');
            opt.value = cat;
            datalist.appendChild(opt);
        });

    const preview = root.querySelector('#imagen-preview');
    const previewImg = root.querySelector('#imagen-preview-img');

    function updatePreview() {
        if (imagenData) {
            previewImg.src = imagenData;
            preview.hidden = false;
        } else {
            previewImg.removeAttribute('src');
            preview.hidden = true;
        }
    }
    updatePreview();

    root.querySelector('#prod-imagen-url').addEventListener('input', (e) => {
        imagenData = e.target.value.trim() || null;
        updatePreview();
    });

    root.querySelector('#prod-imagen-archivo').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (file.size > 310000) {
            notify('La imagen supera el tamaño máximo (~300 KB). Usa una URL o una imagen más pequeña.', 'error');
            e.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            imagenData = String(reader.result);
            root.querySelector('#prod-imagen-url').value = '';
            updatePreview();
        };
        reader.onerror = () => notify('No se pudo leer la imagen.', 'error');
        reader.readAsDataURL(file);
    });

    root.querySelector('#btn-quitar-imagen').addEventListener('click', () => {
        imagenData = null;
        root.querySelector('#prod-imagen-url').value = '';
        root.querySelector('#prod-imagen-archivo').value = '';
        updatePreview();
    });

    root.querySelector('[data-close]').addEventListener('click', () => modal.close());

    root.querySelector('#btn-guardar-producto').addEventListener('click', async () => {
        clearFieldErrors(root);
        const nombre = root.querySelector('#prod-nombre').value.trim();
        const categoria = root.querySelector('#prod-categoria').value.trim();
        const precio = toNumber(root.querySelector('#prod-precio').value);
        const estado = root.querySelector('#prod-estado').value;
        const stockRaw = root.querySelector('#prod-stock').value.trim();

        let valido = true;
        if (!nombre) {
            showFieldError(root, 'prod-nombre', 'El nombre del producto es obligatorio.');
            valido = false;
        }
        if (root.querySelector('#prod-precio').value === '' || !Number.isFinite(precio) || precio < 0) {
            showFieldError(root, 'prod-precio', 'El precio debe ser un número no negativo.');
            valido = false;
        }
        if (stockRaw !== '') {
            const stock = Number(stockRaw);
            if (!Number.isInteger(stock) || stock < 0) {
                showFieldError(root, 'prod-stock', 'El stock debe ser un entero ≥ 0 (o vacío).');
                valido = false;
            }
        }
        if (!valido) return;

        const datos = {
            nombre,
            categoria,
            precio,
            estado,
            stock: stockRaw === '' ? null : Number(stockRaw),
            imagen: imagenData,
        };

        try {
            if (producto) {
                await db.productos.update(producto.id, datos);
                notify(`✓ Producto "${nombre}" actualizado`, 'success');
            } else {
                await db.productos.create(datos);
                notify(`✓ Producto "${nombre}" creado`, 'success');
            }
            modal.close();
            await reload();
        } catch (err) {
            notify(err.message, 'error');
        }
    });

    root.querySelector('#prod-nombre').focus();
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
