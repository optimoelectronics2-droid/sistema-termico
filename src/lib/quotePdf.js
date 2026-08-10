export async function buildQuotePdf() {
  const source = document.getElementById('quote-preview')
  if (!source) return null
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')])
  const wrapper = document.createElement('div')
  const clone = cloneQuoteForCapture(source)
  wrapper.style.position = 'fixed'
  wrapper.style.left = '-10000px'
  wrapper.style.top = '0'
  wrapper.style.width = `${Math.ceil(source.getBoundingClientRect().width)}px`
  wrapper.style.background = '#ffffff'
  wrapper.style.zIndex = '-1'
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  try {
    const canvas = await html2canvas(clone, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    })
    const image = canvas.toDataURL('image/jpeg', 0.96)
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter', compress: true })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const imageHeight = (canvas.height * pageWidth) / canvas.width
    let remaining = imageHeight
    let position = 0
    pdf.addImage(image, 'JPEG', 0, position, pageWidth, imageHeight)
    remaining -= pageHeight
    while (remaining > 0) {
      position = remaining - imageHeight
      pdf.addPage()
      pdf.addImage(image, 'JPEG', 0, position, pageWidth, imageHeight)
      remaining -= pageHeight
    }
    return pdf
  } finally {
    wrapper.remove()
  }
}

function cloneQuoteForCapture(source) {
  const clone = source.cloneNode(true)
  const sourceNodes = [source, ...source.querySelectorAll('*')]
  const cloneNodes = [clone, ...clone.querySelectorAll('*')]
  sourceNodes.forEach((node, index) => {
    const target = cloneNodes[index]
    if (!(node instanceof Element) || !(target instanceof Element)) return
    copySafeComputedStyles(node, target)
    target.removeAttribute('class')
  })
  clone.removeAttribute('id')
  clone.style.position = 'static'
  clone.style.margin = '0'
  clone.style.boxShadow = 'none'
  clone.style.backgroundColor = '#ffffff'
  return clone
}

function copySafeComputedStyles(source, target) {
  const computed = window.getComputedStyle(source)
  Array.from(computed).forEach((property) => {
    if (property.startsWith('--')) return
    const value = normalizeCssColorFunctions(computed.getPropertyValue(property))
    if (!value) return
    try {
      target.style.setProperty(property, value, computed.getPropertyPriority(property))
    } catch { /* some computed properties are invalid as inline style */ }
  })
}

function normalizeCssColorFunctions(value) {
  return String(value)
    .replace(/oklch\(([^)]+)\)/gi, (_, body) => oklchToRgb(body))
    .replace(/color\(\s*display-p3\s+([^)]+)\)/gi, (_, body) => displayP3ToRgb(body))
}

function oklchToRgb(body) {
  const [colorPart, alphaPart] = String(body).split('/')
  const [lightnessRaw, chromaRaw, hueRaw] = colorPart.trim().split(/\s+/)
  const lightness = parseCssNumber(lightnessRaw, true)
  const chroma = parseCssNumber(chromaRaw)
  const hue = Number.parseFloat(hueRaw === 'none' ? '0' : hueRaw || '0') * (Math.PI / 180)
  const alpha = parseAlpha(alphaPart)
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const lPrime = lightness + (0.3963377774 * a) + (0.2158037573 * b)
  const mPrime = lightness - (0.1055613458 * a) - (0.0638541728 * b)
  const sPrime = lightness - (0.0894841775 * a) - (1.291485548 * b)
  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3
  return toRgbString(
    (4.0767416621 * l) - (3.3077115913 * m) + (0.2309699292 * s),
    (-1.2684380046 * l) + (2.6097574011 * m) - (0.3413193965 * s),
    (-0.0040041960863 * l) - (0.7034186147 * m) + (1.707614701 * s),
    alpha,
  )
}

function displayP3ToRgb(body) {
  const [colorPart, alphaPart] = String(body).split('/')
  const [red, green, blue] = colorPart.trim().split(/\s+/).slice(-3).map((part) => parseCssNumber(part))
  return toRgbString(red, green, blue, parseAlpha(alphaPart))
}

function parseCssNumber(value, lightness = false) {
  const text = String(value || '0').trim()
  if (text.endsWith('%')) return Number.parseFloat(text) / 100
  const number = Number.parseFloat(text)
  if (!Number.isFinite(number)) return 0
  return lightness && number > 1 ? number / 100 : number
}

function parseAlpha(value) {
  if (!value) return 1
  const text = String(value).trim()
  if (text.endsWith('%')) return clamp(Number.parseFloat(text) / 100, 0, 1)
  return clamp(Number.parseFloat(text), 0, 1)
}

function toRgbString(redLinear, greenLinear, blueLinear, alpha = 1) {
  const red = Math.round(linearToSrgb(redLinear) * 255)
  const green = Math.round(linearToSrgb(greenLinear) * 255)
  const blue = Math.round(linearToSrgb(blueLinear) * 255)
  const safeAlpha = clamp(Number.isFinite(alpha) ? alpha : 1, 0, 1)
  if (safeAlpha < 1) return `rgba(${red}, ${green}, ${blue}, ${safeAlpha})`
  return `rgb(${red}, ${green}, ${blue})`
}

function linearToSrgb(value) {
  const safe = clamp(value, 0, 1)
  return safe <= 0.0031308 ? 12.92 * safe : (1.055 * (safe ** (1 / 2.4))) - 0.055
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export async function downloadQuotePdf(quote) {
  const pdf = await buildQuotePdf()
  if (!pdf) return
  pdf.save(`cotizacion-${quote?.number || 'documento'}.pdf`)
}

export async function printQuotePdf() {
  const pdf = await buildQuotePdf()
  if (!pdf) return
  pdf.autoPrint()
  const url = URL.createObjectURL(pdf.output('blob'))
  const frame = document.createElement('iframe')
  frame.style.position = 'fixed'
  frame.style.right = '0'
  frame.style.bottom = '0'
  frame.style.width = '0'
  frame.style.height = '0'
  frame.style.border = '0'
  frame.src = url
  document.body.appendChild(frame)
  frame.onload = () => {
    frame.contentWindow?.focus()
    window.setTimeout(() => {
      frame.remove()
      URL.revokeObjectURL(url)
    }, 3000)
  }
}
