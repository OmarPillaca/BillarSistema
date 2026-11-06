/* ============================================================
   storage.js — ÚNICO archivo que toca localStorage
   Lectura/escritura con try/catch, respaldo ante JSON corrupto
   y manejo claro del error de cuota llena (QuotaExceededError).
   ============================================================ */

import { notify } from './utils.js';

const PREFIX = 'billar:';
const BACKUP_PREFIX = 'billar:respaldo:';

let storageOk = null;

/** Comprueba una sola vez que localStorage esté disponible. */
export function isStorageAvailable() {
    if (storageOk !== null) return storageOk;
    try {
        const probe = `${PREFIX}__prueba`;
        localStorage.setItem(probe, '1');
        localStorage.removeItem(probe);
        storageOk = true;
    } catch (err) {
        storageOk = false;
        notify('El navegador no permite guardar datos (localStorage bloqueado). El sistema no podrá conservar información.', 'error');
    }
    return storageOk;
}

/**
 * Lee una colección/valor.
 * - JSON inválido: guarda una copia del texto crudo en `billar:respaldo:*`,
 *   devuelve la colección vacía y avisa al usuario.
 * @param {string} key Clave sin prefijo (ej. "mesas").
 * @param {*} fallback Valor por defecto.
 */
export function read(key, fallback = null) {
    if (!isStorageAvailable()) return fallback;
    let raw = null;
    try {
        raw = localStorage.getItem(PREFIX + key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
    } catch (err) {
        // Respaldo del texto dañado antes de reemplazar por el vacío.
        try {
            localStorage.setItem(`${BACKUP_PREFIX}${key}:${Date.now()}`, raw ?? '');
        } catch (backupErr) {
            // Sin espacio para el respaldo: se ignora, el aviso principal sigue.
        }
        notify(`La información de "${key}" estaba dañada. Se creó un respaldo y se usó una copia vacía.`, 'warning');
        return fallback;
    }
}

/**
 * Escribe un valor. Devuelve false si falla (con aviso claro de cuota llena).
 * @param {string} key Clave sin prefijo.
 * @param {*} value Valor serializable.
 * @returns {boolean}
 */
export function write(key, value) {
    if (!isStorageAvailable()) return false;
    try {
        localStorage.setItem(PREFIX + key, JSON.stringify(value));
        return true;
    } catch (err) {
        if (err && (err.name === 'QuotaExceededError' || err.code === 22)) {
            notify('No hay espacio en el navegador (localStorage lleno). Exporta tus datos y elimina información antigua para continuar.', 'error');
        } else {
            notify(`No se pudo guardar la información de "${key}": ${err?.message || 'error desconocido'}`, 'error');
        }
        return false;
    }
}

/** Elimina una clave. Devuelve true si se eliminó correctamente. */
export function remove(key) {
    if (!isStorageAvailable()) return false;
    try {
        localStorage.removeItem(PREFIX + key);
        return true;
    } catch (err) {
        notify(`No se pudo eliminar la información de "${key}".`, 'error');
        return false;
    }
}

/** Elimina todos los datos con prefijo "billar:" (incluye respaldos). */
export function clearAllKeys() {
    if (!isStorageAvailable()) return false;
    try {
        const doomed = [];
        for (let i = 0; i < localStorage.length; i += 1) {
            const k = localStorage.key(i);
            if (k && k.startsWith(PREFIX)) doomed.push(k);
        }
        doomed.forEach((k) => localStorage.removeItem(k));
        return true;
    } catch (err) {
        notify('No se pudieron eliminar todos los datos.', 'error');
        return false;
    }
}
