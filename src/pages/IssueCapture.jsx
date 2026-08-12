import { useState, useRef } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Camera, Upload, X, CheckCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import styles from './IssueCapture.module.css'

const DEFAULT_DEPARTMENTS = [
  'Manufacturing', 'Quality', 'Safety', 'Maintenance',
  'Engineering', 'Logistics', 'HR', 'IT', 'Other',
]

const PRIORITY_META = {
  Low:      { color: 'var(--priority-low)',      label: 'Low',      desc: 'Minor — no urgency' },
  Medium:   { color: 'var(--priority-medium)',   label: 'Medium',   desc: 'Moderate — address soon' },
  High:     { color: 'var(--priority-high)',     label: 'High',     desc: 'Serious — action today' },
  Critical: { color: 'var(--priority-critical)', label: 'Critical', desc: 'Blocking — stop work' },
}

/** Compress an image file via canvas to a max dimension and quality */
function compressImage(file, maxDim = 1200, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim }
        else                { width  = Math.round((width  * maxDim) / height); height = maxDim }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width; canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', quality)
    }
    img.src = url
  })
}

export default function IssueCapture() {
  const { companySlug } = useParams()
  const [searchParams]  = useSearchParams()
  const { company, loading: companyLoading } = useCompany(companySlug)
  const navigate = useNavigate()

  const plant      = searchParams.get('plant')      || ''
  const department = searchParams.get('department') || ''
  const zone       = searchParams.get('zone')       || ''
  const area       = searchParams.get('area')       || ''

  const fileInputRef = useRef(null)

  const [title, setTitle]               = useState('')
  const [receivingPlant, setReceivingPlant] = useState('')
  const [receivingDept, setReceivingDept] = useState('')
  const [priority, setPriority]         = useState('Medium')
  const [description, setDescription]   = useState('')
  const [submittedBy, setSubmittedBy]   = useState('')
  const [photoFile, setPhotoFile]       = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoName, setPhotoName]       = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [submitted, setSubmitted]       = useState(false)
  const [error, setError]               = useState('')

  // Location helpers
  const locLabels = company?.loc_labels || {}
  const plantLabel = locLabels.level1 ?? 'Plant'
  const plantOptions = company?.loc_options?.plant || []

  // Department list: company.departments array if set, else defaults
  function getDepts() {
    const depts = company?.departments
    if (Array.isArray(depts) && depts.length > 0) return depts
    return DEFAULT_DEPARTMENTS
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const compressed = await compressImage(file)
    const name = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
    setPhotoFile(compressed)
    setPhotoName(name)
    setPhotoPreview(URL.createObjectURL(compressed))
  }

  function clearPhoto() {
    setPhotoFile(null)
    setPhotoPreview(null)
    setPhotoName('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim())    { setError('Please enter an issue title.'); return }
    if (!receivingDept)   { setError('Please select a receiving department.'); return }
    if (!description.trim()) { setError('Please describe the issue.'); return }
    setError('')
    setSubmitting(true)

    try {
      let photoUrl = ''

      if (photoFile && photoName) {
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('issue-photos')
          .upload(photoName, photoFile, { contentType: 'image/jpeg', upsert: false })
        if (uploadErr) throw new Error(`Photo upload failed: ${uploadErr.message}`)
        const { data: publicUrlData } = supabase.storage
          .from('issue-photos')
          .getPublicUrl(uploadData.path)
        photoUrl = publicUrlData.publicUrl
      }

      const { error: insertErr } = await supabase
        .from('issues')
        .insert({
          company_id:      company.id,
          title:           title.trim(),
          description:     description.trim(),
          issuing_plant:   plant,
          issuing_dept:    department,
          issuing_zone:    zone,
          issuing_area:    area,
          receiving_plant: receivingPlant || null,
          receiving_dept:  receivingDept,
          priority,
          submitted_by:    submittedBy.trim() || 'Anonymous',
          photo_url:       photoUrl,
          status:          'Open',
        })
      if (insertErr) throw new Error(insertErr.message)

      setSubmitted(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (companyLoading) return <div className={styles.page} />

  // ── Early success screen (before TopBar defined) is replaced below ─────────

  const locationStr = [plant, department, zone, area]
    .filter(v => v && v !== 'N/A').join(' › ') || 'No location selected'

  // ── Top bar (shared between success + main form) ───────────
  const TopBar = () => (
    <header className={styles.topBar}>
      <div className={styles.topBarLeft}>
        <button className={styles.backBtn} onClick={() => navigate(`/issue/${companySlug}`)} aria-label="Back">‹</button>
        <button className={styles.topBarBrand} onClick={() => navigate(`/${companySlug}`)} title="Home">
          {company?.logo_url && (
            <img src={company.logo_url} alt={`${company.name} logo`} className={styles.topBarLogo} />
          )}
          <div>
            <p className={styles.topBarCompany}>{company?.name || 'AutoRise'}</p>
            <p className={styles.topBarTitle}>Issue Submission</p>
          </div>
        </button>
        <span className={styles.locationBar}>{locationStr}</span>
      </div>
    </header>
  )

  // ── Success screen ─────────────────────────────────────────
  if (submitted) {
    return (
      <div className={styles.page}>
        <TopBar />
        <div className={styles.pageContent}>
          <div className={styles.successCard}>
            <div className={styles.successIcon}>
              <CheckCircle size={48} color="var(--priority-low)" />
            </div>
            <h2 className={styles.successTitle}>Issue Submitted</h2>
            <p className={styles.successMsg}>
              Your issue has been logged and routed to{' '}
              <strong>{[receivingPlant, receivingDept].filter(Boolean).join(' › ')}</strong>.
              The team will review and action it shortly.
            </p>
            <button
              className={styles.btn}
              onClick={() => navigate(`/${companySlug}`)}
            >
              ← Back to Home
            </button>
            <button
              className={styles.btnSecondary}
              onClick={() => {
                setTitle(''); setReceivingPlant(''); setReceivingDept(''); setPriority('Medium')
                setDescription(''); setSubmittedBy(''); clearPhoto()
                setSubmitted(false); setError('')
              }}
            >
              Submit Another Issue
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Main form ──────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <TopBar />

      <div className={styles.pageContent}>
        <div className={styles.card}>
          <h1 className={styles.title}>Issue Details</h1>
          <p className={styles.locationBadge}>{locationStr}</p>

          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.formGrid}>

              {/* ── LEFT COLUMN ── */}
              <div className={styles.formCol}>

                {/* ── Issue Title ── */}
                <div className={styles.section}>
                  <label className={styles.sectionLabel} htmlFor="issueTitle">
                    Issue Title <span className={styles.required}>*</span>
                  </label>
                  <input
                    id="issueTitle"
                    type="text"
                    className={styles.input}
                    placeholder="Short summary of the issue…"
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={100}
                    autoFocus
                  />
                  <p className={styles.charCount}>{title.length}/100</p>
                </div>

                {/* ── Receiving Plant (shown only when loc_options has plants) ── */}
                {plantOptions.length > 0 && (
                  <div className={styles.section}>
                    <label className={styles.sectionLabel} htmlFor="receivingPlant">
                      Receiving {plantLabel} <span className={styles.optional}>(optional)</span>
                    </label>
                    <p className={styles.sectionHint}>Which {plantLabel.toLowerCase()} should this go to?</p>
                    <div className={styles.selectWrap}>
                      <select
                        id="receivingPlant"
                        className={styles.select}
                        value={receivingPlant}
                        onChange={e => setReceivingPlant(e.target.value)}
                      >
                        <option value="">Any {plantLabel}…</option>
                        {plantOptions.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <span className={styles.chevron} aria-hidden="true">▾</span>
                    </div>
                  </div>
                )}

                {/* ── Receiving Department ── */}
                <div className={styles.section}>
                  <label className={styles.sectionLabel} htmlFor="receivingDept">
                    Assign To Department <span className={styles.required}>*</span>
                  </label>
                  <p className={styles.sectionHint}>Which team should resolve this issue?</p>
                  <div className={styles.selectWrap}>
                    <select
                      id="receivingDept"
                      className={styles.select}
                      value={receivingDept}
                      onChange={e => setReceivingDept(e.target.value)}
                    >
                      <option value="" disabled>Select department…</option>
                      {getDepts().map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                    <span className={styles.chevron} aria-hidden="true">▾</span>
                  </div>
                </div>

                {/* ── Priority ── */}
                <div className={styles.section}>
                  <p className={styles.sectionLabel}>Priority <span className={styles.required}>*</span></p>
                  <div className={styles.priorityRow}>
                    {Object.entries(PRIORITY_META).map(([key, meta]) => (
                      <button
                        key={key}
                        type="button"
                        className={`${styles.priorityBtn} ${priority === key ? styles.priorityBtnActive : ''}`}
                        style={priority === key
                          ? { background: meta.color, borderColor: meta.color, color: '#fff' }
                          : { borderColor: meta.color, color: meta.color }
                        }
                        onClick={() => setPriority(key)}
                      >
                        <span className={styles.priorityLabel}>{meta.label}</span>
                        <span className={styles.priorityDesc}>{meta.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

              </div>

              {/* ── RIGHT COLUMN ── */}
              <div className={styles.formCol}>

                {/* ── Description ── */}
                <div className={styles.section}>
                  <label className={styles.sectionLabel} htmlFor="description">
                    Description <span className={styles.required}>*</span>
                  </label>
                  <textarea
                    id="description"
                    className={styles.textarea}
                    rows={5}
                    placeholder="Describe the issue in detail — what happened, where exactly, impact, any relevant context…"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    maxLength={1000}
                  />
                  <p className={styles.charCount}>{description.length}/1000</p>
                </div>

                {/* ── Photo ── */}
                <div className={styles.section}>
                  <p className={styles.sectionLabel}>Photo <span className={styles.optional}>(optional)</span></p>
                  {!photoPreview ? (
                    <div className={styles.photoArea} onClick={() => fileInputRef.current?.click()}>
                      <Camera size={32} color="var(--text-muted)" />
                      <p className={styles.photoHint}>Tap to take a photo or upload</p>
                      <p className={styles.photoSub}>Camera will open on mobile</p>
                    </div>
                  ) : (
                    <div className={styles.photoPreviewWrap}>
                      <img src={photoPreview} alt="Issue photo" className={styles.photoPreview} />
                      <button type="button" className={styles.photoRemove} onClick={clearPhoto}>
                        <X size={16} />
                      </button>
                    </div>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className={styles.fileInput}
                    onChange={handleFileChange}
                  />
                  {!photoPreview && (
                    <button
                      type="button"
                      className={styles.uploadBtn}
                      onClick={() => {
                        if (fileInputRef.current) {
                          fileInputRef.current.removeAttribute('capture')
                          fileInputRef.current.click()
                          setTimeout(() => fileInputRef.current?.setAttribute('capture', 'environment'), 500)
                        }
                      }}
                    >
                      <Upload size={14} /> Upload from gallery
                    </button>
                  )}
                </div>

                {/* ── Submitted By ── */}
                <div className={styles.section}>
                  <label className={styles.sectionLabel} htmlFor="submittedBy">
                    Your Name <span className={styles.optional}>(optional — leave blank to stay anonymous)</span>
                  </label>
                  <input
                    id="submittedBy"
                    type="text"
                    className={styles.input}
                    placeholder="Anonymous"
                    value={submittedBy}
                    onChange={e => setSubmittedBy(e.target.value)}
                    maxLength={80}
                  />
                </div>

                {/* ── Error + Submit ── */}
                {error && <p className={styles.error}>{error}</p>}

                <button
                  type="submit"
                  className={styles.btn}
                  disabled={submitting}
                >
                  {submitting ? 'Submitting Issue…' : 'Submit Issue →'}
                </button>

              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
