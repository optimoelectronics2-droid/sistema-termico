# Changelog

## 2026-06-30 — Critical fix: multi-tenant sync data loss (soft-delete + company guards)

### Causa raíz

El motor de sincronización en tiempo real (`realtimeSync.js`) escuchaba cambios en el store de Zustand
y, en `scheduleLocalSync()`, comparaba IDs del estado anterior contra el estado actual para detectar
eliminaciones. Cuando el usuario cambiaba de empresa vía `switchCompany()` (o creaba/eliminaba una
empresa), el store reemplazaba TODOS los arreglos top-level (invoices, quotes, customers, etc.) con
los de la nueva empresa. El sync interpretaba cada ID de la empresa anterior como "eliminado" y los
borraba PERMANENTEMENTE de Firestore vía `deleteDoc()`.

### Solución aplicada

Se implementaron tres capas de protección:

#### 1. Guardias de cambio de empresa (CRÍTICO)

En `scheduleLocalSync()`, `flushChanges()`, `writeDiff()` y `handleRemoteCollection()` se agregó
detección de cambio de `activeCompanyId`. Cuando se detecta un cambio de empresa:

- `scheduleLocalSync()` **omite toda detección de eliminaciones** — los IDs de la empresa anterior
  no se marcan como "borrados" aunque hayan desaparecido del store.
- `flushChanges()` **omite el diff completo** — `previousState` se actualiza al nuevo estado
  sin ejecutar `writeDiff()`, evitando que los documentos de la empresa anterior se eliminen de
  Firestore.
- `writeDiff()` **omite las eliminaciones** cuando el `activeCompanyId` cambió entre `prev` y `next`.
- `handleRemoteCollection()` **omite la detección de purgados locales** cuando cambió la empresa.

#### 2. Soft-delete (segunda capa)

`immediateDeleteWithRetry()` y `writeDiff()` ahora usan **soft-delete**: en lugar de `deleteDoc()`,
marcan el documento con `deletedAt` + `deletedBy` usando `setDoc(docRef, data, { merge: true })`.
Esto preserva el documento en Firestore, permitiendo:

- Recuperación manual desde la consola de Firebase si un bug futuro provoca eliminaciones masivas.
- Auditoría de qué usuario eliminó qué documento y cuándo.
- Purga controlada y confirmada por el usuario (ver punto 3).

Los snapshots remotos (`handleRemoteCollection` e `initializeUserSync`) filtran documentos con
`deletedAt` para no re-introducirlos en el store local.

#### 3. Purga manual (tercera capa)

Se agregó la función `purgeDeletedDocuments(collectionName, olderThanDays)` y
`purgeAllDeletedCollections(olderThanDays)` que permite al usuario eliminar FÍSICAMENTE los
documentos marcados como eliminados con antigüedad mayor a N días (default 30).

Desde Configuración → Integridad de datos → "Purgar documentos eliminados" con confirmación explícita.

#### 4. companyId en escritura

`writeDiff()` ahora inyecta `companyId: activeCompanyId` en todo documento escrito a Firestore
que no lo tenga. Combinado con `scopeRecord()` en el store (que ya añade `companyId`), todos
los documentos nuevos quedan etiquetados con la empresa propietaria.

### Archivos modificados

- `src/services/realtimeSync.js` — Guardias de empresa, soft-delete, filtro deletedAt, purge API
- `src/features/settings/SettingsPage.jsx` — Botón de purga + sección de seguridad de datos
- `CHANGELOG.md` — Este archivo

### Verificación

Ver `scripts/verify-multi-tenant-sync.js` para un script de verificación manual que reproduce
el escenario de cambio de empresa sin pérdida de datos.

## 2026-07-01 — Fix: companyChanged null-edge-case, sync debug log, companyId filtering

### Cambios

#### 1. `companyChanged()` — null→validId detection (CRÍTICO)

La función `companyChanged()` usaba `prevId && nextId && prevId !== nextId`, lo cual retornaba
`false` cuando uno de los ID era null (ej: durante inicialización antes de que `bootstrapTenantForUser`
asignara el `activeCompanyId`). Esto permitía que la detección de eliminaciones se ejecutara
durante la primera transición de estado, marcando documentos como eliminados incorrectamente.

**Fix:** `return prevId !== nextId` — sin los checks de truthiness. Ahora `null !== 'company-1'`
retorna `true`, activando correctamente la guardia.

#### 2. Sync Debug Log (`window.__SYNC_LOG__`)

Se agregó un log de eventos en vivo accesible desde la consola del navegador. Cada evento de
eliminación (detectado, saltado por guardia, o escrito) se captura con timestamp, colección, IDs,
y companyId prev/next. Para inspeccionar:

```js
copy(JSON.stringify(window.__SYNC_LOG__, null, 2))
```

Puntos de instrumentación:
- `scheduleLocalSync.guard` — guardia de cambio de empresa evitó detección de eliminaciones
- `scheduleLocalSync.deletion` — IDs marcados para soft-delete
- `flushChanges.guard` — guardia evitó escritura de eliminaciones
- `handleRemoteCollection.purgeDetect` — documentos localmente purgados detectados
- `writeDiff.softDelete` — documentos soft-eliminados en Firestore
- `writeDiff.skipWrongCompany` — documentos saltados por companyId mismatch (nueva capa)

#### 3. CompanyId filtering en `writeDiff` (capa adicional)

Ahora `writeDiff()` verifica que cada documento a eliminar tenga un `companyId` que coincida con
el `activeCompanyId` actual. Si el documento tiene un `companyId` explícito y NO coincide con la
empresa activa, se salta la eliminación (soft-delete). Esto funciona como respaldo incluso si
las guardias de `companyChanged()` fallaran por alguna razón.

### Archivos modificados

- `src/services/realtimeSync.js` — Las tres correcciones anteriores

### Verificación

Build y lint pasan sin errores nuevos. Para probar en producción:
1. Abrir consola del navegador
2. Verificar que `window.__SYNC_LOG__` existe y captura eventos
3. Cambiar de empresa y confirmar que NO aparecen eventos `scheduleLocalSync.deletion`
4. Confirmar que aparecen eventos `scheduleLocalSync.guard` con los companyId correctos
