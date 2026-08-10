# ERP SaaS Premium - Cambios 2026-05-20

## Analisis aplicado antes de codificar

- Stack detectado: React 19, Vite, Firebase Auth, Firestore, Zustand persistido, Chart.js, jsPDF, XLSX y Framer Motion.
- Auth actual intacto: `onAuthStateChanged`, login, registro y recuperacion permanecen en `AuthPage` y `App`.
- Multiempresa existente: `CompanyProvider`, `activeCompanyId`, `tenantData`, `scopeRecord`, reglas Firestore tenant y selector de empresa en `AppShell`.
- Facturacion existente: `createInvoice`, `updateInvoice`, `voidInvoice`, `createCreditNote`, secuencias B/E y preview/print centralizados.
- Caja existente: `cashRegister`, `openCashRegister`, `closeCashRegister`, `registerCashMovement`.
- Reportes existentes: `reportEngine`, `Reports`, PDFs fiscales y exportacion Excel.
- Riesgo principal: tocar factura o Auth podia romper flujos criticos. Por eso los cambios nuevos se agregaron en motores derivados y rutas nuevas.

## Roadmap interno ejecutado

1. Mantener Firebase/Auth y rutas actuales sin migracion.
2. Derivar dashboard/caja/contabilidad desde datos actuales en vez de reescribir facturacion.
3. Expandir caja de forma retrocompatible.
4. Agregar contabilidad modular como vista nueva.
5. Limpiar branding tecnico de factura sin redisenar la factura.
6. Validar build/lint y dejar servidor local disponible.

## Mejoras implementadas

- Dashboard ejecutivo funcional con KPIs de ventas, semana, mes, ganancia, ITBIS, clientes, CxC, caja e inventario.
- Graficos modernos para ventas diarias, ventas mensuales y metodos de pago.
- Tabla de ventas del dia con busqueda, paginacion y exportacion.
- Widgets reordenables/ocultables con preferencias por usuario en `localStorage`.
- Corte de caja separado por metodo de pago, devoluciones, descuentos, ITBIS, gastos y diferencia.
- Apertura de caja con sucursal, caja, cajero y monto inicial.
- Registro manual de ingresos, gastos y retiros de caja.
- Libro diario profesional, mayor general y catalogo de cuentas base derivados automaticamente.
- Exportaciones Excel/PDF para dashboard, caja y contabilidad.
- Eliminacion de links externos y textos fijos de branding tecnico en acciones/validacion de factura.

## Pendientes enterprise sugeridos

- Colaboracion multiusuario real por empresa usando subcolecciones `companies/{companyId}/members` y sincronizacion granular por coleccion.
- Permisos UI por rol y sucursal conectados a membresias.
- Integracion DGII real con firma XML, trackId, reintentos y contingencia contra endpoints oficiales.
- Historial persistente de cierres de caja, no solo ultimo estado.
- Virtualizacion para tablas con miles de filas.
- Split adicional de vendors pesados (`xlsx`, `jspdf`, `html2canvas`) para bajar el chunk principal.
