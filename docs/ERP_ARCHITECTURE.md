# Arquitectura objetivo ERP/POS

## Vision

Sistema SaaS modular para facturacion, POS, inventario, CRM, finanzas, taller y reportes fiscales. La experiencia debe ser una SPA rapida, responsive, con offline-first progresivo, permisos por rol, multi tienda, multi sucursal y auditoria completa.

## Stack recomendado

- Frontend: Next.js App Router, React, TypeScript, TailwindCSS, Framer Motion, Zustand, TanStack Query, React Hook Form, Zod, shadcn/ui, Recharts.
- Backend: NestJS modular, PostgreSQL, Prisma ORM, Redis, JWT + refresh tokens, colas para procesos diferidos.
- Integraciones: DGII/e-CF, PDF, QR, WhatsApp, correo, backups, PWA, Electron opcional.

## Estructura profesional sugerida

```txt
apps/
  web/
    app/
    features/
      dashboard/
      billing/
      quotes/
      inventory/
      crm/
      finance/
      reports/
      workshop/
      ai/
    components/
      app-shell/
      data-display/
      forms/
      overlays/
      primitives/
    lib/
    stores/
  api/
    src/
      modules/
        auth/
        tenants/
        branches/
        billing/
        inventory/
        customers/
        finance/
        reports/
        workshop/
        audit/
      prisma/
packages/
  ui/
  domain/
  config/
```

## Reglas de UX

- Un modulo por pantalla, con acciones primarias visibles y filtros en toolbar.
- Tablas responsive: desktop con columnas, movil como tarjetas con labels.
- Facturacion en tres zonas: cliente/configuracion, lineas, totales sticky.
- Inventario con busqueda instantanea por nombre, SKU, codigo, modelo, serial e IMEI.
- Reportes con filtros, graficos, exportacion Excel/CSV/PDF e impresion nativa.
- Facturas fiscales emitidas no se eliminan; se anulan con motivo y auditoria.

## Modelo de datos base

- Tenant, Store, Branch, User, Role, Permission.
- Product, ProductVariant, Serial, StockMovement, Supplier, PurchaseEntry.
- Customer, Contact, Receivable, Payment.
- Invoice, InvoiceLine, InvoicePayment, TaxSequence, Quote.
- CashRegister, CashMovement, Expense, Payable.
- ServiceOrder, Technician, Warranty.
- AuditLog, Automation, Notification.

## Wireframes operativos

### Cotizaciones desktop

```txt
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header: cliente, fecha, validez, modo fiscal, condiciones comerciales         │
├──────────────────────────────────────────────────────────┬───────────────────┤
│ Lineas de productos                                      │ Resumen sticky    │
│ ┌ Producto ─────────────┬ Cant ┬ Precio ┬ Desc ┬ ITBIS ┐ │ Subtotal          │
│ │ Busqueda inteligente  │  1   │ 0.00   │ 0%   │ Si    │ │ ITBIS             │
│ └───────────────────────┴──────┴────────┴──────┴───────┘ │ Ganancia          │
│                                                          │ TOTAL             │
│ + Agregar producto                                       │ Guardar / Enviar  │
└──────────────────────────────────────────────────────────┴───────────────────┘
```

### Inventario desktop

```txt
┌──────────────────────────────────────────────────────────────────────────────┐
│ Toolbar: busqueda, categoria, marca, ITBIS, estado, stock bajo, crear        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Tabla desktop: SKU | Producto | Categoria | Precio | Stock | Estado | Acciones│
├──────────────────────────────────────────────────────────────────────────────┤
│ Modal producto: Identificacion | Clasificacion | Precios | Stock | Seriales   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Facturacion desktop

```txt
┌──────────────────────────────────────────────────────────┬───────────────────┐
│ Cliente + condiciones + lineas                           │ Totales sticky    │
│ Busqueda producto, cantidad, precio, serial, ITBIS        │ Pagos divididos   │
│ Historial cliente y alertas de stock                      │ Emitir / preview  │
└──────────────────────────────────────────────────────────┴───────────────────┘
```

### Movil

```txt
┌──────────────────────────────┐
│ Topbar compacto              │
│ Tabs: Datos | Lineas | Total │
│ Cards apiladas               │
│ Botones tactiles 44px+       │
│ BottomNav fija               │
└──────────────────────────────┘
```

## APIs organizadas

```txt
POST   /auth/login
POST   /auth/refresh
GET    /dashboard/kpis
GET    /products?query=&category=&brand=&stock=
POST   /products
PATCH  /products/:id
DELETE /products/:id              # soft delete con auditoria
POST   /products/:id/stock-adjustments
GET    /invoices?query=&status=&from=&to=
POST   /invoices
PATCH  /invoices/:id
POST   /invoices/:id/void
DELETE /invoices/:id              # solo borradores/no fiscales
GET    /invoices/:id/pdf
GET    /quotes?query=&status=
POST   /quotes
PATCH  /quotes/:id
POST   /quotes/:id/convert
GET    /reports/:type?from=&to=
GET    /reports/:type/pdf
GET    /reports/:type/excel
```

## Prisma base optimizado

```prisma
model Product {
  id          String    @id @default(cuid())
  tenantId    String
  branchId    String?
  sku         String
  barcode     String?
  name        String
  brand       String?
  model       String?
  category    String
  cost        Decimal   @db.Decimal(12, 2)
  price       Decimal   @db.Decimal(12, 2)
  stock       Decimal   @default(0) @db.Decimal(12, 3)
  stockMin    Decimal   @default(0) @db.Decimal(12, 3)
  taxStatus   String    @default("taxed")
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@unique([tenantId, sku])
  @@index([tenantId, name])
  @@index([tenantId, barcode])
  @@index([tenantId, brand, model])
  @@index([tenantId, deletedAt])
}

model Invoice {
  id        String    @id @default(cuid())
  tenantId  String
  branchId  String
  number    String
  ncf       String?
  status    String
  total     Decimal   @db.Decimal(12, 2)
  deletedAt DateTime?
  voidedAt  DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  @@unique([tenantId, number])
  @@index([tenantId, ncf])
  @@index([tenantId, status, createdAt])
}
```

## Plan de migracion sin romper

1. Mantener Vite/Firebase como aplicacion activa mientras se crea `apps/web` y `apps/api`.
2. Extraer logica de calculo fiscal a un paquete `packages/domain`.
3. Crear adaptadores: `firebaseAdapter` actual y `prismaAdapter` nuevo con la misma interfaz.
4. Migrar modulo por modulo: inventario, clientes, cotizaciones, facturacion, reportes.
5. Activar Prisma/PostgreSQL en paralelo con seed/migracion y pruebas de equivalencia.
6. Cambiar autenticacion a JWT/refresh tokens cuando los permisos por rol esten listos.

## Seguridad y auditoria

- RBAC por modulo y accion.
- Auditoria para crear, editar, eliminar, anular, imprimir y exportar.
- Backups automaticos diarios y exportacion manual.
- Validaciones fiscales separadas del UI.
- Soft delete donde exista impacto contable o fiscal.
