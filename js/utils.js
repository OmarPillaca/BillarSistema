/* ============================================================
   utils.js — Funciones generales compartidas por todas las páginas
   Formato, IDs, validaciones, notificaciones, modales y confirmaciones.
   ============================================================ */

/* ---------------------- Formato --------------------------- */
const fmtCurrency = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fmtDate = new Intl.DateTimeFormat('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Lima',
});
const fmtTime = new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima',
});
const fmtDateTime = new Intl.DateTimeFormat('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima',
});
const fmtIso = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Lima',
});

/** Redondea a 2 decimales evitando errores de coma flotante. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Soles → céntimos enteros (cálculo monetario interno sin coma flotante). */
export const toCents = (soles) => {
    const n = Number(soles);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100);
};

/** Céntimos enteros → soles redondeados a 2 decimales. */
export const centsToSoles = (cents) => Math.round(Number(cents) || 0) / 100;

/** Formato S/ 8.00 (PEN). */
export const formatCurrency = (value) => {
    const n = Number(value);
    return fmtCurrency.format(Number.isFinite(n) ? round2(n) : 0);
};

/** Fecha dd/mm/aaaa en zona horaria de Lima. */
export const formatDate = (ms) => (Number.isFinite(ms) ? fmtDate.format(new Date(ms)) : '—');

/** Hora hh:mm en zona horaria de Lima. */
export const formatTime = (ms) => (Number.isFinite(ms) ? fmtTime.format(new Date(ms)) : '—');

/** Fecha y hora completas. */
export const formatDateTime = (ms) => (Number.isFinite(ms) ? fmtDateTime.format(new Date(ms)) : '—');

/** Fecha actual YYYY-MM-DD (zona Lima) — usada por gastos. */
export const todayISO = () => fmtIso.format(new Date());

/** Timestamp → YYYY-MM-DD (zona Lima). */
export const msToISO = (ms) => (Number.isFinite(ms) ? fmtIso.format(new Date(ms)) : '');

/** YYYY-MM-DD → dd/mm/aaaa (sin desfases de zona horaria). */
export const formatISODate = (iso) => {
    if (!isValidISODate(iso)) return '—';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
};

/** Valida una fecha en formato YYYY-MM-DD real. */
export const isValidISODate = (iso) => {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return false;
    return d.toISOString().slice(0, 10) === iso;
};

/** Segundos → HH:MM:SS (contador en vivo). */
export const formatDuration = (seconds) => {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
};

/** Minutos → HH:MM (comprobantes / historial). */
export const formatDurationShort = (minutes) => {
    const total = Math.max(0, Math.floor(Number(minutes) || 0));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Segundos transcurridos entre dos timestamps. */
export const elapsedSeconds = (startMs, endMs = Date.now()) =>
    Math.max(0, Math.floor((Number(endMs) - Number(startMs)) / 1000));

/* ---------------------- IDs ------------------------------- */
export const generateId = (prefix = 'id') =>
    `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

/* ------------------ Seguridad / texto --------------------- */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa datos de usuario antes de insertarlos como HTML. */
export const escapeHtml = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

/* ------------------ Validaciones -------------------------- */
export const isNonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

/** Convierte a número; devuelve NaN si no es válido. */
export const toNumber = (value) => {
    const raw = typeof value === 'string' ? value.trim().replace(',', '.') : value;
    const n = Number(raw);
    return Number.isFinite(n) ? n : NaN;
};

/** Normaliza texto para búsquedas sin acentos ni mayúsculas. */
export const normalize = (value) =>
    String(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

export const includesText = (haystack, query) =>
    !query || normalize(haystack).includes(normalize(query));

/* ------------------ Ordenamiento -------------------------- */
export const sortBy = (list, key, dir = 'asc') => {
    const get = typeof key === 'function' ? key : (item) => item?.[key];
    const factor = dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
        const va = get(a);
        const vb = get(b);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
        return String(va ?? '').localeCompare(String(vb ?? ''), 'es', { numeric: true }) * factor;
    });
};

export const debounce = (fn, wait = 250) => {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), wait);
    };
};

/* ---------------- Notificaciones (toasts) ----------------- */
let notifContainer = null;

/** Crea el contenedor de notificaciones (aria-live para lectores de pantalla). */
export function ensureNotificationsContainer() {
    const existing = document.getElementById('notifications');
    if (existing) {
        notifContainer = existing;
        return notifContainer;
    }
    const el = document.createElement('div');
    el.id = 'notifications';
    el.className = 'toast-container';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
    notifContainer = el;
    return el;
}

/**
 * Muestra una notificación visual (nunca alert()).
 * @param {string} message Mensaje en español.
 * @param {'success'|'error'|'warning'|'info'} type Tipo de aviso.
 */
export function notify(message, type = 'info') {
    ensureNotificationsContainer();
    const icons = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast__icon';
    icon.textContent = icons[type] ?? 'ℹ';

    const msg = document.createElement('span');
    msg.className = 'toast__msg';
    msg.textContent = String(message);

    toast.append(icon, msg);
    notifContainer.appendChild(toast);

    let timer = setTimeout(dismiss, 4200);
    toast.addEventListener('click', dismiss);

    function dismiss() {
        clearTimeout(timer);
        toast.classList.add('toast--hide');
        setTimeout(() => toast.remove(), 220);
    }
}

/* ------------------------ Modales ------------------------- */
const modalStack = [];

const getFocusable = (root) =>
    Array.from(
        root.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
    ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement);

/**
 * Abre un modal accesible (Esc cierra, foco atrapado, foco devuelto al cerrar).
 * @param {object} options
 * @param {string} options.title Título del encabezado.
 * @param {string|Node} [options.content] HTML de autor (escapar datos de usuario) o Nodo.
 * @param {string|Node} [options.content] El pie del modal.
 * @param {'sm'|'md'|'lg'|'xl'} [options.size] Tamaño.
 * @param {boolean} [options.closable] Si Esc/click externo cierran.
 * @param {(value:any)=>void} [options.onClose] Callback con el valor de cierre.
 * @returns {{root:HTMLElement, body:HTMLElement, close:(v:any)=>void}}
 */
export function openModal({
    title = '',
    content = null,
    footer = null,
    size = 'md',
    closable = true,
    onClose = null,
} = {}) {
    const previousFocus = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const dialog = document.createElement('div');
    dialog.className = `modal modal--${size}`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const titleId = generateId('titulo-modal');
    dialog.setAttribute('aria-labelledby', titleId);
    dialog.setAttribute('tabindex', '-1');

    const header = document.createElement('div');
    header.className = 'modal__header';

    const heading = document.createElement('h2');
    heading.className = 'modal__title';
    heading.id = titleId;
    heading.textContent = title;
    header.appendChild(heading);

    if (closable) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'modal__close';
        closeBtn.setAttribute('aria-label', 'Cerrar ventana');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', () => api.close(undefined));
        header.appendChild(closeBtn);
    }

    const body = document.createElement('div');
    body.className = 'modal__body';
    if (content instanceof Node) body.appendChild(content);
    else if (typeof content === 'string') body.innerHTML = content; // HTML de autor; escapar datos con escapeHtml()

    dialog.append(header, body);

    if (footer) {
        const foot = document.createElement('div');
        foot.className = 'modal__footer';
        if (footer instanceof Node) foot.appendChild(footer);
        else foot.innerHTML = footer;
        dialog.appendChild(foot);
    }

    overlay.appendChild(dialog);

    function onKeydown(e) {
        if (modalStack[modalStack.length - 1] !== api) return;
        if (e.key === 'Escape' && closable) {
            e.preventDefault();
            e.stopPropagation();
            api.close(undefined);
            return;
        }
        if (e.key === 'Tab') {
            const list = getFocusable(dialog);
            if (list.length === 0) {
                e.preventDefault();
                dialog.focus();
                return;
            }
            const first = list[0];
            const last = list[list.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            } else if (!dialog.contains(document.activeElement)) {
                e.preventDefault();
                first.focus();
            }
        }
    }

    const api = {
        root: overlay,
        body,
        dialog,
        close(value) {
            const idx = modalStack.indexOf(api);
            if (idx === -1) return;
            modalStack.splice(idx, 1);
            document.removeEventListener('keydown', onKeydown, true);
            overlay.remove();
            document.body.classList.toggle('modal-open', modalStack.length > 0);
            if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus();
            if (typeof onClose === 'function') onClose(value);
        },
    };

    overlay.addEventListener('mousedown', (e) => {
        if (e.target === overlay && closable) api.close(undefined);
    });
    document.addEventListener('keydown', onKeydown, true);

    modalStack.push(api);
    document.body.appendChild(overlay);
    document.body.classList.add('modal-open');

    const firstTarget = getFocusable(dialog)[0] || dialog;
    firstTarget.focus();

    return api;
}

/** Cierra el modal visible (el más alto de la pila). */
export function closeTopModal() {
    const top = modalStack[modalStack.length - 1];
    if (top) top.close(undefined);
}

/**
 * Confirmación personalizada (sin alert()).
 * @param {object} options
 * @returns {Promise<boolean>} true si el usuario confirma.
 */
export function confirmAction({
    title = 'Confirmar',
    message = '',
    confirmText = 'Confirmar',
    cancelText = 'Cancelar',
    danger = false,
    requireText = null,
} = {}) {
    return new Promise((resolve) => {
        const content = document.createElement('div');

        const msg = document.createElement('p');
        msg.className = 'modal__text';
        msg.textContent = message;
        content.appendChild(msg);

        let input = null;
        let errorEl = null;

        if (requireText) {
            const group = document.createElement('div');
            group.className = 'form-group mt-3';

            const label = document.createElement('label');
            label.className = 'form-label';
            label.textContent = `Escribe "${requireText}" para continuar`;

            input = document.createElement('input');
            input.type = 'text';
            input.className = 'form-input';
            input.autocomplete = 'off';
            input.setAttribute('aria-label', `Escribe ${requireText} para continuar`);

            errorEl = document.createElement('span');
            errorEl.className = 'form-error';
            errorEl.hidden = true;

            group.append(label, input, errorEl);
            content.appendChild(group);
        }

        const footer = document.createElement('div');
        footer.className = 'modal__footer';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn--secondary';
        cancelBtn.textContent = cancelText;

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = danger ? 'btn btn--danger' : 'btn btn--primary';
        okBtn.textContent = confirmText;

        footer.append(cancelBtn, okBtn);

        const modal = openModal({
            title,
            content,
            footer,
            size: 'sm',
            onClose: (value) => resolve(value === true),
        });

        cancelBtn.addEventListener('click', () => modal.close(false));

        okBtn.addEventListener('click', () => {
            if (input && input.value.trim().toLowerCase() !== String(requireText).trim().toLowerCase()) {
                errorEl.hidden = false;
                errorEl.textContent = `El texto no coincide. Debe ser "${requireText}".`;
                input.focus();
                return;
            }
            modal.close(true);
        });

        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    okBtn.click();
                }
            });
        }
    });
}
