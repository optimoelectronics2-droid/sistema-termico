# PULSA Flexible ERP

ERP SaaS para facturacion, inventario, POS, reportes y operaciones comerciales en Republica Dominicana.

## Stack

- React
- Vite
- Firebase Auth
- Firestore
- Zustand
- Tailwind
- PWA
- Realtime Sync

## Funcionalidades actuales

- Login, registro y recuperacion con Firebase Auth.
- POS y facturacion rapida.
- Factura normal sin comprobante fiscal.
- Factura con NCF opcional.
- Base e-CF opcional por empresa.
- Inventario, seriales/IMEI y entradas.
- Clientes, cotizaciones, conduces y cuentas por cobrar.
- Caja, arqueo y movimientos.
- Reportes operativos.
- Multiempresa SaaS con workspace aislado por empresa.
- Branding por empresa con logo URL y preview.

## Configuracion Netlify

El proyecto incluye `netlify.toml`.

```text
Build command: npm run build
Publish directory: dist
Functions directory: dejar vacio
```

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run build
```

## Documentacion

- Arquitectura base: `docs/ERP_ARCHITECTURE.md`
- Arquitectura SaaS: `docs/SAAS_ARCHITECTURE.md`
- Despliegue: `docs/DESPLIEGUE.md`
- Cambios: `CHANGELOG.md`

## Nota DGII/e-CF

La base incluye configuracion flexible por empresa y generacion local de XML e-CF. La firma XML, envio oficial, trackId y validacion DGII deben conectarse con certificado y endpoint autorizado antes de produccion.
