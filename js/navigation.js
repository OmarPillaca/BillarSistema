/* ============================================================
   navigation.js — Sidebar y encabezado definidos UNA sola vez
   Se insertan en todas las páginas; el menú nunca se copia
   en los HTML. Los enlaces se resuelven con data-base del body.
   ============================================================ */

import { formatDate } from './utils.js';
import { syncThemeButtons } from './theme.js';

const NAV_ITEMS = [
    { key: 'dashboard', label: 'Dashboard', icon: '📊', href: 'pages/dashboard/dashboard.html' },
    { key: 'mesas', label: 'Mesas', icon: '🎱', href: 'pages/mesas/mesas.html' },
    { key: 'venta-directa', label: 'Venta directa', icon: '💵', href: 'pages/venta-directa/venta-directa.html' },
    { key: 'productos', label: 'Productos', icon: '🛒', href: 'pages/productos/productos.html' },
    { key: 'ventas', label: 'Historial', icon: '🧾', href: 'pages/ventas/ventas.html' },
    { key: 'gastos', label: 'Gastos', icon: '💸', href: 'pages/gastos/gastos.html' },
    { key: 'reportes', label: 'Reportes', icon: '📈', href: 'pages/reportes/reportes.html' },
    { key: 'configuracion', label: 'Configuración', icon: '⚙️', href: 'pages/configuracion/configuracion.html' },
];

/**
 * Construye sidebar + topbar e inyecta la navegación.
 * Idempotente: si ya existe el sidebar, solo actualiza el título.
 * @param {{active?:string, nombreSalon?:string}} options
 */
export function initNavigation({ active = '', nombreSalon = 'Salón de Billar' } = {}) {
    const base = document.body.dataset.base || '';
    const existing = document.getElementById('sidebar');

    if (!existing) {
        /* ---------- Sidebar ---------- */
        const sidebar = document.createElement('aside');
        sidebar.id = 'sidebar';
        sidebar.className = 'sidebar';
        sidebar.setAttribute('aria-label', 'Navegación principal');

        const brand = document.createElement('div');
        brand.className = 'brand';

        const logo = document.createElement('span');
        logo.className = 'brand__logo';
        logo.setAttribute('aria-hidden', 'true');
        logo.textContent = '🎱';

        const brandText = document.createElement('div');
        const brandName = document.createElement('span');
        brandName.className = 'brand__name';
        brandName.textContent = nombreSalon;
        const brandSub = document.createElement('span');
        brandSub.className = 'brand__sub';
        brandSub.textContent = 'Gestión de salón';
        brandText.append(brandName, brandSub);

        brand.append(logo, brandText);

        const nav = document.createElement('nav');
        nav.className = 'nav';
        const list = document.createElement('ul');

        NAV_ITEMS.forEach((item) => {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.className = 'nav__link' + (item.key === active ? ' nav__link--active' : '');
            a.href = base + item.href;
            if (item.key === active) a.setAttribute('aria-current', 'page');

            const icon = document.createElement('span');
            icon.className = 'nav__icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = item.icon;

            const label = document.createElement('span');
            label.textContent = item.label;

            a.append(icon, label);
            li.appendChild(a);
            list.appendChild(li);
        });

        nav.appendChild(list);

        const footer = document.createElement('div');
        footer.className = 'sidebar__footer';

        const themeBtn = document.createElement('button');
        themeBtn.type = 'button';
        themeBtn.className = 'btn btn--secondary btn--block';
        themeBtn.setAttribute('data-theme-toggle', '');
        footer.appendChild(themeBtn);

        sidebar.append(brand, nav, footer);

        /* ---------- Overlay (menú móvil) ---------- */
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.id = 'sidebar-overlay';

        document.body.prepend(overlay);
        document.body.prepend(sidebar);

        /* ---------- Topbar ---------- */
        const main = document.getElementById('main');
        if (main) {
            const topbar = document.createElement('header');
            topbar.className = 'topbar';

            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'icon-btn sidebar-toggle';
            toggle.id = 'sidebar-toggle';
            toggle.setAttribute('aria-label', 'Abrir menú de navegación');
            toggle.setAttribute('aria-expanded', 'false');
            toggle.setAttribute('aria-controls', 'sidebar');
            toggle.textContent = '☰';

            const title = document.createElement('h1');
            title.className = 'topbar__title';
            title.id = 'topbar-title';

            const date = document.createElement('span');
            date.className = 'topbar__date';
            date.textContent = formatDate(Date.now());

            topbar.append(toggle, title, date);
            main.prepend(topbar);
            wireSidebarToggle(toggle, overlay);
        }

        wireOverlayAndKeys(overlay);
        window.addEventListener('resize', () => {
            if (window.innerWidth > 1024) setSidebarOpen(false);
        });
    }

    /* ---------- Título de la página activa ---------- */
    const item = NAV_ITEMS.find((n) => n.key === active);
    const titleEl = document.getElementById('topbar-title');
    if (titleEl) titleEl.textContent = item ? item.label : '';

    syncThemeButtons();
}

function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', open);
    const btn = document.getElementById('sidebar-toggle');
    if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        btn.setAttribute('aria-label', open ? 'Cerrar menú de navegación' : 'Abrir menú de navegación');
        btn.textContent = open ? '✕' : '☰';
    }
    if (open) {
        const first = document.querySelector('#sidebar .nav__link');
        if (first) first.focus();
    }
}

function wireSidebarToggle(toggle, overlay) {
    toggle.addEventListener('click', () => {
        setSidebarOpen(!document.body.classList.contains('sidebar-open'));
    });
    overlay.addEventListener('click', () => setSidebarOpen(false));
}

function wireOverlayAndKeys(overlay) {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        // Si hay un modal abierto, Esc lo cierra a él (no al menú).
        if (document.body.classList.contains('modal-open')) return;
        if (document.body.classList.contains('sidebar-open')) setSidebarOpen(false);
    });
}
