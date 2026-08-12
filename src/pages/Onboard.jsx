import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  Check, Rocket, Globe, LayoutDashboard, ArrowRight, RefreshCw,
  Trash2, Settings, PlusCircle, Lock, Zap, ChevronDown, ChevronUp, Share2, Pencil,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import styles from './Onboard.module.css'

const LOGODEV_TOKEN = 'pk_cJ5kBAx5SJq_W-zDv2Rl1Q'

const DEFAULT_DEPARTMENTS = [
  'Manufacturing', 'Quality', 'Safety', 'Maintenance',
  'Engineering', 'Logistics', 'HR', 'IT', 'Other',
]

/** Extract dominant brand colors from an image URL via canvas pixel sampling. */
function extractColorsFromUrl(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const SIZE = 60
        const canvas = document.createElement('canvas')
        canvas.width = SIZE; canvas.height = SIZE
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0, SIZE, SIZE)
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE)
        const buckets = {}
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
          if (a < 100) continue
          const avg = (r + g + b) / 3
          if (avg > 235 || avg < 20) continue
          if (Math.max(r,g,b) - Math.min(r,g,b) < 25) continue
          const qr = Math.round(r / 17) * 17
          const qg = Math.round(g / 17) * 17
          const qb = Math.round(b / 17) * 17
          const key = `${qr},${qg},${qb}`
          buckets[key] = (buckets[key] || 0) + 1
        }
        const sorted = Object.entries(buckets)
          .sort((a, b) => b[1] - a[1])
          .map(([key]) => {
            const [r, g, b] = key.split(',').map(Number)
            return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`
          })
        resolve({ primary: sorted[0] || null, secondary: sorted[1] || null })
      } catch {
        resolve({ primary: null, secondary: null })
      }
    }
    img.onerror = () => resolve({ primary: null, secondary: null })
    img.src = url
  })
}

const MASTER_PASSWORD = 'autorise123'

export default function Onboard() {
  const [unlocked, setUnlocked]           = useState(false)
  const [masterInput, setMasterInput]     = useState('')
  const [masterError, setMasterError]     = useState('')
  const [view, setView]                   = useState('create')

  // Create tab
  const [companyName, setCompanyName]     = useState('')
  const [website, setWebsite]             = useState('')
  const [logoUrl, setLogoUrl]             = useState('')
  const [brandPrimary, setBrandPrimary]   = useState('')
  const [brandSecondary, setBrandSecondary] = useState('')
  const [fetchingBrand, setFetchingBrand] = useState(false)
  const [fetchMsg, setFetchMsg]           = useState('')
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')
  const [result, setResult]               = useState(null)
  const [copied, setCopied]               = useState('')

  // Manage tab
  const [companies, setCompanies]         = useState([])
  const [editId, setEditId]               = useState(null)
  const [editData, setEditData]           = useState(null)
  const [savingEdit, setSavingEdit]       = useState(false)
  const [editMsg, setEditMsg]             = useState('')
  const [shareMsg, setShareMsg]           = useState('')

  const navigate = useNavigate()

  function handleUnlock(e) {
    e.preventDefault()
    if (masterInput === MASTER_PASSWORD) {
      setUnlocked(true); setMasterError('')
    } else {
      setMasterError('Incorrect password. Try again.'); setMasterInput('')
    }
  }

  async function fetchCompanies() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('companies').select('*').order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setCompanies(data || [])
    setLoading(false)
  }

  function handleToggleView(newView) {
    setView(newView)
    if (newView === 'manage') fetchCompanies()
  }

  function slugify(text) {
    return text.toString().toLowerCase().trim()
      .replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-')
  }

  async function fetchBrand() {
    if (!website.trim()) return
    setFetchingBrand(true); setFetchMsg('')
    try {
      let domain = website.trim().toLowerCase()
      try { domain = new URL(domain.startsWith('http') ? domain : `https://${domain}`).hostname } catch {}
      domain = domain.replace(/^www\./, '')
      const generatedLogoUrl = `https://img.logo.dev/${domain}?token=${LOGODEV_TOKEN}&size=200&format=png`
      setLogoUrl(generatedLogoUrl)
      const { primary, secondary } = await extractColorsFromUrl(generatedLogoUrl)
      if (primary)   setBrandPrimary(primary)
      if (secondary) setBrandSecondary(secondary)
      setFetchMsg(primary ? '✓ Logo and colors fetched automatically' : '✓ Logo fetched — enter colors manually')
    } catch {
      setFetchMsg('Could not parse domain — check the website URL')
    } finally {
      setFetchingBrand(false)
    }
  }

  async function handleOnboard(e) {
    e.preventDefault()
    if (!companyName.trim()) return
    setLoading(true); setError('')
    const slug = slugify(companyName)
    try {
      const payload = { name: companyName.trim(), slug, departments: DEFAULT_DEPARTMENTS }
      if (logoUrl.trim())        payload.logo_url        = logoUrl.trim()
      if (brandPrimary.trim())   payload.brand_primary   = brandPrimary.trim()
      if (brandSecondary.trim()) payload.brand_secondary = brandSecondary.trim()

      const { data: company, error: compErr } = await supabase
        .from('companies').insert(payload).select().single()
      if (compErr) throw new Error(compErr.message)

      const demoPassword = `${slug}123`
      const { error: managerErr } = await supabase
        .from('managers').insert({
          company_id: company.id,
          name: 'Admin',
          username: 'admin',
          password: demoPassword,
          department: 'Manufacturing',
        })
      if (managerErr) throw new Error(managerErr.message)

      setResult({
        name:       company.name,
        slug:       company.slug,
        url:        `${window.location.origin}/${company.slug}`,
        dashUrl:    `${window.location.origin}/admin/${company.slug}`,
        username:   'admin',
        password:   demoPassword,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteCompany(id, name) {
    if (!window.confirm(`Delete "${name}" and all its data? This cannot be undone.`)) return
    setLoading(true)
    const { error: err } = await supabase.from('companies').delete().eq('id', id)
    if (err) alert(err.message)
    else setCompanies(companies.filter(c => c.id !== id))
    setLoading(false)
  }

  function openEdit(company) {
    const ll = company.loc_labels || {}
    const lo = company.loc_options || {}
    setEditId(company.id)
    setEditMsg('')
    setEditData({
      name:            company.name || '',
      logo_url:        company.logo_url || '',
      brand_primary:   company.brand_primary || '',
      brand_secondary: company.brand_secondary || '',
      label1: ll.level1 ?? 'Plant',
      label2: ll.level2 ?? 'Department',
      label3: ll.level3 ?? 'Zone',
      label4: ll.level4 ?? 'Area',
      opts_plant:      (lo.plant || []).join(', '),
      opts_department: (lo.department || []).join(', '),
      opts_zone:       (lo.zone || []).join(', '),
      opts_area:       (lo.area || []).join(', '),
      departments:     (Array.isArray(company.departments) ? company.departments : DEFAULT_DEPARTMENTS).join(', '),
    })
  }

  function closeEdit() { setEditId(null); setEditData(null); setEditMsg('') }

  async function saveEdit(companyId) {
    setSavingEdit(true); setEditMsg('')
    const payload = {
      name:            editData.name.trim(),
      logo_url:        editData.logo_url.trim() || null,
      brand_primary:   editData.brand_primary.trim() || null,
      brand_secondary: editData.brand_secondary.trim() || null,
      loc_labels: {
        level1: editData.label1.trim() || 'Plant',
        level2: editData.label2.trim() || 'Department',
        level3: editData.label3.trim() || 'Zone',
        level4: editData.label4.trim() || 'Area',
      },
      loc_options: {
        plant:      editData.opts_plant.split(',').map(s => s.trim()).filter(Boolean),
        department: editData.opts_department.split(',').map(s => s.trim()).filter(Boolean),
        zone:       editData.opts_zone.split(',').map(s => s.trim()).filter(Boolean),
        area:       editData.opts_area.split(',').map(s => s.trim()).filter(Boolean),
      },
      departments: editData.departments.split(',').map(s => s.trim()).filter(Boolean),
    }
    const { error: err } = await supabase.from('companies').update(payload).eq('id', companyId)
    if (err) { setEditMsg(err.message) }
    else {
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, ...payload } : c))
      closeEdit()
    }
    setSavingEdit(false)
  }

  function buildShareText({ slug, name, url, dashUrl, username, password }) {
    const registerUrl = `${window.location.origin}/register/${slug}`
    return `Hey! Your ${name} Issue Tracker is all set up and ready to go.

Submit issues: ${url}
Manager dashboard: ${dashUrl}
New team lead signup: ${registerUrl}

Dashboard login:
  Username: ${username}
  Password: ${password}

Let me know if you need anything — AutoRise LLC (autoriseconsulting.com)`
  }

  async function shareResult() {
    const text = buildShareText(result)
    try {
      if (navigator.share) {
        await navigator.share({ title: `${result.name} — GITS Access`, text })
      } else {
        await navigator.clipboard.writeText(text)
        setCopied('share')
        setTimeout(() => setCopied(''), 2500)
      }
    } catch {}
  }

  async function shareCompany(company) {
    const password = `${company.slug}123`
    const url      = `${window.location.origin}/${company.slug}`
    const dashUrl  = `${window.location.origin}/admin/${company.slug}`
    const text = buildShareText({ slug: company.slug, name: company.name, url, dashUrl, username: 'admin', password })
    try {
      if (navigator.share) {
        await navigator.share({ title: `${company.name} — GITS Access`, text })
      } else {
        await navigator.clipboard.writeText(text)
        setShareMsg(company.id)
        setTimeout(() => setShareMsg(''), 2500)
      }
    } catch {}
  }

  function copyToClipboard(text, key) {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  // ── Master Password Gate ──────────────────────────────────
  if (!unlocked) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.header}>
            <div className={styles.logoBadge}><Lock size={24} color="#6EDFA0" /></div>
            <h1 className={styles.title}>GITS Onboard Portal</h1>
            <p className={styles.subtitle}>Enter the master password to access this portal.</p>
          </div>
          <form className={styles.onboardForm} onSubmit={handleUnlock}>
            <div className={styles.field}>
              <label className={styles.label}>Master Password</label>
              <input
                className={styles.input} type="password"
                placeholder="Enter master password"
                value={masterInput} onChange={e => setMasterInput(e.target.value)}
                autoFocus required
              />
            </div>
            {masterError && <p className={styles.error}>{masterError}</p>}
            <button className={styles.submitBtn} type="submit">
              Unlock Portal <ArrowRight size={18} />
            </button>
          </form>
          <div className={styles.footer}><p>© 2026 AutoRise LLC · Authorize AutoRise</p></div>
        </div>
      </div>
    )
  }

  // ── Main Portal ───────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.container}>

        <div className={styles.header}>
          <div className={styles.logoBadge}><Rocket size={24} color="#6EDFA0" /></div>
          <h1 className={styles.title}>GITS Onboard Portal</h1>
          <p className={styles.subtitle}>Provision a new company and configure their issue tracking environment.</p>
        </div>

        {!result ? (
          <>
            <div className={styles.tabNav}>
              <button
                className={`${styles.tabBtn} ${view === 'create' ? styles.tabBtnActive : ''}`}
                onClick={() => handleToggleView('create')}
              >
                <PlusCircle size={18} /> Create
              </button>
              <button
                className={`${styles.tabBtn} ${view === 'manage' ? styles.tabBtnActive : ''}`}
                onClick={() => handleToggleView('manage')}
              >
                <Settings size={18} /> Manage
              </button>
            </div>

            {view === 'create' ? (
              <form className={styles.onboardForm} onSubmit={handleOnboard}>

                <div className={styles.field}>
                  <label className={styles.label}>Company Name</label>
                  <input
                    className={styles.input} type="text"
                    placeholder="e.g. SteelWorks Manufacturing"
                    value={companyName} onChange={e => setCompanyName(e.target.value)}
                    required autoFocus
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Company Website</label>
                  <div className={styles.websiteRow}>
                    <input
                      className={styles.input} type="text"
                      placeholder="e.g. milbankworks.com"
                      value={website}
                      onChange={e => { setWebsite(e.target.value); setFetchMsg('') }}
                    />
                    <button
                      type="button" className={styles.fetchBtn}
                      onClick={fetchBrand} disabled={fetchingBrand || !website.trim()}
                    >
                      {fetchingBrand ? <RefreshCw size={15} className={styles.spin} /> : <Zap size={15} />}
                      {fetchingBrand ? 'Fetching…' : 'Auto-fetch Brand'}
                    </button>
                  </div>
                  {fetchMsg && (
                    <p className={fetchMsg.startsWith('✓') ? styles.fetchSuccess : styles.fetchError}>
                      {fetchMsg}
                    </p>
                  )}
                </div>

                <div className={styles.field}>
                  <label className={styles.label}>Logo URL <span className={styles.optional}>(auto-filled or manual)</span></label>
                  {logoUrl && (
                    <div className={styles.logoPreview}>
                      <img src={logoUrl} alt="Logo preview" className={styles.logoPreviewImg} />
                    </div>
                  )}
                  <input
                    className={styles.input} type="url"
                    placeholder="https://img.logo.dev/company.com?token=…"
                    value={logoUrl} onChange={e => setLogoUrl(e.target.value)}
                  />
                </div>

                <div className={styles.colorRow}>
                  <div className={styles.field}>
                    <label className={styles.label}>Primary Color <span className={styles.optional}>(optional)</span></label>
                    <div className={styles.colorInputWrap}>
                      <input className={styles.colorSwatch} type="color"
                        value={brandPrimary || '#0F1F3D'} onChange={e => setBrandPrimary(e.target.value)} />
                      <input className={styles.input} type="text" placeholder="#0F1F3D"
                        value={brandPrimary} onChange={e => setBrandPrimary(e.target.value)} maxLength={7} />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.label}>Accent Color <span className={styles.optional}>(optional)</span></label>
                    <div className={styles.colorInputWrap}>
                      <input className={styles.colorSwatch} type="color"
                        value={brandSecondary || '#6EDFA0'} onChange={e => setBrandSecondary(e.target.value)} />
                      <input className={styles.input} type="text" placeholder="#6EDFA0"
                        value={brandSecondary} onChange={e => setBrandSecondary(e.target.value)} maxLength={7} />
                    </div>
                  </div>
                </div>

                {error && <p className={styles.error}>{error}</p>}
                <button className={styles.submitBtn} type="submit" disabled={loading}>
                  {loading
                    ? <><RefreshCw size={18} className={styles.spin} /> Provisioning…</>
                    : <>Onboard Company <ArrowRight size={18} /></>
                  }
                </button>
                <p className={styles.disclaimer}>
                  Creates the company record, default departments, and an admin login. Access code = slug + "123".
                </p>
              </form>

            ) : (
              <div className={styles.manageSection}>
                <div className={styles.companyList}>
                  {loading && <div className={styles.emptyState}>Loading companies…</div>}
                  {!loading && companies.length === 0 && (
                    <div className={styles.emptyState}>No companies found.</div>
                  )}
                  {companies.map(company => (
                    <div key={company.id} className={styles.companyItem}>
                      <div className={styles.companyInfo}>
                        <span className={styles.companyName}>{company.name}</span>
                        <span className={styles.companySlug}>/{company.slug}</span>
                      </div>
                      <div className={styles.companyActions}>
                        <button
                          className={styles.shareManageBtn}
                          onClick={() => shareCompany(company)}
                          title="Share credentials"
                        >
                          {shareMsg === company.id ? <Check size={13} /> : <Share2 size={13} />}
                        </button>
                        <button
                          className={styles.editBtn}
                          onClick={() => editId === company.id ? closeEdit() : openEdit(company)}
                          title="Edit company"
                        >
                          {editId === company.id ? <ChevronUp size={14} /> : <Pencil size={13} />}
                        </button>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDeleteCompany(company.id, company.name)}
                          disabled={loading} title="Delete company"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {editId === company.id && editData && (
                        <div className={styles.editPanel}>
                          <p className={styles.editSectionTitle}>Company Info</p>
                          <div className={styles.editField}>
                            <label className={styles.editLabel}>Name</label>
                            <input className={styles.editInput} value={editData.name}
                              onChange={e => setEditData(p => ({ ...p, name: e.target.value }))} />
                          </div>
                          <div className={styles.editField}>
                            <label className={styles.editLabel}>Logo URL</label>
                            <input className={styles.editInput} value={editData.logo_url} placeholder="https://…"
                              onChange={e => setEditData(p => ({ ...p, logo_url: e.target.value }))} />
                          </div>

                          <p className={styles.editSectionTitle}>Brand Colors</p>
                          <div className={styles.editColorRow}>
                            <div className={styles.editField}>
                              <label className={styles.editLabel}>Primary</label>
                              <div className={styles.editColorWrap}>
                                <input type="color" className={styles.editColorSwatch}
                                  value={editData.brand_primary || '#0F1F3D'}
                                  onChange={e => setEditData(p => ({ ...p, brand_primary: e.target.value }))} />
                                <input className={styles.editInput} value={editData.brand_primary} placeholder="#0F1F3D" maxLength={7}
                                  onChange={e => setEditData(p => ({ ...p, brand_primary: e.target.value }))} />
                              </div>
                            </div>
                            <div className={styles.editField}>
                              <label className={styles.editLabel}>Accent</label>
                              <div className={styles.editColorWrap}>
                                <input type="color" className={styles.editColorSwatch}
                                  value={editData.brand_secondary || '#6EDFA0'}
                                  onChange={e => setEditData(p => ({ ...p, brand_secondary: e.target.value }))} />
                                <input className={styles.editInput} value={editData.brand_secondary} placeholder="#6EDFA0" maxLength={7}
                                  onChange={e => setEditData(p => ({ ...p, brand_secondary: e.target.value }))} />
                              </div>
                            </div>
                          </div>

                          <p className={styles.editSectionTitle}>Location Labels</p>
                          <div className={styles.editLabelRow}>
                            {[['label1','Level 1'],['label2','Level 2'],['label3','Level 3'],['label4','Level 4']].map(([k, hint]) => (
                              <div key={k} className={styles.editField}>
                                <label className={styles.editLabel}>{hint}</label>
                                <input className={styles.editInput} value={editData[k]}
                                  onChange={e => setEditData(p => ({ ...p, [k]: e.target.value }))} />
                              </div>
                            ))}
                          </div>

                          <p className={styles.editSectionTitle}>Location Options <span className={styles.editHint}>(comma-separated)</span></p>
                          {[['opts_plant', editData.label1 || 'Plant'], ['opts_department', editData.label2 || 'Department'], ['opts_zone', editData.label3 || 'Zone'], ['opts_area', editData.label4 || 'Area']].map(([k, lbl]) => (
                            <div key={k} className={styles.editField}>
                              <label className={styles.editLabel}>{lbl} options</label>
                              <textarea className={styles.editTextarea} rows={2} value={editData[k]}
                                onChange={e => setEditData(p => ({ ...p, [k]: e.target.value }))} />
                            </div>
                          ))}

                          <p className={styles.editSectionTitle}>Departments <span className={styles.editHint}>(comma-separated)</span></p>
                          <div className={styles.editField}>
                            <textarea className={styles.editTextarea} rows={2} value={editData.departments}
                              onChange={e => setEditData(p => ({ ...p, departments: e.target.value }))} />
                          </div>

                          {editMsg && <p className={styles.editError}>{editMsg}</p>}
                          <div className={styles.deptEditFooter}>
                            <button className={styles.deptCancelBtn} onClick={closeEdit}>Cancel</button>
                            <button className={styles.deptSaveBtn} onClick={() => saveEdit(company.id)} disabled={savingEdit}>
                              {savingEdit ? 'Saving…' : 'Save Changes'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={styles.resultCard}>
            <div className={styles.successBadge}><Check size={32} /></div>
            <h2 className={styles.resultTitle}>{result.name} is Live</h2>

            <div className={styles.qrWrapper}>
              <QRCodeSVG value={result.url} size={180} includeMargin fgColor="#0F1F3D" />
              <p className={styles.qrHint}>Scan to open Issue Submit App</p>
            </div>

            <div className={styles.linksStack}>
              <div className={styles.linkItem}>
                <div className={styles.linkInfo}><Globe size={16} /><span>Issue Submit App</span></div>
                <button className={styles.copyBtn} onClick={() => copyToClipboard(result.url, 'submit')}>
                  {copied === 'submit' ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
              <div className={styles.linkItem}>
                <div className={styles.linkInfo}><LayoutDashboard size={16} /><span>Issue Dashboard</span></div>
                <button className={styles.copyBtn} onClick={() => copyToClipboard(result.dashUrl, 'dash')}>
                  {copied === 'dash' ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            </div>

            <div className={styles.credentialsCard}>
              <p className={styles.credLabel}>ISSUE TEAM LOGIN</p>
              <div className={styles.credRow}><span>Access Code:</span> <strong>{result.password}</strong></div>
              <div className={styles.credRow}><span>Username:</span> <strong>{result.username}</strong></div>
              <div className={styles.credRow}><span>Password:</span> <strong>{result.password}</strong></div>
            </div>

            <button className={styles.shareBtn} onClick={shareResult}>
              <Share2 size={15} />
              {copied === 'share' ? 'Copied to clipboard!' : 'Share Credentials'}
            </button>

            <button className={styles.resetBtn} onClick={() => {
              setResult(null); setCompanyName(''); setWebsite(''); setLogoUrl('')
              setBrandPrimary(''); setBrandSecondary(''); setFetchMsg('')
            }}>
              ← Provision Another Company
            </button>
          </div>
        )}

        <div className={styles.footer}><p>© 2026 AutoRise LLC · Authorize AutoRise</p></div>
      </div>
    </div>
  )
}
