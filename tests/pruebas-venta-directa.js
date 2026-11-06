/* ============================================================
   pruebas-venta-directa.js — Pinta en pantalla los resultados de
   tests/pruebas-venta-directa-casos.js (✔ / ✘ con esperado y obtenido).
   ============================================================ */

import { correrPruebas } from './pruebas-venta-directa-casos.js';

const texto = (tag, clase, contenido) => {
    const el = document.createElement(tag);
    if (clase) el.className = clase;
    el.textContent = contenido;
    return el;
};

function pintar(resultados) {
    const cont = document.getElementById('grupos');
    cont.innerHTML = '';

    const grupos = new Map();
    resultados.forEach((r) => {
        if (!grupos.has(r.grupo)) grupos.set(r.grupo, []);
        grupos.get(r.grupo).push(r);
    });

    grupos.forEach((lista, nombre) => {
        const seccion = document.createElement('section');
        seccion.className = 'card mb-6';

        const header = document.createElement('div');
        header.className = 'card__header';
        const fallidas = lista.filter((r) => !r.ok).length;
        header.appendChild(texto('h2', 'card__title', `${nombre} (${lista.length - fallidas}/${lista.length})`));

        const body = document.createElement('div');
        body.className = 'card__body';
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        const tabla = document.createElement('table');
        tabla.className = 'table';

        const thead = document.createElement('thead');
        const trh = document.createElement('tr');
        ['Caso', 'Esperado', 'Obtenido', 'Estado'].forEach((t) => trh.appendChild(texto('th', '', t)));
        thead.appendChild(trh);

        const tbody = document.createElement('tbody');
        lista.forEach((r) => {
            const tr = document.createElement('tr');
            if (!r.ok) tr.classList.add('fila-fail');
            tr.append(
                texto('td', 'celda-caso', r.nombre),
                texto('td', 'valor-esperado', r.esperado),
                texto('td', `valor-obtenido${r.ok ? '' : ' is-wrong'}`, r.obtenido),
                texto('td', r.ok ? 'result-ok' : 'result-fail', r.ok ? '✔' : '✘')
            );
            tbody.appendChild(tr);
        });

        tabla.append(thead, tbody);
        wrap.appendChild(tabla);
        body.appendChild(wrap);
        seccion.append(header, body);
        cont.appendChild(seccion);
    });
}

const resumen = document.getElementById('resumen');
try {
    const resultados = await correrPruebas();
    pintar(resultados);
    const fallidas = resultados.filter((r) => !r.ok).length;
    const ok = fallidas === 0;
    resumen.className = `resumen ${ok ? 'resumen--ok' : 'resumen--fail'}`;
    resumen.textContent = ok
        ? `✔ ${resultados.length} pruebas pasadas, 0 fallidas`
        : `✘ ${fallidas} de ${resultados.length} pruebas fallidas`;
    document.title = `${ok ? '✔' : '✘'} Pruebas de venta directa · Sistema de Billar`;
} catch (e) {
    resumen.className = 'resumen resumen--fail';
    resumen.textContent = `Error ejecutando las pruebas: ${e.message}`;
    console.error(e);
}
