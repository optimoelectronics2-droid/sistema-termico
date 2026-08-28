/**
 * usePrinterWatcher.js
 * Hook que centraliza detección en tiempo real de impresoras:
 * - Agente local vía WebSocket (fuente principal: USB con driver, Serial/COM, Bluetooth clásico via COM virtual, Red 9100, spooler normal)
 * - WebUSB connect/disconnect (para térmicas ya autorizadas)
 * - WebSerial connect/disconnect
 * Devuelve estado vivo { connected, printers, agentConnected, error, hasThermal, hasNormal } para que
 * InvoiceThermalActions.jsx / InvoicePreview muestren el estado real sin recargar ni reabrir modal.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import * as printAgentClient from '../services/printAgentClient'
import { listThermalDevices } from '../services/thermalPrinterService'
import { detectPrinterKind } from '../services/printerProfile'

export function usePrinterWatcher({ autoConnectAgent = true, agentUrl } = {}) {
  const [agentConnected, setAgentConnected] = useState(() => printAgentClient.isAgentConnected())
  const [agentPrinters, setAgentPrinters] = useState(() => printAgentClient.getLastPrinters())
  const [webDevices, setWebDevices] = useState([])
  const [error, setError] = useState('')

  const hadAgentPrintersRef = useRef(false)

  // ── Agente: conectar y escuchar cambios ──
  useEffect(() => {
    let active = true
    let stopAuto = null
    if (autoConnectAgent) {
      try {
        stopAuto = printAgentClient.ensureAgentConnection(agentUrl)
      } catch (e) {
        if (active) setError(String(e?.message || e))
      }
    }

    const offStatus = printAgentClient.onStatusChange((ok) => {
      if (!active) return
      setAgentConnected(ok)
      if (!ok) setError('')
    })

    const offPrinters = printAgentClient.onPrinterListChanged((printers) => {
      if (!active) return
      hadAgentPrintersRef.current = Array.isArray(printers) && printers.length > 0
      setAgentPrinters(Array.isArray(printers) ? printers : [])
      setError('')
    })

    // Intento inicial de listado WebUSB/WebSerial como respaldo inmediato
    listThermalDevices().then((list) => { if (active) setWebDevices(list) }).catch(() => {})

    // Si el agente no conecta rápido, al menos mostrar lo que haya en WebUSB
    const timer = window.setTimeout(() => {
      if (active && !printAgentClient.isAgentConnected()) {
        listThermalDevices().then((list) => { if (active) setWebDevices(list) }).catch(() => {})
      }
    }, 1200)

    return () => {
      active = false
      window.clearTimeout(timer)
      offStatus?.()
      offPrinters?.()
      if (typeof stopAuto === 'function') {
        try { stopAuto() } catch { /* ignore */ }
      }
    }
  }, [agentUrl, autoConnectAgent])

  // ── WebUSB / WebSerial listeners en tiempo real ──
  useEffect(() => {
    let active = true

    const refreshWeb = async () => {
      try {
        const list = await listThermalDevices()
        if (active) setWebDevices(list)
      } catch {
        /* ignore */
      }
    }

    const onUsbConnect = () => { refreshWeb() }
    const onUsbDisconnect = () => { refreshWeb() }
    const onSerialConnect = () => { refreshWeb() }
    const onSerialDisconnect = () => { refreshWeb() }

    try {
      if (navigator.usb?.addEventListener) {
        navigator.usb.addEventListener('connect', onUsbConnect)
        navigator.usb.addEventListener('disconnect', onUsbDisconnect)
      }
    } catch { /* usb not available */ }

    try {
      if (navigator.serial?.addEventListener) {
        navigator.serial.addEventListener('connect', onSerialConnect)
        navigator.serial.addEventListener('disconnect', onSerialDisconnect)
      }
    } catch { /* serial not available */ }

    // Polling suave como respaldo, pausado cuando pestaña oculta o agente conectado
    let poll = null
    const startPoll = () => {
      if (poll) return
      poll = window.setInterval(() => {
        if (!active) return
        if (document.hidden) return
        if (!printAgentClient.isAgentConnected()) refreshWeb()
      }, 4000)
    }
    const stopPoll = () => {
      if (poll) { window.clearInterval(poll); poll = null }
    }
    const onVisibility = () => {
      if (document.hidden) stopPoll()
      else startPoll()
    }
    document.addEventListener('visibilitychange', onVisibility)
    startPoll()

    return () => {
      active = false
      stopPoll()
      document.removeEventListener('visibilitychange', onVisibility)
      try { navigator.usb?.removeEventListener('connect', onUsbConnect) } catch { /* ignore */ }
      try { navigator.usb?.removeEventListener('disconnect', onUsbDisconnect) } catch { /* ignore */ }
      try { navigator.serial?.removeEventListener('connect', onSerialConnect) } catch { /* ignore */ }
      try { navigator.serial?.removeEventListener('disconnect', onSerialDisconnect) } catch { /* ignore */ }
    }
  }, [])

  // ── Fusión de listas: agente (prioridad) + WebUSB fallback ──
  const printers = useMemo(() => {
    if (agentConnected || agentPrinters.length) {
      return agentPrinters.map((p) => ({
        ...p,
        _source: 'agent',
        _kind: p.kind || detectPrinterKind(p),
      }))
    }
    // Fallback WebUSB/WebSerial: mapear a formato común
    return webDevices.map((d) => ({
      ...d,
      name: d.productName || d.name || 'Impresora USB',
      displayName: d.productName || d.name || 'Impresora USB',
      _source: 'webusb',
      _kind: detectPrinterKind(d),
      connection: d.connection || 'usb',
    }))
  }, [agentConnected, agentPrinters, webDevices])

  const connected = printers.length > 0
  const hasThermal = useMemo(() => printers.some((p) => (p._kind || detectPrinterKind(p)) === 'thermal'), [printers])
  const hasNormal = useMemo(() => printers.some((p) => (p._kind || detectPrinterKind(p)) === 'normal'), [printers])

  const refresh = async () => {
    setError('')
    try {
      if (printAgentClient.isAgentConnected()) {
        const list = await printAgentClient.listPrintersViaAgent()
        setAgentPrinters(Array.isArray(list) ? list : [])
      } else {
        const list = await listThermalDevices()
        setWebDevices(list)
      }
    } catch (e) {
      setError(String(e?.message || e))
    }
  }

  return {
    connected,
    printers,
    agentConnected,
    hasThermal,
    hasNormal,
    error,
    refresh,
    raw: {
      agentPrinters,
      webDevices,
    },
  }
}

export default usePrinterWatcher
