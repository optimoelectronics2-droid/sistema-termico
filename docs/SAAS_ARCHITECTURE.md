# Arquitectura SaaS Flexible

## Objetivo

Convertir el ERP actual en una base SaaS multiempresa sin romper el stack existente:

- React + Vite
- Firebase Auth
- Firestore
- Zustand persistente
- Tailwind
- PWA
- Realtime Sync

Firebase Auth se mantiene intacto. La capa SaaS vive por encima del usuario autenticado.

## Multiempresa

El store ahora maneja:

- `companies`: empresas disponibles para el usuario.
- `activeCompanyId`: empresa activa.
- `companyMemberships`: rol del usuario por empresa.
- `tenantData`: snapshots de workspace por empresa.
- `company` / `settings`: configuracion activa, retrocompatible con pantallas existentes.

Cuando se crea una empresa nueva, se crea un workspace vacio con inventario, clientes, facturas, reportes, caja, NCF y auditoria independientes.

Cuando se cambia de empresa:

1. Se guarda el workspace actual dentro de `tenantData[currentCompanyId]`.
2. Se carga el workspace de la nueva empresa.
3. Se recalculan reportes del workspace activo.

Esto permite aislamiento sin reescribir todos los modulos en una sola fase.

## Fiscal Flexible

Cada empresa puede decidir si usa:

- Factura normal sin comprobante.
- Factura con NCF.
- Factura electronica e-CF.
- Integracion DGII.
- Secuencia automatica.

Los switches estan en Configuracion y se guardan en `company.fiscal`.

Tipos e-CF soportados en la base:

- E31
- E32
- E33
- E34
- E41
- E43

`src/lib/dgiiEcfEngine.js` genera una estructura XML base y submissions locales. La firma XML y el envio oficial DGII quedan preparados como fase posterior porque requieren certificado, endpoint, credenciales y validacion formal.

## Firestore

Se mantiene compatibilidad con las colecciones legacy, pero se agrego una ruta recomendada para SaaS:

```text
companies/{companyId}
companies/{companyId}/members/{uid}
companies/{companyId}/{collection}/{documentId}
```

Las reglas nuevas permiten lectura/escritura dentro de una empresa solo a miembros de esa empresa.

Los nuevos helpers estan en:

- `src/services/firestoreService.js`
- `tenantCollection(companyId, name)`
- `tenantDocument(companyId, name, id)`
- `listTenantCollectionPage(...)`
- `saveTenantDocument(...)`

## Branding

Cada empresa soporta:

- logo por URL externa
- razon social
- RNC
- telefono
- WhatsApp
- email
- direccion
- colores
- terminos de factura
- moneda base

El logo URL se valida visualmente desde Configuracion y ya es consumido por facturas y sidebar.

## Seguridad

Fase 1 mantiene:

- Firebase Auth sin cambios.
- Reglas legacy existentes.
- Nueva ruta multiempresa protegida por membresia.
- Auditoria local existente.

Fase siguiente recomendada:

- Migrar operaciones Firestore legacy a `companies/{companyId}`.
- Crear UI de roles y permisos por modulo.
- Registrar IP desde backend o funcion serverless, no desde cliente.

## Fases Siguientes

1. Completar sincronizacion Firestore tenant-first.
2. Implementar roles granulares y permisos de UI.
3. Integrar certificado/firma XML e-CF.
4. Implementar envio, consulta trackId, rechazo, contingencia y reenvio DGII.
5. Agregar contabilidad: catalogo, diario, mayor, balances y cierres.
6. Redisenar pantallas densas por modulo con pruebas visuales.
