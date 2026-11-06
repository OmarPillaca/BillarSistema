/* ============================================================
    configuracion.js — Nombre del salón, pie de comprobante,
    tema, exportar/importar JSON, restaurar demo y borrar todo.
    ============================================================ */

import { initApp } from '../../js/app.js';
import { db } from '../../js/db.js';
import { setTheme, resolveTheme, applyTheme } from '../../js/theme.js';
import { confirmAction, notify, todayISO } from '../../js/utils.js';

/* ------------------- Arranque (al final del archivo) -------- */
let configActual = await initApp({ page: 'configuracion' });
await recargar();

document.getElementById('btn-guardar-cfg').addEventListener('click', guardarConfig);
document.getElementById('cfg-tema').addEventListener('click', onTemaClick);
document.getElementById('btn-exportar').addEventListener('click', exportarDatos);
document.getElementById('btn-importar').addEventListener('click', () => {
    document.getElementById('input-importar').click();
});
document.getElementById('input-importar').addEventListener('change', onImportarArchivo);
document.getElementById('btn-demo').addEventListener('click', restaurarDemo);
document.getElementById('btn-borrar').addEventListener('click', borrarTodo);

/* ------------------------ Carga/render ---------------------- */
async function recargar() {
    configActual = await db.config.get();
    document.getElementById('cfg-nombre').value = configActual.nombreSalon || '';
    document.getElementById('cfg-pie').value = configActual.pieComprobante || '';
    document.getElementById('cfg-subtitle').textContent =
        'Ajustes generales, apariencia y respaldos de datos';
    applyTheme(resolveTheme());
    syncTema();
    actualizarMarca();
    await actualizarStats();
}

function actualizarMarca() {
    const nombre = (configActual.nombreSalon || 'Salón de Billar').trim() || 'Salón de Billar';
    document.querySelector('.brand__name') && (document.querySelector('.brand__name').textContent = nombre);
}

async function actualizarStats() {
    const [mesas, productos, sesiones, gastos] = await Promise.all([
        db.mesas.getAll({ incluirEliminadas: false }),
        db.productos.getAll(),
        db.sesiones.getAll(),
        db.gastos.getAll(),
    ]);
    document.getElementById('cfg-st-mesas').textContent = String(mesas.length);
    document.getElementById('cfg-st-productos').textContent = String(productos.length);
    document.getElementById('cfg-st-sesiones').textContent = String(sesiones.length);
    document.getElementById('cfg-st-gastos').textContent = String(gastos.length);

    let kb = 0;
    try {
        const texto = JSON.stringify(await db.exportAll());
        kb = texto.length / 1024;
    } catch {
        kb = 0;
    }
    document.getElementById('cfg-st-tamano').textContent = `${kb.toFixed(1)} KB`;
}

function syncTema() {
    const actual = resolveTheme();
    document.querySelectorAll('#cfg-tema [data-tema]').forEach((btn) => {
        const activo = btn.dataset.tema === actual;
        btn.classList.toggle('active', activo);
        btn.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
}

/* ------------------------ General --------------------------- */
function guardarConfig() {
    clearFieldErrors(document);
    const nombre = document.getElementById('cfg-nombre').value.trim();
    const pie = document.getElementById('cfg-pie').value.trim();

    if (!nombre) {
        showFieldError(document, 'cfg-nombre', 'El nombre del salón es obligatorio.');
        return;
    }
    if (nombre.length > 80) {
        showFieldError(document, 'cfg-nombre', 'El nombre no puede superar los 80 caracteres.');
        return;
    }
    if (pie.length > 120) {
        showFieldError(document, 'cfg-pie', 'El pie no puede superar los 120 caracteres.');
        return;
    }

    db.config
        .update({ nombreSalon: nombre, pieComprobante: pie })
        .then(async () => {
            notify('✓ Configuración guardada', 'success');
            await recargar();
        })
        .catch((err) => notify(err.message, 'error'));
}

async function onTemaClick(e) {
    const btn = e.target.closest('[data-tema]');
    if (!btn) return;
    const tema = await setTheme(btn.dataset.tema);
    syncTema();
    notify(tema === 'oscuro' ? '🌙 Tema oscuro aplicado' : '☀️ Tema claro aplicado', 'info');
}

/* ------------------- Exportar / importar -------------------- */
async function exportarDatos() {
    try {
        const datos = await db.exportAll();
        descargarJson(`respaldo-billar-${todayISO()}.json`, datos);
        notify('✓ Respaldo exportado (JSON descargado)', 'success');
    } catch (err) {
        notify(`No se pudo exportar: ${err.message}`, 'error');
    }
}

function descargarJson(nombreArchivo, datos) {
    const texto = JSON.stringify(datos, null, 2);
    let url;
    let revocar = false;
    try {
        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
            url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
            revocar = true;
        } else {
            url = 'data:application/json;charset=utf-8,' + encodeURIComponent(texto);
        }
    } catch {
        url = 'data:application/json;charset=utf-8,' + encodeURIComponent(texto);
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revocar) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* noop */
        }
    }
}

async function leerArchivo(file) {
    if (typeof file.text === 'function') return file.text();
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('No se pudo leer el archivo.'));
        fr.readAsText(file);
    });
}

async function onImportarArchivo() {
    const input = document.getElementById('input-importar');
    const file = input.files && input.files[0];
    if (!file) return;

    try {
        const texto = await leerArchivo(file);
        let datos;
        try {
            datos = JSON.parse(texto);
        } catch {
            throw new Error('El archivo no contiene JSON válido.');
        }

        const ok = await confirmAction({
            title: 'Importar respaldo',
            message:
                'Se reemplazarán TODOS los datos actuales por los del archivo. Esta acción no se puede deshacer. ¿Continuar?',
            confirmText: 'Sí, importar',
            danger: true,
        });
        if (!ok) return;

        await db.importAll(datos);
        notify('✓ Respaldo importado correctamente', 'success');
        await recargar();
    } catch (err) {
        notify(err.message || 'No se pudo importar el archivo.', 'error');
    } finally {
        input.value = '';
    }
}

/* ---------------- Restaurar demo / borrar ------------------ */
async function restaurarDemo() {
    const ok = await confirmAction({
        title: 'Restaurar datos demo',
        message:
            'Se reemplazarán TODOS los datos actuales por la demo (4 mesas y 5 productos de ejemplo). Esta acción no se puede deshacer. ¿Continuar?',
        confirmText: 'Sí, restaurar',
        danger: true,
    });
    if (!ok) return;

    try {
        await db.seedDemo({ reemplazar: true });
        notify('✓ Datos demo restaurados', 'success');
        await recargar();
    } catch (err) {
        notify(err.message, 'error');
    }
}

async function borrarTodo() {
    const ok = await confirmAction({
        title: 'Borrar todos los datos',
        message:
            'Se eliminarán mesas, sesiones, productos, gastos y la configuración del salón. Esta acción no se puede deshacer. ¿Continuar?',
        confirmText: 'Sí, borrar todo',
        danger: true,
    });
    if (!ok) return;

    try {
        await db.clearAll();
        notify('✓ Todos los datos fueron eliminados', 'success');
        await recargar();
    } catch (err) {
        notify(err.message, 'error');
    }
}

/* ---------------------- Utilidades UI ----------------------- */
function showFieldError(scope, inputId, message) {
    const input = scope.querySelector(`#${inputId}`);
    const error = scope.querySelector(`[data-error-for="${inputId}"]`);
    if (input) input.setAttribute('aria-invalid', 'true');
    if (error) {
        error.textContent = message;
        error.hidden = false;
        error.closest('.form-group')?.classList.add('is-invalid');
    }
}

function clearFieldErrors(scope) {
    scope.querySelectorAll('.form-error[data-error-for]').forEach((e) => {
        e.hidden = true;
        e.textContent = '';
        e.closest('.form-group')?.classList.remove('is-invalid');
    });
    scope.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
}
