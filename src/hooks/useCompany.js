import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// AutoRise defaults — restored when no company brand is set
const BRAND_DEFAULTS = {
  '--navy':          '#0F1F3D',
  '--navy-light':    '#1A3260',
  '--green':         '#1B6E3C',
  '--accent-green':  '#6EDFA0',
  '--bg':            '#EEF2F8',
  '--text':          '#0F1F3D',
  '--text-muted':    'rgba(15, 31, 61, 0.5)',
  '--border':        'rgba(15, 31, 61, 0.1)',
  '--shadow':        '0 2px 8px rgba(15, 31, 61, 0.08)',
  '--shadow-md':     '0 4px 20px rgba(15, 31, 61, 0.12)',
}

// The app's fixed light background — used for contrast checks
const APP_BG = '#EEF2F8'

/**
 * Converts a hex color to an rgba string at given opacity.
 * Used to derive border/shadow/muted variants from brand colors.
 */
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** WCAG relative luminance of a hex color (0 = black, 1 = white). */
function getLuminance(hex) {
  const toLinear = c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  const r = toLinear(parseInt(hex.slice(1, 3), 16) / 255)
  const g = toLinear(parseInt(hex.slice(3, 5), 16) / 255)
  const b = toLinear(parseInt(hex.slice(5, 7), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two hex colors. */
function contrastRatio(hex1, hex2) {
  const l1 = getLuminance(hex1), l2 = getLuminance(hex2)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/**
 * Returns hex darkened until it achieves minRatio contrast against bgHex,
 * or stops after 20 steps at 15% reduction each. Preserves hue/chroma feel.
 */
function ensureContrast(hex, bgHex, minRatio = 4.5) {
  if (contrastRatio(hex, bgHex) >= minRatio) return hex
  let r = parseInt(hex.slice(1, 3), 16)
  let g = parseInt(hex.slice(3, 5), 16)
  let b = parseInt(hex.slice(5, 7), 16)
  for (let i = 0; i < 20; i++) {
    r = Math.max(0, Math.floor(r * 0.85))
    g = Math.max(0, Math.floor(g * 0.85))
    b = Math.max(0, Math.floor(b * 0.85))
    const candidate = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    if (contrastRatio(candidate, bgHex) >= minRatio) return candidate
  }
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

/**
 * Applies brand colors from the company row to CSS custom properties on :root.
 * Falls back to AutoRise defaults when columns are null.
 *
 * brand_primary   → drives --navy (headers, text, dark UI surfaces)
 * brand_secondary → drives --green / --accent-green (buttons, highlights, CTAs)
 *
 * Contrast guarantees:
 *   --text        : always ≥ 4.5:1 on APP_BG (#EEF2F8)
 *   --green       : always ≥ 4.5:1 on APP_BG (darkened from secondary if needed)
 *   --on-accent   : white or dark navy, whichever is more readable on the raw secondary
 */
function applyBrand(company) {
  const root = document.documentElement
  const primary   = company?.brand_primary   || null
  const secondary = company?.brand_secondary || null

  if (primary) {
    const safeText = ensureContrast(primary, APP_BG)
    root.style.setProperty('--navy',       primary)
    root.style.setProperty('--navy-light', primary + 'CC') // ~80% opacity overlay
    root.style.setProperty('--text',       safeText)
    root.style.setProperty('--text-muted', hexToRgba(safeText, 0.5))
    root.style.setProperty('--border',     hexToRgba(safeText, 0.1))
    root.style.setProperty('--shadow',     `0 2px 8px ${hexToRgba(safeText, 0.08)}`)
    root.style.setProperty('--shadow-md',  `0 4px 20px ${hexToRgba(safeText, 0.12)}`)
  } else {
    // Restore defaults
    root.style.setProperty('--navy',       BRAND_DEFAULTS['--navy'])
    root.style.setProperty('--navy-light', BRAND_DEFAULTS['--navy-light'])
    root.style.setProperty('--text',       BRAND_DEFAULTS['--text'])
    root.style.setProperty('--text-muted', BRAND_DEFAULTS['--text-muted'])
    root.style.setProperty('--border',     BRAND_DEFAULTS['--border'])
    root.style.setProperty('--shadow',     BRAND_DEFAULTS['--shadow'])
    root.style.setProperty('--shadow-md',  BRAND_DEFAULTS['--shadow-md'])
  }

  if (secondary) {
    const safeAccent = ensureContrast(secondary, APP_BG)
    // --on-accent: white if secondary is dark enough, navy otherwise
    const onAccent = getLuminance(secondary) <= 0.1833 ? '#FFFFFF' : '#0F1F3D'
    root.style.setProperty('--accent-green', safeAccent)
    root.style.setProperty('--green',        safeAccent)
    root.style.setProperty('--on-accent',    onAccent)
  } else {
    root.style.setProperty('--accent-green', BRAND_DEFAULTS['--accent-green'])
    root.style.setProperty('--green',        BRAND_DEFAULTS['--green'])
    root.style.setProperty('--on-accent',    '#FFFFFF') // default --green (#1B6E3C) is dark
  }
}

export function useCompany(slug) {
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!slug) return
    let cancelled = false
    setLoading(true)
    setError(null)
    supabase
      .from('companies')
      .select('*')
      .eq('slug', slug)
      .single()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) {
          setError('Company not found.')
        } else {
          setCompany(data)
          applyBrand(data)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [slug])

  return { company, loading, error }
}
