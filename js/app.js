/* ============================================================
   app.js — Inicialización común de todas las páginas
   Contenedor de notificaciones, tema, navegación, datos de
   demostración (solo primera ejecución) y manejo de errores global.
   Cada página importa initApp() y ejecuta solo su lógica.
   ============================================================ */

import { ensureNotificationsContainer, notify } from './utils.js';
import { db } from './db.js';
import { initTheme, bindThemeToggles } from './theme.js';
import { initNavigation } from './navigation.js';

let globalHandlersInstalled = false;

/**
 * Inicializa el sistema común.
 * @param {{page:string}} options page clave de navegación (dashboard, mesas, ...)
 * @returns {Promise<object>} configuración vigente
 */
export async function initApp({ page = '' } = {}) {
    ensureNotificationsContainer();

    /* ---------- Configuración y demo (solo primera ejecución) ---------- */
    let config;
    try {
        config = await db.config.get();
    } catch (err) {
        notify(`No se pudo leer la configuración: ${err.message}`, 'error');
        config = { nombreSalon: 'Salón de Billar' };
    }

    try {
        if (config.datosDemoAplicados === false) {
            const creado = await db.seedDemo();
            if (creado) notify('Datos de demostración creados para empezar.', 'info');
            config = await db.config.get();
        }
    } catch (err) {
        notify(`No se pudieron crear los datos de demostración: ${err.message}`, 'error');
    }

    /* ---------- Tema y navegación ---------- */
    initTheme();
    initNavigation({
        active: page,
        nombreSalon: config.nombreSalon || 'Salón de Billar',
    });
    bindThemeToggles();

    if (!globalHandlersInstalled) {
        installGlobalErrorHandlers();
        globalHandlersInstalled = true;
    }

    return config;
}

/** La aplicación no debe romperse: cualquier error suelto se informa. */
function installGlobalErrorHandlers() {
    window.addEventListener('error', (e) => {
        const msg = e?.error?.message || e?.message || 'error desconocido';
        notify(`Ocurrió un error inesperado: ${msg}`, 'error');
    });

    window.addEventListener('unhandledrejection', (e) => {
        const msg = e?.reason?.message || 'error desconocido';
        notify(`Ocurrió un error: ${msg}`, 'error');
        if (typeof e.preventDefault === 'function') e.preventDefault();
    });
}
