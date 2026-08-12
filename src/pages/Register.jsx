import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import { saveSession } from '../hooks/useAuth'
import styles from './Register.module.css'

// ── Helpers ────────────────────────────────────────────────────────────────────

function getLabels(company) {
  const ll = company?.loc_labels
  return {
    plant:      ll?.level1 ?? 'Plant',
    department: ll?.level2 ?? 'Department',
    zone:       ll?.level3 ?? 'Zone',
    area:       ll?.level4 ?? 'Area',
  }
}

async function persistOptions(companyId, opts) {
  await supabase.rpc('update_company_loc_options', {
    p_company_id:  companyId,
    p_loc_options: opts,
  })
}

const SEED = {
  plant:      ['Plant 1', 'Plant 2'],
  department: ['Department 1', 'Department 2', 'Department 3'],
  zone:       ['Zone 1', 'Zone 2'],
  area:       ['Area 1', 'Area 2'],
}

// ── Inline Combobox ────────────────────────────────────────────────────────────

function Combobox({ fieldId, value, options, label, onChange, onAdd, onRemove }) {
  const [query, setQuery] = useState('')
  const [open, setOpen]   = useState(false)
  const wrapRef           = useRef(null)

  useEffect(() => {
    function handler(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const qt       = query.trim()
  const filtered = options.filter(o => o.toLowerCase().includes(qt.toLowerCase()))
  const canAdd   = qt.length > 0 && !options.some(o => o.toLowerCase() === qt.toLowerCase())

  function pick(val) { onChange(val); setQuery(''); setOpen(false) }
  function add()     { onAdd(qt); setQuery(''); setOpen(false) }

  return (
    <div className={styles.comboWrap} ref={wrapRef}>
      <input
        id={fieldId}
        className={styles.comboInput}
        type="text"
        autoComplete="off"
        placeholder={`${label}…`}
        value={open ? query : (value && value !== 'N/A' ? value : '')}
        onFocus={() => { setQuery(''); setOpen(true) }}
        onChange={e => setQuery(e.target.value)}
      />
      {value && value !== 'N/A' && !open && (
        <span className={styles.comboClear} onMouseDown={e => { e.preventDefault(); onChange('N/A') }}>×</span>
      )}
      {open && (
        <div className={styles.comboDropdown}>
          {filtered.map(opt => (
            <button
              key={opt}
              type="button"
              className={`${styles.comboOpt} ${opt === value ? styles.comboOptActive : ''}`}
              onMouseDown={e => { e.preventDefault(); pick(opt) }}
            >
              <span>{opt}</span>
              {opt === value && <span className={styles.checkmark}>✓</span>}
              <span
                className={styles.removeX}
                onMouseDown={e => { e.preventDefault(); e.stopPropagation(); onRemove(opt) }}
                title="Remove option"
              >×</span>
            </button>
          ))}
          {canAdd && (
            <button type="button" className={styles.comboAdd} onMouseDown={e => { e.preventDefault(); add() }}>
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

// ── Main ───────────────────────────────────────────────────────────────────────

const DEFAULT_DEPARTMENTS = [
  'Manufacturing', 'Quality', 'Safety', 'Maintenance',
  'Engineering', 'Logistics', 'HR', 'IT', 'Other',
]

export default function Register() {
  const { companySlug } = useParams()
  const navigate = useNavigate()
  const { company, loading: companyLoading } = useCompany(companySlug)

  const [accessCode, setAccessCode] = useState('')
  const [name, setName]             = useState('')
  const [username, setUsername]     = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [loc, setLoc]               = useState({ plant: 'N/A', department: 'N/A', zone: 'N/A', area: 'N/A' })
  const [options, setOptions]       = useState(SEED)
  const [showDetails, setShowDetails] = useState(false)
  const [error, setError]           = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!company) return
    // Merge loc_options with company departments for the department field
    const opts = company.loc_options ?? {}
    const merged = { ...SEED, ...opts }
    // If company has departments JSONB, use those for department options
    if (Array.isArray(company.departments) && company.departments.length > 0) {
      merged.department = company.departments
    }
    setOptions(merged)
  }, [company])

  const labels = company ? getLabels(company) : { plant: 'Plant', department: 'Department', zone: 'Zone', area: 'Area' }

  function handleLocChange(field, val) {
    setLoc(prev => ({ ...prev, [field]: val }))
  }

  function handleLocAdd(field, val) {
    if (options[field]?.includes(val)) { handleLocChange(field, val); return }
    const updated = { ...options, [field]: [...(options[field] ?? []), val] }
    setOptions(updated)
    setLoc(prev => ({ ...prev, [field]: val }))
    // For non-department fields, persist to loc_options; department managed separately
    if (field !== 'department' && company) persistOptions(company.id, updated)
  }

  function handleLocRemove(field, val) {
    const updated = { ...options, [field]: (options[field] ?? []).filter(v => v !== val) }
    setOptions(updated)
    if (loc[field] === val) setLoc(prev => ({ ...prev, [field]: 'N/A' }))
    if (field !== 'department' && company) persistOptions(company.id, updated)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (accessCode.trim() !== `${companySlug}123`) { setError('Invalid company access code.'); return }
    if (password !== confirm)                        { setError('Passwords do not match.'); return }
    if (password.length < 6)                         { setError('Password must be at least 6 characters.'); return }

    setSubmitting(true)

    const { data: existing } = await supabase
      .from('managers').select('id')
      .eq('company_id', company.id)
      .eq('username', username.trim().toLowerCase())
      .maybeSingle()

    if (existing) { setSubmitting(false); setError('That username is already taken.'); return }

    // Note: managers table uses 'line' for level4; loc.area maps to line
    const { data: newManager, error: insertErr } = await supabase
      .from('managers').insert({
        company_id: company.id,
        name:       name.trim(),
        username:   username.trim().toLowerCase(),
        password,
        plant:      loc.plant      !== 'N/A' ? loc.plant      : null,
        department: loc.department !== 'N/A' ? loc.department : null,
        zone:       loc.zone       !== 'N/A' ? loc.zone       : null,
        line:       loc.area       !== 'N/A' ? loc.area       : null,
      })
      .select().single()

    setSubmitting(false)
    if (insertErr) { setError('Registration failed. Please try again.'); return }

    saveSession(companySlug, newManager)
    navigate(`/admin/${companySlug}`, { replace: true })
  }

  if (companyLoading || !company) return <div className={styles.loading}>Loading…</div>

  return (
    <div className={styles.page}>
      <button className={styles.back} onClick={() => navigate(`/${companySlug}`)}>← Back</button>

      <div className={styles.card}>
        <p className={styles.brand}>{company.name}</p>
        <h1 className={styles.title}>Create Account</h1>
        <p className={styles.sub}>
          Enter your company access code and set up your issue team profile.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>

          <div className={styles.field}>
            <label className={styles.label}>Company Access Code</label>
            <input className={styles.input} type="password" required
              placeholder="Provided by your administrator"
              value={accessCode} onChange={e => setAccessCode(e.target.value)} />
          </div>

          <hr className={styles.divider} />

          <div className={styles.field}>
            <label className={styles.label}>Full Name</label>
            <input className={styles.input} type="text" required
              placeholder="e.g. John Smith"
              value={name} onChange={e => setName(e.target.value)} />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Username</label>
            <input className={styles.input} type="text" required autoComplete="username"
              placeholder="e.g. jsmith"
              value={username} onChange={e => setUsername(e.target.value)} />
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label}>Password</label>
              <input className={styles.input} type="password" required autoComplete="new-password"
                placeholder="Min. 6 characters"
                value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Confirm Password</label>
              <input className={styles.input} type="password" required autoComplete="new-password"
                placeholder="Repeat password"
                value={confirm} onChange={e => setConfirm(e.target.value)} />
            </div>
          </div>

          <hr className={styles.divider} />

          <p className={styles.areaHeading}>Your Work Area</p>
          <p className={styles.areaSub}>
            Selecting your plant and department enables the "My Area" filter in the dashboard,
            showing only issues routed to your area. Leave blank to see all.
          </p>

          <div className={styles.areaGrid}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reg_plant">{labels.plant}</label>
              <Combobox fieldId="reg_plant" value={loc.plant} options={options.plant ?? []}
                label={labels.plant}
                onChange={v => handleLocChange('plant', v)}
                onAdd={v => handleLocAdd('plant', v)}
                onRemove={v => handleLocRemove('plant', v)} />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reg_dept">{labels.department}</label>
              <Combobox fieldId="reg_dept" value={loc.department} options={options.department ?? []}
                label={labels.department}
                onChange={v => handleLocChange('department', v)}
                onAdd={v => handleLocAdd('department', v)}
                onRemove={v => handleLocRemove('department', v)} />
            </div>
          </div>

          <button type="button" className={styles.detailsToggle} onClick={() => setShowDetails(d => !d)}>
            {showDetails
              ? `− Hide ${labels.zone} & ${labels.area}`
              : `+ Add ${labels.zone} & ${labels.area}`}
          </button>

          {showDetails && (
            <div className={styles.areaGrid}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reg_zone">{labels.zone} <span className={styles.optional}>optional</span></label>
                <Combobox fieldId="reg_zone" value={loc.zone} options={options.zone ?? []}
                  label={labels.zone}
                  onChange={v => handleLocChange('zone', v)}
                  onAdd={v => handleLocAdd('zone', v)}
                  onRemove={v => handleLocRemove('zone', v)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reg_area">{labels.area} <span className={styles.optional}>optional</span></label>
                <Combobox fieldId="reg_area" value={loc.area} options={options.area ?? []}
                  label={labels.area}
                  onChange={v => handleLocChange('area', v)}
                  onAdd={v => handleLocAdd('area', v)}
                  onRemove={v => handleLocRemove('area', v)} />
              </div>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}

          <button className={styles.btn} type="submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create Account →'}
          </button>

        </form>
      </div>
    </div>
  )
}
