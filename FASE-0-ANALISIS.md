# FASE 0 — ANÁLISIS DEL SISTEMA
## Sistema Profesional de Gestión de Salón de Billar

Documento de análisis previo a la implementación. Define la estructura de carpetas, el modelo de datos y los contratos de los módulos centrales (`db.js` y `billing.js`). Sin código extenso.

---

## 1. ESTRUCTURA COMPLETA DE CARPETAS

```text
sistema-billar/
│
├── index.html                     → redirige al dashboard (meta refresh + JS de respaldo)
│
├── pages/
│   ├── dashboard/                 → dashboard.html · dashboard.css · dashboard.js
│   ├── mesas/                     → mesas.html · mesas.css · mesas.js
│   ├── productos/                 → productos.html · productos.css · productos.js
│   ├── ventas/                    → ventas.html · ventas.css · ventas.js   (historial)
│   ├── gastos/                    → gastos.html · gastos.css · gastos.js
│   ├── reportes/                  → reportes.html · reportes.css · reportes.js
│   └── configuracion/             → configuracion.html · configuracion.css · configuracion.js
│
├── css/
│   ├── variables.css              → tokens de diseño (colores, espaciados, tipografía, radios)
│   ├── themes.css                 → overrides por tema: [data-theme="dark"] | [data-theme="light"]
│   ├── global.css                 → reset, layout base, sidebar, header, tarjetas, tablas,
│   │                                 modales, notificaciones, formularios, badges, @media print
│   └── responsive.css             → breakpoints (≤1024 tablet, ≤768 celular, ≤480 pequeño)
│
├── js/
│   ├── app.js                     → inicialización común: tema temprano, navegación, seed demo,
│   │                                 contenedor de notificaciones. Expone initPage(name)
│   ├── db.js                      → capa de datos asíncrona (Promesas). ÚNICO acceso a storage.js
│   ├── storage.js                 → ÚNICO archivo que toca localStorage (try/catch, cuota, JSON corrupto)
│   ├── billing.js                 → TODA la lógica de facturación (regla única, sección 6)
│   ├── reports.js                 → agregaciones para reportes y dashboard
│   ├── theme.js                   → modo claro/oscuro, aplica tema temprano (sin parpadeo)
│   ├── navigation.js              → sidebar + header definidos UNA sola vez, insertados en todas
│   │                                 las páginas; menú hamburguesa en celular
│   └── utils.js                   → IDs, moneda (Intl es-PE/PEN), fechas (America/Lima),
│                                     validaciones, orden/búsqueda, notificaciones, modales, confirm
│
├── tests/
│   └── pruebas-billing.html       → pruebas visuales de facturación (sección 17) + script embebido
│                                     mínimo que importa ../../js/billing.js
│
├── assets/
│   ├── images/                    → (vacío; imágenes de productos por URL o archivo pequeño)
│   └── icons/                     → (vacío; se usan emojis/SVG inline en navigation.js)
│
└── README.md                      → ejecución con Live Server, módulos y lista de verificación manual
```

### Reglas de rutas (verificadas en cada fase)

| Desde                        | CSS base                          | JS base                           | Entre páginas              |
|------------------------------|-----------------------------------|-----------------------------------|----------------------------|
| `index.html` (raíz)          | `css/global.css`                  | — (solo redirige a `pages/dashboard/dashboard.html`) | `pages/...` |
| `pages/<x>/<x>.html`         | `../../css/variables.css`, `../../css/themes.css`, `../../css/global.css`, `../../css/responsive.css`, `../../pages/<x>/<x>.css` | `../../js/app.js`, `../../js/db.js`, `../../js/billing.js`, … y `./<x>.js` | `../<y>/<y>.html` |
| `tests/pruebas-billing.html` | `../css/…` (opcional)             | `../js/billing.js`, `../js/utils.js` | — |

- Los `import` de cada `pagina.js` siempre: `../../js/...` y `./pagina.js` se carga con `<script type="module" src="./pagina.js">`.
- El sidebar/header se inyecta por `navigation.js`; ninguna HTML repite el menú.

---

## 2. MODELO DE DATOS Y RELACIONES

Claves de `localStorage` con prefijo `billar:`. Acceso **solo** vía `db.js` → `storage.js`.

### 2.1 Colecciones y claves

| Entidad   | Clave              | Índice natural          |
|-----------|--------------------|-------------------------|
| mesa      | `billar:mesas`     | `id`                    |
| sesion    | `billar:sesiones`  | `id`                    |
| producto  | `billar:productos` | `id`                    |
| gasto     | `billar:gastos`    | `id`                    |
| config    | `billar:config`    | objeto único            |
| respaldos | `billar:backup:<clave>` | copia de texto crudo si JSON corrupto (uso interno de storage.js) |
| tema      | `billar:config.tema` (persistido con la config, aplicado por theme.js) |

### 2.2 Entidades (campos y tipos)

```text
mesa
  id: string              (uid("mesa"))
  nombre: string          no vacío, único en la práctica
  tarifaHora: number      soles, > 0 (2 decimales)
  estado: "DISPONIBLE" | "EN_USO" | "INACTIVA"
  eliminada: boolean      borrado lógico (no rompe historial/reportes)
  creadaEn: number        ms
  actualizadaEn: number   ms

sesion                    (una sesión FINALIZADA es, a la vez, la venta)
  id: string              (uid("ses"))
  mesaId: string
  mesaNombre: string      copia al iniciar
  tarifaHora: number      CONGELADA al iniciar (copiada de la mesa)
  inicio: number          ms (Date.now())
  fin: number | null      ms
  estado: "ACTIVA" | "FINALIZADA" | "CANCELADA"
  personas: [ { id: string, nombre: string } ]            ≥ 1 siempre
  consumos: [ { id: string, productoId: string, nombre: string,
                precioUnitario: number (histórico), cantidad: number ≥ 1,
                personaId: string (referencia a personas de esta sesión),
                subtotal: number, creadoEn: number } ]
  cobro: null | { minutos: number, cargoMesa: number, totalProductos: number,
                  total: number, metodoPago: "EFECTIVO"|"YAPE"|"PLIN"|"TARJETA"|"OTRO",
                  montoRecibido: number, vuelto: number, pagadoEn: number }
  motivoCancelacion: string | undefined  (opcional)

producto
  id: string              (uid("prod"))
  nombre: string          no vacío
  categoria: string | ""  opcional
  precio: number          ≥ 0
  estado: "ACTIVO" | "INACTIVO"
  imagen: string | null   URL o dataURL pequeño (limitado por cuota)
  stock: number | null    null = sin control de stock
  eliminado: boolean      borrado lógico

gasto
  id: string              (uid("gas"))
  monto: number           > 0
  descripcion: string
  categoria: "Limpieza"|"Servicios"|"Mantenimiento"|"Compra de productos"|"Otros"
  fecha: string           "YYYY-MM-DD"
  creadoEn: number        ms

config
  version: number         versión del esquema (arranca en 1; permite migraciones)
  nombreSalon: string
  tema: "dark" | "light"
  pieComprobante: string
  datosDemoAplicados: boolean
```

### 2.3 Relaciones

```text
mesa (1) ──< sesion (N)          regla: máximo UNA sesión ACTIVA por mesa
sesion (1) ──< personas (N)      al menos una persona siempre
sesion (1) ──< consumos (N)      consumo.personaId → personas.id de la MISMA sesión
consumo (N) → producto (id)      precio histórico copiado al agregar (nunca se actualiza)
reportes ── sesiones FINALIZADAS (atribuidas a la fecha de su fin) + gastos por fecha
```

Invariantes que db.js/la UI garantizan:
- Mesa `EN_USO` ⇔ existe exactamente una sesión `ACTIVA` con su `mesaId`.
- Al finalizar/cancelar: sesión `FINALIZADA`/`CANCELADA` y mesa vuelve a `DISPONIBLE`.
- Cancelar sesión: sin cobro, no suma a ingresos, devuelve stock de consumos, queda en historial.
- Borrado lógico de mesas/productos; gastos se eliminan físicamente.
- Cambiar la tarifa de una mesa NO altera sesiones activas ni históricas (tarifa congelada).

### 2.4 Finanzas (definición única)

- Ingresos por mesas = Σ `cobro.cargoMesa` de sesiones `FINALIZADAS` del período.
- Ingresos por productos = Σ subtotales de consumos de esas mismas sesiones.
- Ingresos totales = mesas + productos. Gastos = Σ gastos con `fecha` en el período.
- Ganancia neta = ingresos totales − gastos. Canceladas no suman.

### 2.5 Dinero y tiempo (convención interna)

- Internamente: **céntimos enteros** (`Math.round(soles * 100)`) para sumas/impuestos evitando coma flotante; los resultados se exponen como **soles** redondeados a 2 decimales.
- Tiempo: siempre `Date.now()` en ms; formato solo al mostrar, zona `America/Lima`. Gastos: `YYYY-MM-DD`.
- Duración: `getElapsedMinutes` trunca segundos (`Math.floor(diff / 60000)`).

---

## 3. CONTRATO DE `js/db.js` (capa asíncrona)

Todas las funciones devuelven **Promesas** (permitirá migrar a API REST sin tocar las páginas). Las páginas nunca tocan `localStorage`.

```javascript
// ── mesas ─────────────────────────────────────────────────────────
db.mesas.getAll()                    → Promise<mesa[]>        // excluye eliminadas (opción { incluirEliminadas })
db.mesas.getById(id)                 → Promise<mesa | null>
db.mesas.create({ nombre, tarifaHora, estado })              → Promise<mesa>   // agrega id, timestamps
db.mesas.update(id, cambios)         → Promise<mesa>          // actualiza actualizadaEn
db.mesas.delete(id)                  → Promise<boolean>       // LÓGICO: eliminada = true

// ── productos ─────────────────────────────────────────────────────
db.productos.getAll()                → Promise<producto[]>    // excluye eliminados
db.productos.getById(id)             → Promise<producto | null>
db.productos.create({ nombre, categoria, precio, estado, imagen, stock }) → Promise<producto>
db.productos.update(id, cambios)     → Promise<producto>
db.productos.delete(id)              → Promise<boolean>       // LÓGICO

// ── sesiones ──────────────────────────────────────────────────────
db.sesiones.getAll()                 → Promise<sesion[]>      // incluye ACTIVA, FINALIZADA, CANCELADA
db.sesiones.getById(id)              → Promise<sesion | null>
db.sesiones.create({ mesaId, mesaNombre, tarifaHora, inicio, personas }) → Promise<sesion>  // estado: ACTIVA
db.sesiones.update(id, cambios)      → Promise<sesion>        // consumos, personas, cobro, estado, fin

// ── gastos ────────────────────────────────────────────────────────
db.gastos.getAll()                   → Promise<gasto[]>
db.gastos.create({ monto, descripcion, categoria, fecha })   → Promise<gasto>
db.gastos.update(id, cambios)        → Promise<gasto>
db.gastos.delete(id)                 → Promise<boolean>       // FÍSICO

// ── config ────────────────────────────────────────────────────────
db.config.get()                      → Promise<config>        // crea defaults si no existe
db.config.update(cambios)            → Promise<config>

// ── utilidades globales ───────────────────────────────────────────
db.exportAll()                       → Promise<Object>        // { version, exportadoEn, mesas, sesiones, productos, gastos, config }
db.importAll(data)                   → Promise<{ importadas: n }>  // VALIDA antes de reemplazar; lanza Error descriptivo si inválido
db.clearAll()                        → Promise<void>          // elimina TODAS las claves billar:*
db.seedDemo()                        → Promise<void>          // solo primera ejecución (config.datosDemoAplicados)
```

Reglas internas:
- `create` genera `id` con `utils.js` y timestamps; valida campos obligatorios antes de persistir.
- `sesiones.getAll` garantiza consistencia al recargar (sesiones ACTIVAS conservan inicio, personas y consumos; nada se reinicia).
- `importAll` valida: JSON, `version`, colecciones esperadas, tipos, campos obligatorios, IDs únicos; si algo falla → Error con motivo, sin tocar nada.
- Errores de cuota/corrupción los emite `storage.js`; `db.js` los propaga como Promesas rechazadas con mensaje claro.

---

## 4. CONTRATO DE `js/billing.js` (regla única de facturación)

Toda la lógica de cobro vive **exclusivamente** aquí. Ningún otro archivo repite la fórmula.

```javascript
// Cargo por tiempo en SOLES (regla única, sección 6)
calculateTableCharge(minutes, hourlyRate) → number
//   minutos: entero ≥ 0; hourlyRate: > 0. Inválidos → Error descriptivo.
//   horasCompletas × tarifa  +  adicional(minutosRestantes):
//     0–9 → 0 · 10–19 → 1 · 20–29 → 2 · 30–39 → tarifa/2 · 40–49 → tarifa/2+1 · 50–59 → tarifa/2+2

// Desglose para la UI (calculateTableCharge usa esta función)
getChargeBreakdown(minutes, hourlyRate)
//   → { horasCompletas, minutosRestantes, cargoHoras, cargoMinutos, total }  (soles, 2 dec.)

// Minutos completos entre dos timestamps (trunca segundos)
getElapsedMinutes(startMs, endMs = Date.now()) → number

// Totales
calculateProductsTotal(consumos) → number      // Σ subtotal, en céntimos internos → soles
calculateSessionTotal(sesion, ahora = Date.now()) → number
//   { total = cargoTiempo + totalProductos } usando breakdown de la sesión

// Vuelto (positivo = sobra; negativo = falta pagar)
calculateChange(total, montoRecibido) → number
```

Ejemplos de referencia (tarifa S/ 8): 60→8 · 70→9 · 80→10 · 90→12 · 100→13 · 110→14 · 120→16 · 30→4.
Tarifa S/ 10: 60→10 · 70→11 · 80→12 · 90→15 · 100→16 · 110→17 · 120→20 · 150→25.
Tarifa S/ 9: 90→13.5 · 100→14.5 · 110→15.5 · 120→18 (mitades con decimales; redondeo final a 2 dec.).

Consumo por `billing.js`: tarjetas de mesa activa, modal de pago, comprobante, historial, reportes y dashboard.

---

## 5. DECISIONES DE ARQUITECTURA

1. **`app.js` es el punto de entrada común**: `initApp()` aplica tema temprano, monta navegación, garantiza config/seed demo y crea el contenedor de notificaciones. Cada `pagina.js` llama `await initApp()` y luego ejecuta solo su lógica.
2. **Navegación única**: `navigation.js` define el HTML del sidebar/header (con `textContent`/creación de nodos, sin inyectar strings con datos del usuario) y marca el enlace activo según `location.pathname`.
3. **Contador en vivo**: un único `setInterval(1s)` en `mesas.js` actualiza **solo** nodos de texto (`HH:MM:SS`, cargos) de mesas en uso; nunca `redraw` completo ni contadores incrementales.
4. **Modales/notificaciones**: fábrica propia en `utils.js` (foco atrapado, `Esc`, devolución de foco, `aria-live="polite"` para notificaciones). Sin `alert()`.
5. **Impresión**: `@media print` en `global.css` oculta todo excepto `#comprobante`.
6. **Seguridad**: sin `eval()`, entradas validadas, HTML dinámico solo con datos escapados/`textContent`.
7. **Futuro backend**: las páginas solo consumen `db.js`; cambiar a REST = reimplementar `db.js` + `storage.js`.

---

## 6. PLAN DE FASES (recordatorio)

| Fase | Contenido |
|------|-----------|
| 0 | Este análisis ✅ |
| 1 | Base: index.html, CSS global/variables/temas, utils.js, storage.js, db.js, theme.js, navigation.js, app.js, demo |
| 2 | billing.js + tests/pruebas-billing.html |
| 3 | Mesas: CRUD, inicio de sesión, contador en vivo, personas, cancelación |
| 4 | Productos y consumos en mesa: CRUD, stock, desglose por persona |
| 5 | Pago, vuelto, comprobante imprimible, historial |
| 6 | Gastos, reports.js, reportes con gráficos, dashboard |
| 7 | Configuración, exportar/importar, restaurar/eliminar datos, revisión final, README |
