# Sistema de Gestión de Salón de Billar

Aplicación web **100% frontend** (HTML5, CSS3 y JavaScript ES6+ sin frameworks) para
administrar un salón de billar: mesas en tiempo real, consumos por persona, cobro por
tiempo, productos, gastos, reportes y respaldos de datos.

## Requisitos

- [Visual Studio Code](https://code.visualstudio.com/) con la extensión **Live Server**.
- Un navegador moderno (Chrome, Edge o Firefox).

No necesita servidor, base de datos ni dependencias: los datos se guardan en el
`localStorage` del navegador.

## Cómo ejecutar

1. Abrir la carpeta del proyecto en VS Code.
2. Abrir `index.html` → clic derecho → **Open with Live Server**.
3. El navegador abrirá el dashboard (`pages/dashboard/dashboard.html`).

> Es obligatorio usar Live Server (o cualquier servidor estático): las páginas usan
> módulos ES6 (`type="module"`), que no funcionan abriendo el archivo con `file://`.

## Estructura

```
sistema-billar/
├── index.html                  Redirige al dashboard
├── css/                        variables, temas (claro/oscuro), estilos globales, responsive
├── js/
│   ├── app.js                  Inicialización común (tema, navegación, demo)
│   ├── storage.js              Único módulo que toca localStorage (prefijo "billar:")
│   ├── db.js                   API de datos asíncrona (mesas, sesiones, productos, gastos, config)
│   ├── billing.js              Regla única de cobro por tiempo
│   ├── utils.js                Formateo, modales, notificaciones, confirmaciones
│   ├── theme.js                Tema claro/oscuro persistente
│   ├── navigation.js           Sidebar y menú (definidos una sola vez)
│   ├── comprobante.js          Comprobante imprimible (sesiones de mesa y ventas directas)
│   ├── venta-directa.js        Funciones puras: teléfono, mensaje y enlace de WhatsApp
│   ├── venta-directa-ui.js     Ventana final de una venta (imprimir / WhatsApp)
│   └── reports.js              Agregaciones y gráficos SVG hechos a mano
├── pages/
│   ├── dashboard/              Resumen del día/mes y accesos rápidos
│   ├── mesas/                  Mesas, sesiones en vivo, consumos, cobro
│   ├── venta-directa/          Venta de productos sin mesa: cobro, comprobante, WhatsApp
│   ├── productos/              Catálogo con precios, stock e imágenes
│   ├── ventas/                 Historial de sesiones cobradas y canceladas
│   ├── gastos/                 Gastos del salón con categoría y filtros
│   ├── reportes/               Ingresos, gastos, utilidad y gráficos por rango
│   └── configuracion/          Nombre del salón, tema, exportar/importar, demo, borrar
└── tests/                      Pruebas del navegador (billing.js y venta directa)
```

## Funcionalidades

- **Mesas**: crear/editar/desactivar mesas, iniciar sesión con personas, consumos en vivo
  con cantidades, contador y cobro en tiempo real, cancelación con motivo.
- **Cobro**: regla única en `js/billing.js` — horas completas × tarifa + adicional por
  fracción (0–9 min = 0, 10–29 = minuto, 30–59 = media hora + minuto), vuelto y
  comprobante imprimible (`window.print()`).
- **Venta directa**: vende productos sin abrir una mesa. Formulario (cliente, teléfono
  opcional, mesa de referencia opcional), catálogo con buscador y categorías, stock
  respetado, modal de cobro (Efectivo con vuelto en tiempo real, Yape/Plin con detalle
  del vuelto, Tarjeta, Otro), comprobante imprimible y envío por WhatsApp
  (`https://wa.me/51<9 dígitos>?text=…`). Si el cliente queda vacío se guarda como
  «Cliente general». La mesa es solo una referencia: no modifica ninguna sesión.
  **Varios clientes a la vez**: el botón «＋ Agregar cliente» abre una pestaña nueva con su
  propio nombre, teléfono, mesa y productos. Cada cliente se cobra por separado (una venta
  y un comprobante por cliente); al cobrar, solo esa pestaña se cierra y las demás siguen
  abiertas. El stock se comparte: lo que una cuenta aparta no se puede vender en otra.
  Las cuentas abiertas viven en pantalla (no se guardan hasta cobrarlas); el navegador avisa
  si intentas cerrar la pestaña con cuentas pendientes.
  Las ventas pagadas suman a Dashboard y Reportes; en el Historial se filtran por
  *Tipo* y pueden anularse (devuelven el stock y dejan de sumar).
- **Productos**: CRUD con categorías, precio, estado, stock opcional e imagen
  (URL o archivo ≤ 300 KB).
- **Historial**: sesiones cobradas y canceladas con filtros por fecha, estado, método
  de pago y mesa; detalle y comprobante.
- **Gastos**: CRUD con categorías fijas, filtros por mes/búsqueda y KPIs.
- **Reportes**: rangos rápidos (hoy, 7 días, mes, todo), ingresos por día, gastos por
  categoría, ingresos por método de pago, top productos y sesiones por hora (gráficos
  SVG sin librerías).
- **Configuración**: nombre del salón, pie de comprobante, tema, exportar/importar
  respaldo JSON, restaurar datos demo y borrar todo.
- **Dinero** siempre en soles con 2 decimales; internamente se usa redondeo a
  centavos. **Fechas** en zona horaria `America/Lima`.

## Datos y respaldos

- Todo se guarda en `localStorage` con el prefijo `billar:` (colecciones: `mesas`,
  `sesiones`, `productos`, `gastos`, `ventasDirectas`, `config`).
- Los respaldos anteriores a la Venta directa (sin la colección `ventasDirectas`) se
  siguen importando sin problema.
- El nombre del salón sale de **Configuración → Nombre del salón** y se usa en el menú,
  el comprobante y el mensaje de WhatsApp (por defecto: «Billar Punto 8»).
- **Primera ejecución**: se crean datos de demo (4 mesas y 5 productos).
- **Exportar JSON** descarga un respaldo completo; **Importar JSON** lo valida antes de
  reemplazar los datos (si el archivo es inválido no se modifica nada).
- **Borrar todos los datos** deja el sistema vacío y evita que la demo vuelva a crearse.

## Checklist manual de la Venta directa

1. **Efectivo con vuelto**: agrega productos, «Cobrar», método Efectivo, paga con más del
   total → el vuelto aparece al escribir; confirma y revisa Historial, Dashboard y Reportes.
2. **Yape con detalle**: método Yape, escribe «descripción del vuelto» → aparece en el
   comprobante y en el mensaje de WhatsApp.
3. **Sin teléfono**: en la ventana final, «Enviar por WhatsApp» pide el número (9 dígitos).
4. **Con teléfono**: se usa automáticamente el ingresado en el formulario.
5. **Stock agotado**: un producto con stock 0 aparece deshabilitado; no se puede superar
   el stock con +/− ni escribiendo la cantidad.
6. **Anulación**: Historial → Tipo «Venta directa» → Anular; el stock vuelve y los
   reportes dejan de contar la venta.
7. **Imprimir**: «Imprimir» muestra el comprobante y `window.print()` imprime solo el ticket.
8. **Varios clientes**: pulsa «＋ Agregar cliente», arma una venta distinta en cada pestaña,
   cobra una y comprueba que la otra sigue intacta; con un producto de stock 2, aparta
   las 2 unidades en una cuenta y verifica que en la otra queda «Stock libre: 0».
9. **Exportar / importar**: exporta un respaldo con ventas directas e impórtalo; importa
   también un respaldo antiguo (sin `ventasDirectas`).

## Pruebas

- `tests/pruebas-billing.html` — suite de la regla de cobro (52 casos). Abrirla con
  Live Server: los resultados (✔/✘) se pintan automáticamente en las tablas.
- `tests/pruebas-venta-directa.html` — suite de la Venta directa (81 casos): totales,
  vuelto, teléfono, creación con stock, validaciones, anulación, reportes, enlace de
  WhatsApp e importación de respaldos antiguos. Antes de correr respalda tu
  `localStorage` y al terminar lo restaura, así que tus datos reales no se pierden.

## Fases de desarrollo

| Fase | Contenido | Estado |
|------|-----------|--------|
| 0 | Análisis y especificación (`FASE-0-ANALISIS.md`) | ✅ |
| 1 | Base: HTML, CSS, storage, db, tema, navegación | ✅ |
| 2 | `billing.js` + pruebas de la regla de cobro | ✅ |
| 3 | Mesas: CRUD, sesiones, detalle en vivo | ✅ |
| 4 | Productos + consumos dentro de la sesión | ✅ |
| 5 | Cobro, vuelto, comprobante imprimible, historial | ✅ |
| 6 | Gastos, reportes y dashboard | ✅ |
| 7 | Configuración, respaldos, README y revisión final | ✅ |
| 8 | Venta directa: datos, página, comprobante, WhatsApp, reportes e historial | ✅ |
