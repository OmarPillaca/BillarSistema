/* ============================================================
   theme.js — Modo claro / modo oscuro persistente
   El tema se guarda en config.tema (localStorage) y se aplica
   lo antes posible para evitar parpadeos (ver snippet en HTML).
   ============================================================ */

import { read } from './storage.js';
import { db } from './db.js';

/** Tema del sistema operativo/navegador. */
export function getSystemTheme() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'oscuro'
        : 'claro';
}

/** Tema guardado por el usuario (o null si nunca eligió). */
export function getStoredTheme() {
    const cfg = read('config', null);
    return cfg && (cfg.tema === 'oscuro' || cfg.tema === 'claro') ? cfg.tema : null;
}

/** Tema efectivo: preferencia del usuario o, si no, el del sistema. */
export function resolveTheme() {
    return getStoredTheme() || getSystemTheme();
}

/** Aplica el tema al DOM y sincroniza los botones. */
export function applyTheme(theme) {
    const t = theme === 'oscuro' ? 'oscuro' : 'claro';
    document.documentElement.setAttribute('data-theme', t);
    syncThemeButtons(t);
    return t;
}

/** Aplica y persiste el tema en config.tema. */
export async function setTheme(theme) {
    const t = applyTheme(theme);
    try {
        await db.config.update({ tema: t });
    } catch (err) {
        // No se pudo persistir; el tema sigue aplicado en esta sesión.
        console.warn('No se pudo guardar el tema:', err?.message || err);
    }
    return t;
}

/** Alterna entre oscuro y claro. */
export async function toggleTheme() {
    const siguiente = resolveTheme() === 'oscuro' ? 'claro' : 'oscuro';
    return setTheme(siguiente);
}

/** Actualiza el texto/estado de todos los botones [data-theme-toggle]. */
export function syncThemeButtons(theme = resolveTheme()) {
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
        btn.textContent = theme === 'oscuro' ? '🌙 Oscuro' : '☀️ Claro';
        btn.setAttribute('aria-pressed', theme === 'oscuro' ? 'true' : 'false');
        btn.setAttribute('aria-label', theme === 'oscuro' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    });
}

let delegated = false;

/** Delegación de clics para botones de tema (se registra una sola vez). */
export function bindThemeToggles() {
    if (!delegated) {
        delegated = true;
        document.addEventListener('click', (e) => {
            const btn = e.target.closest?.('[data-theme-toggle]');
            if (btn) {
                e.preventDefault();
                toggleTheme();
            }
        });

        // Si el usuario nunca eligió tema, seguimos los cambios del sistema.
        if (window.matchMedia) {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            mq.addEventListener?.('change', () => {
                if (!getStoredTheme()) applyTheme(getSystemTheme());
            });
        }
    }
    syncThemeButtons();
}

/** Inicialización temprana del tema (llamada por initApp). */
export function initTheme() {
    applyTheme(resolveTheme());
}
