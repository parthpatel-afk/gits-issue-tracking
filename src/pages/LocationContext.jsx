import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
// lucide imports removed (Home no longer needed)
import { useCompany } from '../hooks/useCompany'
import { supabase } from '../lib/supabase'
import styles from './LocationContext.module.css'

// ── Field definitions ──────────────────────────────────────────────────────────

const FIELD_DEFS = [
  { key: 'plant',      level: 'level1', defaultLabel: 'Plant',      core: true  },
  { key: 'department', level: 'level2', defaultLabel: 'Department', core: true  },
  { key: 'zone',       level: 'level3', defaultLabel: 'Zone',       core: false },
  { key: 'area',       level: 'level4', defaultLabel: 'Area',       core: false },
]

const EMPTY_LOC = { plant: 'N/A', department: 'N/A', zone: 'N/A', area: 'N/A' }

// ── Helpers ────────────────────────────────────────────────────────────────────

function savedLocKey(slug) { return `gits_${slug}_loc` }

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)) } catch { return null }
}

function getLabels(company) {
  const ll = company?.loc_labels
  return {
    plant:      ll?.level1 ?? 'Plant',
    department: ll?.level2 ?? 'Department',
    zone:       ll?.level3 ?? 'Zone',
    area:       ll?.level4 ?? 'Area',
  }
}

// Seed is label-aware: "Facility 1, Facility 2" not always "Plant 1, Plant 2"
function generateSeed(labels) {
  return {
    plant:      [`${labels.plant} 1`,      `${labels.plant} 2`],
    department: [`${labels.department} 1`, `${labels.department} 2`, `${labels.department} 3`],
    zone:       [`${labels.zone} 1`,       `${labels.zone} 2`],
    area:       [`${labels.area} 1`,       `${labels.area} 2`],
  }
}

async function persistOptions(companyId, opts) {
  const { error } = await supabase.rpc('update_company_loc_options', {
    p_company_id:  companyId,
    p_loc_options: opts,
  })
  if (error) console.error('loc_options save failed:', error.message)
}

function hasMeaningfulValue(loc) {
  return loc && FIELD_DEFS.some(f => loc[f.key] && loc[f.key] !== 'N/A')
}

function formatLoc(loc) {
  return FIELD_DEFS
    .map(f => (loc?.[f.key] && loc[f.key] !== 'N/A') ? loc[f.key] : null)
    .filter(Boolean)
    .join(' · ')
}

// ── Combobox ───────────────────────────────────────────────────────────────────

function Combobox({ fieldId, value, options, label, onChange, onAdd, onRemove }) {
  const [open, setOpen]       = useState(false)
  const [query, setQuery]     = useState('')
  const [focused, setFocused] = useState(false)
  const wrapRef  = useRef(null)
  const inputRef = useRef(null)

  const allOpts  = ['N/A', ...options]
  const filtered = query.trim()
    ? allOpts.filter(o => o.toLowerCase().includes(query.toLowerCase()))
    : allOpts
  const qt     = query.trim()
  const canAdd = qt && !allOpts.some(o => o.toLowerCase() === qt.toLowerCase())

  useEffect(() => {
    function away(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setQuery(''); setFocused(false)
      }
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  function pick(val) {
    onChange(val); setOpen(false); setQuery(''); setFocused(false)
    inputRef.current?.blur()
  }

  function add() {
    if (!qt) return
    onAdd(qt); setOpen(false); setQuery(''); setFocused(false)
    inputRef.current?.blur()
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); setFocused(false); inputRef.current?.blur() }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (canAdd) add()
      else if (filtered.length > 0) pick(filtered[0])
    }
  }

  const displayVal = focused ? query : (value !== 'N/A' ? value : '')

  return (
    <div ref={wrapRef} className={styles.comboWrap}>
      <div className={styles.comboTrigger}>
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          className={`${styles.comboInput} ${value !== 'N/A' && !focused ? styles.comboInputHasValue : ''}`}
          placeholder={`Select ${label.toLowerCase()}…`}
          value={displayVal}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => { setFocused(true); setOpen(true); setQuery('') }}
          onKeyDown={handleKeyDown}
        />
        <span className={styles.chevron} aria-hidden="true">▾</span>
      </div>

      {open && (
        <div className={styles.comboDropdown}>
          {filtered.map(opt => (
            <button
              key={opt}
              type="button"
              className={`${styles.comboOpt} ${opt === value ? styles.comboOptActive : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(opt) }}
            >
              <span>{opt === 'N/A' ? 'Not specified' : opt}</span>
              <span className={styles.comboOptRight}>
                {opt !== 'N/A' && (
                  <span
                    className={styles.removeBtn}
                    title="Remove"
                    onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onRemove(opt) }}
                  >×</span>
                )}
                {opt === value && <span className={styles.checkmark}>✓</span>}
              </span>
            </button>
          ))}
          {canAdd && (
            <button
              type="button"
              className={styles.comboAdd}
              onMouseDown={e => { e.preventDefault(); add() }}
            >
              + Add "{qt}"
            </button>
          )}
          {filtered.length === 0 && !canAdd && (
            <p className={styles.comboEmpty}>No matches</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LocationContext() {
  const { companySlug } = useParams()
  const { company, loading } = useCompany(companySlug)
  const navigate = useNavigate()

  const [loc, setLoc]                 = useState(EMPTY_LOC)
  const [options, setOptions]         = useState({})
  const [savedLoc, setSavedLoc]       = useState(null)
  const [showForm, setShowForm]       = useState(null)   // null = not ready
  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    if (!companySlug || !company) return

    const labels = getLabels(company)

    // Options live in Supabase (company.loc_options).
    // If null (old company before this feature), generate seed and save it back.
    let opts = company.loc_options
    if (!opts || typeof opts !== 'object' || Array.isArray(opts)) {
      opts = generateSeed(labels)
      persistOptions(company.id, opts)
    }
    setOptions(opts)

    // Saved location is per-device (intentional) — stays in localStorage
    const saved = loadJSON(savedLocKey(companySlug))
    if (saved && hasMeaningfulValue(saved)) {
      setSavedLoc(saved)
      setLoc(saved)
      setShowDetails(saved.zone !== 'N/A' || saved.area !== 'N/A')
      setShowForm(false)
    } else {
      setShowForm(true)
    }
  }, [companySlug, company])

  function handleChange(field, val) {
    setLoc(prev => ({ ...prev, [field]: val }))
  }

  function handleAdd(field, val) {
    if (options[field]?.includes(val)) {
      setLoc(prev => ({ ...prev, [field]: val }))
      return
    }
    const updated = { ...options, [field]: [...(options[field] ?? []), val] }
    setOptions(updated)
    setLoc(prev => ({ ...prev, [field]: val }))
    persistOptions(company.id, updated)
  }

  function handleRemove(field, val) {
    const updated = { ...options, [field]: (options[field] ?? []).filter(v => v !== val) }
    setOptions(updated)
    if (loc[field] === val) setLoc(prev => ({ ...prev, [field]: 'N/A' }))
    persistOptions(company.id, updated)
  }

  function proceed(currentLoc) {
    localStorage.setItem(savedLocKey(companySlug), JSON.stringify(currentLoc))
    navigate(`/issue/${companySlug}/submit?${new URLSearchParams(currentLoc)}`)
  }

  if (loading || showForm === null) return <div className={styles.page}><p className={styles.loadingText}>Loading…</p></div>

  const labels       = getLabels(company)
  const coreFields   = FIELD_DEFS.filter(f => f.core)
  const detailFields = FIELD_DEFS.filter(f => !f.core)

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button className={styles.topBarBrand} onClick={() => navigate(`/${companySlug}`)} title="Home">
            {company?.logo_url && (
              <img src={company.logo_url} alt={`${company.name} logo`} className={styles.topBarLogo} />
            )}
            <div>
              <p className={styles.topBarCompany}>{company?.name || 'AutoRise'}</p>
              <p className={styles.topBarTitle}>Issue Submission</p>
            </div>
          </button>
        </div>
      </header>

      <div className={styles.pageContent}>
      <div className={styles.card}>
        <h1 className={styles.title}>Submit an Issue</h1>
        <p className={styles.subtitle}>Select your work location to continue.</p>

        {/* ── Banner: repeat user ── */}
        {!showForm && savedLoc && (
          <div className={styles.banner}>
            <p className={styles.bannerLabel}>Working at</p>
            <p className={styles.bannerLoc}>{formatLoc(savedLoc)}</p>
            <button type="button" className={styles.btn} onClick={() => proceed(loc)}>
              Continue &rarr;
            </button>
            <button type="button" className={styles.changeBtn} onClick={() => setShowForm(true)}>
              Not here? Change location
            </button>
          </div>
        )}

        {/* ── Form ── */}
        {showForm && (
          <form className={styles.form} onSubmit={e => { e.preventDefault(); proceed(loc) }}>

            {coreFields.map(f => (
              <div key={f.key} className={styles.field}>
                <label htmlFor={f.key} className={styles.label}>{labels[f.key]}</label>
                <Combobox
                  fieldId={f.key}
                  value={loc[f.key]}
                  options={options[f.key] ?? []}
                  label={labels[f.key]}
                  onChange={val => handleChange(f.key, val)}
                  onAdd={val => handleAdd(f.key, val)}
                  onRemove={val => handleRemove(f.key, val)}
                />
              </div>
            ))}

            <button
              type="button"
              className={styles.detailsToggle}
              onClick={() => setShowDetails(d => !d)}
            >
              {showDetails
                ? `− Hide ${labels.zone} & ${labels.area}`
                : `+ Add ${labels.zone} & ${labels.area}`
              }
            </button>

            {showDetails && (
              <div className={styles.detailFields}>
                {detailFields.map(f => (
                  <div key={f.key} className={styles.field}>
                    <div className={styles.labelRow}>
                      <label htmlFor={f.key} className={styles.label}>{labels[f.key]}</label>
                      <span className={styles.optional}>optional</span>
                    </div>
                    <Combobox
                      fieldId={f.key}
                      value={loc[f.key]}
                      options={options[f.key] ?? []}
                      label={labels[f.key]}
                      onChange={val => handleChange(f.key, val)}
                      onAdd={val => handleAdd(f.key, val)}
                      onRemove={val => handleRemove(f.key, val)}
                    />
                  </div>
                ))}
              </div>
            )}

            <button type="submit" className={styles.btn}>
              Continue &rarr;
            </button>
          </form>
        )}
      </div>
      </div>
    </div>
  )
}
