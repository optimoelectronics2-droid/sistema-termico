# Trifusión Print Agent — Agente local de impresión

Pequeño servicio Node.js **standalone** que corre en `localhost:9847` y expone un servidor **WebSocket** para impresión real. Arregla las limitaciones del navegador:

- **USB**: usa el **spooler del SO** (driver ya instalado) en vez de competir por `claimInterface` → no más “interfaz ya reclamada / driver activo”.
- **Serial/COM**: vía `serialport`.
- **Bluetooth clásico (SPP/RFCOMM)**: el SO al emparejar crea un **puerto COM / tty virtual** — el agente lo reutiliza como Serial (sin BLE).
- **Red/LAN**: socket TCP crudo a **puerto 9100** con `net` (no WebPRNT).
- **Impresoras normales (láser/inyección, Carta/A4)**: envía PDF directo al spooler sin diálogo (`pdf-to-printer` en Windows, `lp` en macOS/Linux).

> No toca el build de Vite ni el resto del proyecto. Es un proceso aparte.

## Requisitos

- **Node.js 18+** (https://nodejs.org)
- Windows / macOS / Linux
- La(s) impresora(s) ya instalada(s) en el sistema (con driver) para USB/normal, o emparejada por Bluetooth en el SO, o accesible por IP para Red.

## Instalación rápida

```bash
cd agent
npm install
npm start
```

Deberías ver:

```
[agent] Trifusión Print Agent escuchando en ws://localhost:9847
[agent] Plataforma: win32 — Node v20.x
[agent] Health: http://localhost:9847/health
```

Prueba health en el navegador: `http://localhost:9847/health` → `{ ok: true, printers: 2 }`.

### Dependencias opcionales (según lo que uses)

- **Impresora normal en Windows (PDF silencioso)**: requiere `pdf-to-printer` (usa SumatraPDF internamente). Ya está en `optionalDependencies`; si no se instaló por antivirus, ejecuta:

  ```bash
  npm install pdf-to-printer
  npm start
  ```

- **Serial / Bluetooth clásico virtual COM**: requiere `serialport` (compilación nativa). Si falla en tu máquina, igual el agente corre; solo esa función quedará deshabilitada hasta instalarlo:

  ```bash
  npm install serialport
  npm start
  ```

- **Red 9100**: no requiere nada extra (usa `net` nativo).

## Cómo usa el frontend al agente

- Al abrir la pantalla de **Configuración de impresora**, el frontend intenta `ws://localhost:9847`.
- **Si conecta**: lista impresoras reales del SO + imprime sin diálogos por la ruta correcta (USB spooler / Serial / BT COM / Red 9100 / PDF spooler).
- **Si NO conecta**: hace fallback automático a WebUSB / WebSerial / Web Bluetooth (BLE) / WebPRNT como antes — sin romper nada.

La UI muestra el estado en vivo (`ws` push cada 2.5s) sin necesidad de “Buscar impresoras”.

## Uso

1. Deja el agente corriendo en segundo plano mientras usas el sistema de facturación en `http://localhost:5173` (o tu dominio).
2. En la app: **Configuración → Impresoras** → verás impresoras reales; selecciona la deseada.
3. Botón **Imprimir**: la app decide automáticamente:
   - Térmica → agente/USB directo con formato ticket.
   - Normal → agente con PDF directo sin diálogo (o `window.print()` con aviso si no hay agente).

## Puerto configurable

Por defecto `9847`. Para cambiar:

```bash
PRINT_AGENT_PORT=9848 npm start
# o
node index.js --port 9848
```

Si cambias el puerto, también cambia `DEFAULT_URL` en `src/services/printAgentClient.js` o pásalo al conectar.

## Dejarlo arrancando solo con el SO

### Windows

1. Crea un acceso directo a `node` con argumentos:
   - Destino: `"C:\Program Files\nodejs\node.exe" "C:\ruta\a\agent\index.js"`
   - O usa PM2:

     ```bash
     npm install -g pm2
     pm2 start index.js --name trifusion-print-agent
     pm2 save
     pm2 startup
     ```

2. Alternativa sin PM2: coloca un `.bat` en `shell:startup` (Win+R → `shell:startup`):

   ```bat
   @echo off
   cd /d C:\ruta\a\agent
   start /min node index.js
   ```

### macOS

```bash
# Con pm2 (recomendado)
npm install -g pm2
pm2 start index.js --name trifusion-print-agent
pm2 save
pm2 startup
```

O crea un LaunchAgent en `~/Library/LaunchAgents/com.trifusion.printagent.plist`.

### Linux (systemd)

```ini
# /etc/systemd/system/trifusion-print-agent.service
[Unit]
Description=Trifusion Print Agent
After=network.target

[Service]
WorkingDirectory=/ruta/a/agent
ExecStart=/usr/bin/node index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now trifusion-print-agent
```

## Empaquetar como ejecutable (sin Node instalado) — TODO opcional

Si no quieres que el usuario instale Node:

```bash
npm install -g pkg
pkg index.js --targets node18-win-x64,node18-macos-x64,node18-linux-x64 --output trifusion-print-agent
# Genera: trifusion-print-agent.exe / trifusion-print-agent-macos / trifusion-print-agent-linux
```

Alternativas: `nexe`, `electron-builder`. Deja el binario junto a un `agent/README.md` y un acceso directo.

> **TODO explícito si no se implementa en esta pasada**: empaquetar con `pkg`/`nexe` y notarizar (macOS) / firmar (Windows). El agente actual ya es funcional con Node.

## Protocolo WebSocket

### Cliente → Servidor

```json
{ "type": "list", "kind": "all|thermal|normal", "requestId": "req_..." }
{ "type": "print", "protocol": "escpos|zpl|epl|tspl|cpcl", "bytesBase64": "...", "target": { "printerName": "XP-80", "host": "192.168.1.50", "port": 9100, "portName": "COM3", "baudRate": 9600 } }
{ "type": "printNormal", "printerName": "HP LaserJet", "pdfBase64": "...", "copies": 1, "paperSize": "Letter", "orientation": "portrait" }
{ "type": "ping" }
```

### Servidor → Cliente

```json
{ "type": "printers", "printers": [ { "name": "XP-80", "kind": "thermal", "connection": "usb" } ], "agentInfo": { "platform": "win32" } }
{ "ok": true, "via": "network|serial|spooler", "device": "192.168.1.50:9100", "requestId": "req_..." }
{ "ok": false, "error": "mensaje claro", "requestId": "req_..." }
```

## Diagnóstico rápido

- **WS no conecta**: verifica que el agente esté corriendo y no bloqueado por antivirus/firewall. Prueba `http://localhost:9847/health`.
- **USB “driver activo”**: es normal — el agente lo resuelve usando el spooler. Si igual falla en Windows RAW, instala driver en modo **Generic / Text Only** o usa Red 9100 si la impresora tiene Ethernet.
- **Bluetooth clásico no aparece**: empareja primero en **Configuración de Bluetooth del SO** (crea COM/tty). Luego el agente lo lista como Serial.
- **Red 9100 sin respuesta**: verifica IP/puerto, misma red, firewall. Algunas impresoras usan 9101/9102 o 631.

## Seguridad

El agente solo escucha en `127.0.0.1` (no expuesto a la red). No requiere privilegios de admin salvo para instalar drivers de impresora.

---

© Trifusión — agente local v1.0.0
