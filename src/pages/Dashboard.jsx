import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  AlertCircle, Wrench, CheckCircle2, Archive,
  LogOut, Trash2, X, BarChart2, List, Search, SlidersHorizontal,
  ChevronDown, MapPin, User, FileText, ZoomIn,
  Download, Table2, Calendar, Users, Bell, ClipboardList, ArrowRight, Clock,
  MessageSquare, Plus, CheckSquare, Square,
} from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Cell, PieChart, Pie, AreaChart, Area,
} from 'recharts'
import { getSession, saveSession, clearSession } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { useCompany } from '../hooks/useCompany'
import styles from './Dashboard.module.css'

// ── Constants ──────────────────────────────────────────────
const STATUS_META = {
  'Open':        { label: 'Open',        color: 'var(--status-open)',       Icon: AlertCircle  },
  'In Progress': { label: 'In Progress', color: 'var(--status-inprogress)', Icon: Wrench       },
  'Resolved':    { label: 'Resolved',    color: 'var(--status-resolved)',    Icon: CheckCircle2 },
  'Closed':      { label: 'Closed',      color: 'var(--status-closed)',      Icon: Archive      },
}
const NEXT_ACTIONS = {
  'Open':        ['In Progress', 'Resolved', 'Closed'],
  'In Progress': ['Resolved', 'Closed', 'Open'],
  'Resolved':    ['Closed', 'Open'],
  'Closed':      ['Open'],
}
const PRIORITY_META = {
  Low:      { color: 'var(--priority-low)',      bg: 'rgba(27,110,60,0.1)'   },
  Medium:   { color: 'var(--priority-medium)',   bg: 'rgba(200,139,0,0.1)'   },
  High:     { color: 'var(--priority-high)',     bg: 'rgba(192,75,21,0.1)'   },
  Critical: { color: 'var(--priority-critical)', bg: 'rgba(185,28,28,0.1)'   },
}
const PRIORITY_ORDER = ['Critical', 'High', 'Medium', 'Low']
const STATUS_HEX = { 'Open': '#C04B15', 'In Progress': '#2563EB', 'Resolved': '#1B6E3C', 'Closed': '#64748B' }
const CHART_COLORS = ['#C04B15', '#2563EB', '#1B6E3C', '#C88B00', '#6EDFA0', '#7C3AED', '#0891B2', '#EA580C']
const tooltipStyle = {
  contentStyle: { background: '#fff', border: '1px solid rgba(15,31,61,0.12)', borderRadius: 8, fontSize: 13 },
  labelStyle:   { color: '#0F1F3D', fontWeight: 700 },
}

// ── Helpers ────────────────────────────────────────────────
function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
function issuingStr(r) {
  return [r.issuing_plant, r.issuing_dept, r.issuing_zone, r.issuing_area]
    .filter(v => v && v !== 'N/A').join(' › ') || '—'
}
function avgResolutionHours(issues) {
  const done = issues.filter(r => r.resolved_at && (r.status === 'Resolved' || r.status === 'Closed'))
  if (!done.length) return null
  const total = done.reduce((s, r) => s + (new Date(r.resolved_at) - new Date(r.created_at)), 0)
  return Math.round(total / done.length / 3600000)
}

// ── Chart builders ─────────────────────────────────────────
function buildChartData(issues, trendMode = 'daily') {
  const deptMap = {}
  issues.forEach(r => { const d = r.receiving_dept || 'Unknown'; deptMap[d] = (deptMap[d] || 0) + 1 })
  const byDept = Object.entries(deptMap).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => ({ name, count }))

  const areaMap = {}
  issues.forEach(r => {
    const parts = [r.issuing_plant, r.issuing_dept].filter(v => v && v !== 'N/A')
    const key = parts.join(' › ') || 'Unknown'
    areaMap[key] = (areaMap[key] || 0) + 1
  })
  const byArea = Object.entries(areaMap).map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count).slice(0, 8)

  const prioMap = { Low: 0, Medium: 0, High: 0, Critical: 0 }
  issues.forEach(r => { if (prioMap[r.priority] !== undefined) prioMap[r.priority]++ })
  const byPriority = PRIORITY_ORDER.map(p => ({ name: p, count: prioMap[p] }))

  const statMap = { Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0 }
  issues.forEach(r => { if (statMap[r.status] !== undefined) statMap[r.status]++ })
  const byStatus = Object.entries(statMap).map(([name, count]) => ({ name, count }))

  let trend
  if (trendMode === 'daily') {
    const dayMap = {}
    issues.forEach(r => { const d = r.created_at.split('T')[0]; dayMap[d] = (dayMap[d] || 0) + 1 })
    trend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (13 - i))
      const key = d.toISOString().split('T')[0]
      return { date: key.slice(5).replace('-', '/'), count: dayMap[key] || 0 }
    })
  } else if (trendMode === 'weekly') {
    trend = Array.from({ length: 6 }, (_, i) => {
      const end = new Date(); end.setDate(end.getDate() - i * 7); end.setHours(23, 59, 59, 999)
      const start = new Date(end); start.setDate(start.getDate() - 6); start.setHours(0, 0, 0, 0)
      const count = issues.filter(r => { const t = new Date(r.created_at); return t >= start && t <= end }).length
      const label = `${(start.getMonth()+1)}/${start.getDate()}–${(end.getMonth()+1)}/${end.getDate()}`
      return { date: label, count }
    }).reverse()
  } else {
    trend = Array.from({ length: 6 }, (_, i) => {
      const now = new Date()
      const y = now.getFullYear(), m = now.getMonth() - (5 - i)
      const start = new Date(y, m, 1); const end = new Date(y, m + 1, 0, 23, 59, 59, 999)
      const count = issues.filter(r => { const t = new Date(r.created_at); return t >= start && t <= end }).length
      const label = start.toLocaleString('default', { month: 'short', year: '2-digit' })
      return { date: label, count }
    })
  }

  return { byDept, byArea, byPriority, byStatus, trend }
}

// ── Export helpers ─────────────────────────────────────────
const DATE_RANGE_LABELS = { all: 'All Time', today: 'Today', '7d': 'Last 7 Days', '30d': 'Last 30 Days' }

function exportCSV(rows) {
  const headers = ['Date', 'Title', 'Priority', 'Status', 'Receiving Dept', 'Issuing Location', 'Submitted By', 'Description']
  const data = rows.map(r => [
    `"${new Date(r.created_at).toLocaleString()}"`,
    `"${(r.title || '').replace(/"/g, '""')}"`,
    r.priority,
    r.status,
    `"${r.receiving_dept || '—'}"`,
    `"${issuingStr(r)}"`,
    `"${r.submitted_by || 'Anonymous'}"`,
    `"${(r.description || '').replace(/"/g, '""')}"`,
  ].join(','))
  const csv  = [headers.join(','), ...data].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `issue-report-${new Date().toISOString().split('T')[0]}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function exportPDF({ filtered, company, filters }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const W   = doc.internal.pageSize.getWidth()
  const BRAND = {
    NAVY:   [15, 31, 61],  GREEN:  [27, 110, 60],  ORANGE: [192, 75, 21],
    AMBER:  [200, 139, 0], RED:    [185, 28, 28],  SLATE:  [100, 116, 139],
    MUTED:  [107, 114, 128], BORDER: [229, 231, 235], WHITE:  [255, 255, 255],
  }
  const PRIO_COLORS   = { Low: BRAND.GREEN, Medium: BRAND.AMBER, High: BRAND.ORANGE, Critical: BRAND.RED }
  const STATUS_COLORS = { 'Open': BRAND.ORANGE, 'In Progress': BRAND.AMBER, 'Resolved': BRAND.GREEN, 'Closed': BRAND.SLATE }

  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  doc.setFillColor(...BRAND.NAVY); doc.rect(0, 0, W, 4, 'F')
  doc.setTextColor(...BRAND.NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(22)
  doc.text('GLOBAL ISSUE REPORT', 14, 20)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(company?.name?.toUpperCase() ?? '', 14, 27)
  doc.setTextColor(...BRAND.GREEN); doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.text('ISSUE TRACKING · AUTHORIZE AUTORISE', 14, 33)
  doc.setTextColor(...BRAND.MUTED); doc.setFont('helvetica', 'normal')
  doc.text(`Doc ID: GITS-${now.getTime().toString().slice(-6)} · Generated ${dateStr} at ${timeStr}`, 14, 38)

  const fp = []
  if (filters.dateRange !== 'all')  fp.push(`Period: ${DATE_RANGE_LABELS[filters.dateRange]}`)
  if (filters.status    !== 'all')  fp.push(`Status: ${filters.status}`)
  if (filters.priority  !== 'all')  fp.push(`Priority: ${filters.priority}`)
  if (filters.search)               fp.push(`Search: "${filters.search}"`)
  doc.setFontSize(8)
  doc.text(`Filters: ${fp.length ? fp.join(' · ') : 'All Issues'} · ${filtered.length} issue${filtered.length !== 1 ? 's' : ''}`, 14, 44)

  const statY = 50; const statW = (W - 28 - 9) / 4
  const stats = [
    { label: 'Open',        value: filtered.filter(r => r.status === 'Open').length,        color: BRAND.ORANGE },
    { label: 'In Progress', value: filtered.filter(r => r.status === 'In Progress').length, color: BRAND.AMBER  },
    { label: 'Resolved',    value: filtered.filter(r => r.status === 'Resolved').length,    color: BRAND.GREEN  },
    { label: 'Closed',      value: filtered.filter(r => r.status === 'Closed').length,      color: BRAND.SLATE  },
  ]
  stats.forEach((s, i) => {
    const x = 14 + i * (statW + 3)
    doc.setFillColor(...s.color); doc.roundedRect(x, statY, statW, 16, 2, 2, 'F')
    doc.setTextColor(...BRAND.WHITE); doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
    doc.text(String(s.value), x + statW / 2, statY + 9, { align: 'center' })
    doc.setFontSize(7); doc.setFont('helvetica', 'normal')
    doc.text(s.label.toUpperCase(), x + statW / 2, statY + 13.5, { align: 'center' })
  })

  autoTable(doc, {
    startY: statY + 22,
    head: [['Date', 'Title', 'Priority', 'Status', 'To Dept', 'From', 'Reporter']],
    body: filtered.map(r => [
      new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
      (r.title || '').slice(0, 42) + (r.title?.length > 42 ? '…' : ''),
      r.priority, r.status,
      r.receiving_dept || '—',
      issuingStr(r).slice(0, 26) + (issuingStr(r).length > 26 ? '…' : ''),
      r.submitted_by || 'Anonymous',
    ]),
    theme: 'grid',
    styles:     { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY, lineColor: BRAND.BORDER },
    headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 44 }, 2: { cellWidth: 16 }, 3: { cellWidth: 20 }, 4: { cellWidth: 24 }, 5: { cellWidth: 30 }, 6: { cellWidth: 'auto' } },
    didParseCell: (data) => {
      if (data.section !== 'body') return
      if (data.column.index === 2) { const c = PRIO_COLORS[data.cell.raw]; if (c) { data.cell.styles.textColor = c; data.cell.styles.fontStyle = 'bold' } }
      if (data.column.index === 3) { const c = STATUS_COLORS[data.cell.raw]; if (c) { data.cell.styles.textColor = c; data.cell.styles.fontStyle = 'bold' } }
    },
    margin: { left: 14, right: 14 },
  })

  if (filtered.length > 0) {
    doc.addPage()
    doc.setFillColor(...BRAND.NAVY); doc.rect(0, 0, W, 4, 'F')
    doc.setTextColor(...BRAND.NAVY); doc.setFont('helvetica', 'bold'); doc.setFontSize(16)
    doc.text('ANALYTICS SUMMARY', 14, 18)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...BRAND.MUTED)
    doc.text(`Based on ${filtered.length} issue${filtered.length !== 1 ? 's' : ''} · ${fp.length ? fp.join(' · ') : 'All Issues'}`, 14, 24)

    const deptMap = {}
    filtered.forEach(r => { deptMap[r.receiving_dept || 'Unknown'] = (deptMap[r.receiving_dept || 'Unknown'] || 0) + 1 })
    autoTable(doc, {
      startY: 30, head: [['Department', 'Count', 'Share']],
      body: Object.entries(deptMap).sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, c, `${Math.round(c / filtered.length * 100)}%`]),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY },
      headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' } },
      margin: { left: 14, right: W / 2 + 2 }, tableWidth: W / 2 - 16,
    })

    const prioMap = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    filtered.forEach(r => { if (prioMap[r.priority] !== undefined) prioMap[r.priority]++ })
    autoTable(doc, {
      startY: 30, head: [['Priority', 'Count', 'Share']],
      body: Object.entries(prioMap).map(([n, c]) => [n, c, `${Math.round(c / filtered.length * 100)}%`]),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY },
      headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' } },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) { const c = PRIO_COLORS[d.cell.raw]; if (c) { d.cell.styles.textColor = c; d.cell.styles.fontStyle = 'bold' } } },
      margin: { left: W / 2 + 2, right: 14 }, tableWidth: W / 2 - 16,
    })

    const statMap2 = { Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0 }
    filtered.forEach(r => { if (statMap2[r.status] !== undefined) statMap2[r.status]++ })
    const afterY = (doc.lastAutoTable?.finalY ?? 30) + 10
    autoTable(doc, {
      startY: afterY, head: [['Status', 'Count', 'Share']],
      body: Object.entries(statMap2).map(([n, c]) => [n, c, `${Math.round(c / filtered.length * 100)}%`]),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 3, font: 'helvetica', textColor: BRAND.NAVY },
      headStyles: { fillColor: BRAND.NAVY, textColor: BRAND.WHITE, fontStyle: 'bold', fontSize: 7.5 },
      columnStyles: { 0: { cellWidth: 35 }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' } },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 0) { const c = STATUS_COLORS[d.cell.raw]; if (c) { d.cell.styles.textColor = c; d.cell.styles.fontStyle = 'bold' } } },
      margin: { left: 14, right: W / 2 + 2 }, tableWidth: W / 2 - 16,
    })
  }

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i); const pH = doc.internal.pageSize.getHeight()
    doc.setFillColor(...BRAND.NAVY); doc.rect(0, pH - 10, W, 10, 'F')
    doc.setTextColor(...BRAND.WHITE); doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text('AUTHORIZE AUTORISE · autoriseconsulting.com', 14, pH - 3.5)
    doc.text(`Page ${i} of ${pageCount}`, W - 14, pH - 3.5, { align: 'right' })
  }
  doc.save(`issue-report-${now.toISOString().split('T')[0]}.pdf`)
}

// ── Login Form ───────────────────────────────────────────���─
function LoginForm({ companySlug, company, onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    const { data, error: err } = await supabase
      .from('managers').select('*')
      .eq('company_id', company.id).eq('username', username.trim().toLowerCase()).eq('password', password)
      .maybeSingle()
    setLoading(false)
    if (err || !data) { setError('Invalid username or password.'); return }
    saveSession(companySlug, data); onLogin(data)
  }

  return (
    <div className={styles.loginPage}>
      <button className={styles.homeBtn} onClick={() => navigate(`/${companySlug}`)}>← Home</button>
      <div className={styles.loginCard}>
        {company?.logo_url && <img src={company.logo_url} alt={company.name} className={styles.loginLogo} />}
        <p className={styles.loginBrand}>{company?.name}</p>
        <h1 className={styles.loginTitle}>Issue Dashboard</h1>
        <p className={styles.loginSub}>Team lead access only</p>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <input className={styles.loginInput} type="text" placeholder="Username"
            value={username} onChange={e => setUsername(e.target.value)} required autoFocus />
          <input className={styles.loginInput} type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <p className={styles.loginError}>{error}</p>}
          <button className={styles.loginBtn} type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In →'}
          </button>
        </form>
        <p className={styles.loginRegisterHint}>
          Need an account?{' '}
          <button className={styles.loginRegisterLink} onClick={() => navigate(`/register/${companySlug}`)}>
            Register
          </button>
        </p>
      </div>
    </div>
  )
}

// ── Lightbox ───────────────────────────────────────────────
function Lightbox({ url, onClose }) {
  return (
    <div className={styles.lightboxOverlay} onClick={onClose}>
      <button className={styles.lightboxClose} onClick={onClose}><X size={24} /></button>
      <img src={url} alt="Issue photo" className={styles.lightboxImg} onClick={e => e.stopPropagation()} />
    </div>
  )
}

// ── Filter Select (custom dropdown) ───────────────────────
function FilterSelect({ icon: Icon, value, onChange, options }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function h(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const selected = options.find(o => o.value === value)
  return (
    <div className={styles.customSelect} ref={ref}>
      <button type="button"
        className={`${styles.customSelectTrigger} ${open ? styles.customSelectOpen : ''}`}
        onClick={() => setOpen(o => !o)}
      >
        {Icon && <Icon size={13} />}
        <span>{selected?.label}</span>
        <ChevronDown size={13} className={`${styles.selectChev} ${open ? styles.selectChevOpen : ''}`} />
      </button>
      {open && (
        <div className={styles.customSelectMenu}>
          {options.map(o => (
            <button key={o.value} type="button"
              className={`${styles.customSelectItem} ${o.value === value ? styles.customSelectItemActive : ''}`}
              onClick={() => { onChange(o.value); setOpen(false) }}
            >{o.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────
export default function Dashboard() {
  const { companySlug } = useParams()
  const navigate        = useNavigate()
  const { company, loading: companyLoading } = useCompany(companySlug)

  const [session, setSession]               = useState(() => getSession(companySlug))
  const [issues, setIssues]                 = useState([])
  const [loading, setLoading]               = useState(false)
  const [tab, setTab]                       = useState('list')
  const [filterStatus, setFilterStatus]     = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [filterSearch, setFilterSearch]     = useState('')
  const [expandedId, setExpandedId]         = useState(null)
  const [lightboxUrl, setLightboxUrl]       = useState(null)
  const [assignedToMap, setAssignedToMap]   = useState({})
  const [savingAssigned, setSavingAssigned] = useState({})
  const [deletingId, setDeletingId]         = useState(null)
  const [areaMine, setAreaMine]             = useState(false)
  const [dateRange, setDateRange]           = useState('all')
  const [exportOpen, setExportOpen]         = useState(false)
  const [filtersOpen, setFiltersOpen]       = useState(false)
  const [toastMsg, setToastMsg]             = useState('')
  const [tasksMap, setTasksMap]             = useState({})
  const [commentsMap, setCommentsMap]       = useState({})
  const [newTaskText, setNewTaskText]       = useState({})
  const [newCommentText, setNewCommentText] = useState({})
  const [togglingTask, setTogglingTask]     = useState({})
  const [addingTask, setAddingTask]         = useState({})
  const [submittingComment, setSubmittingComment] = useState({})
  const [trendMode, setTrendMode]               = useState('daily')
  const [chartAreaFilter, setChartAreaFilter]   = useState('all')

  // ── Location filters ──────────────────────────────────────
  const [filterIssuingPlant, setFilterIssuingPlant] = useState('all')
  const [filterIssuingDept, setFilterIssuingDept]   = useState('all')

  const exportRef    = useRef(null)
  const toastTimer   = useRef(null)
  const prevLastSeen = useRef(localStorage.getItem(`gits_last_seen_${companySlug}`) || '')

  // Update last-seen when session is active
  useEffect(() => {
    if (session) localStorage.setItem(`gits_last_seen_${companySlug}`, new Date().toISOString())
  }, [companySlug, session])

  function showToast(msg) {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(''), 4000)
  }

  // ── Load issues ───────────────────────────────────────────
  const loadIssues = useCallback(async () => {
    if (!company) return
    setLoading(true)
    const { data } = await supabase
      .from('issues').select('*')
      .eq('company_id', company.id)
      .order('created_at', { ascending: false })
    setIssues(data || [])
    setLoading(false)
  }, [company])

  useEffect(() => { if (company && session) loadIssues() }, [company, session, loadIssues])

  // ── Realtime subscription ─────────────────────────────────
  useEffect(() => {
    if (!company || !session) return
    const channel = supabase
      .channel(`gits_issues_${company.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'issues',
        filter: `company_id=eq.${company.id}`,
      }, (payload) => {
        loadIssues()
        if (payload.eventType === 'INSERT' && session?.department &&
            payload.new?.receiving_dept === session.department) {
          showToast(`New issue for ${session.department}: "${payload.new.title}"`)
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [company, session, loadIssues])

  // ── Close export on outside click ────────────────────────
  useEffect(() => {
    function h(e) { if (exportRef.current && !exportRef.current.contains(e.target)) setExportOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  // ── Load tasks + comments when issue is expanded ─────────
  useEffect(() => {
    if (!expandedId) return
    supabase.from('issue_tasks').select('*').eq('issue_id', expandedId).order('created_at')
      .then(({ data }) => setTasksMap(prev => ({ ...prev, [expandedId]: data || [] })))
    supabase.from('issue_comments').select('*').eq('issue_id', expandedId).order('created_at')
      .then(({ data }) => setCommentsMap(prev => ({ ...prev, [expandedId]: data || [] })))
  }, [expandedId])

  // ── Actions ───────────────────────────────────────────────
  async function updateStatus(id, newStatus) {
    const patch = { status: newStatus }
    if (newStatus === 'Resolved' || newStatus === 'Closed') patch.resolved_at = new Date().toISOString()
    else patch.resolved_at = null
    await supabase.from('issues').update(patch).eq('id', id)
    setIssues(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  async function saveAssigned(id) {
    setSavingAssigned(prev => ({ ...prev, [id]: true }))
    const value = assignedToMap[id] ?? issues.find(r => r.id === id)?.assigned_to ?? ''
    await supabase.from('issues').update({ assigned_to: value }).eq('id', id)
    setIssues(prev => prev.map(r => r.id === id ? { ...r, assigned_to: value } : r))
    setSavingAssigned(prev => ({ ...prev, [id]: false }))
  }

  async function deleteIssue(id, photoUrl) {
    if (!window.confirm('Delete this issue? This cannot be undone.')) return
    setDeletingId(id)
    if (photoUrl) {
      const path = photoUrl.split('/issue-photos/')[1]
      if (path) await supabase.storage.from('issue-photos').remove([path])
    }
    await supabase.from('issues').delete().eq('id', id)
    setIssues(prev => prev.filter(r => r.id !== id))
    if (expandedId === id) setExpandedId(null)
    setDeletingId(null)
  }

  function handleLogout() { clearSession(companySlug); setSession(null) }

  // ── Task actions ──────────────────────────────────────────
  async function toggleTask(task, issueId) {
    setTogglingTask(prev => ({ ...prev, [task.id]: true }))
    const patch = {
      is_complete:  !task.is_complete,
      completed_by: !task.is_complete ? (session?.name || 'Anonymous') : null,
      completed_at: !task.is_complete ? new Date().toISOString() : null,
    }
    await supabase.from('issue_tasks').update(patch).eq('id', task.id)
    setTasksMap(prev => ({
      ...prev,
      [issueId]: (prev[issueId] || []).map(t => t.id === task.id ? { ...t, ...patch } : t),
    }))
    setTogglingTask(prev => ({ ...prev, [task.id]: false }))
  }

  async function addTask(issueId) {
    const text = (newTaskText[issueId] || '').trim()
    if (!text) return
    setAddingTask(prev => ({ ...prev, [issueId]: true }))
    const { data } = await supabase.from('issue_tasks')
      .insert({ issue_id: issueId, company_id: company.id, title: text, is_complete: false })
      .select().single()
    if (data) setTasksMap(prev => ({ ...prev, [issueId]: [...(prev[issueId] || []), data] }))
    setNewTaskText(prev => ({ ...prev, [issueId]: '' }))
    setAddingTask(prev => ({ ...prev, [issueId]: false }))
  }

  async function deleteTask(taskId, issueId) {
    await supabase.from('issue_tasks').delete().eq('id', taskId)
    setTasksMap(prev => ({ ...prev, [issueId]: (prev[issueId] || []).filter(t => t.id !== taskId) }))
  }

  // ── Comment actions ───────────────────────────────────────
  async function addComment(issueId) {
    const body = (newCommentText[issueId] || '').trim()
    if (!body) return
    setSubmittingComment(prev => ({ ...prev, [issueId]: true }))
    const { data } = await supabase.from('issue_comments')
      .insert({ issue_id: issueId, company_id: company.id, author: session?.name || 'Anonymous', body })
      .select().single()
    if (data) setCommentsMap(prev => ({ ...prev, [issueId]: [...(prev[issueId] || []), data] }))
    setNewCommentText(prev => ({ ...prev, [issueId]: '' }))
    setSubmittingComment(prev => ({ ...prev, [issueId]: false }))
  }

  // ── Auth gate ─────────────────────────────────────────────
  if (companyLoading) return <div className={styles.page} />
  if (!session) return <LoginForm companySlug={companySlug} company={company} onLogin={setSession} />

  // ── My Department logic ───────────────────────────────────
  const hasDept = !!(session?.department)
  function isMyDept(r) { return r.receiving_dept === session.department }

  // ── Filtering ─────────────────────────────────────────────
  const areaBase = areaMine ? issues.filter(isMyDept) : issues
  const dateFiltered = (() => {
    if (dateRange === 'all') return areaBase
    if (dateRange === 'today') {
      const s = new Date(); s.setHours(0, 0, 0, 0)
      return areaBase.filter(r => new Date(r.created_at) >= s)
    }
    const ms = dateRange === '7d' ? 7 * 86400000 : 30 * 86400000
    return areaBase.filter(r => new Date(r.created_at).getTime() >= Date.now() - ms)
  })()
  // Unique issuing location values for filters
  const allIssuingPlants = [...new Set(issues.map(r => r.issuing_plant).filter(v => v && v !== 'N/A'))].sort()
  const allIssuingDepts  = [...new Set(issues.map(r => r.issuing_dept).filter(v => v && v !== 'N/A'))].sort()

  const filtered = dateFiltered.filter(r => {
    if (filterStatus       !== 'all' && r.status       !== filterStatus)       return false
    if (filterPriority     !== 'all' && r.priority     !== filterPriority)     return false
    if (filterIssuingPlant !== 'all' && r.issuing_plant !== filterIssuingPlant) return false
    if (filterIssuingDept  !== 'all' && r.issuing_dept  !== filterIssuingDept)  return false
    if (filterSearch) {
      const q = filterSearch.toLowerCase()
      if (![r.title, r.description, r.receiving_dept, r.submitted_by, issuingStr(r)]
        .some(v => v?.toLowerCase().includes(q))) return false
    }
    return true
  })

  // ── Stats (always all-time) ───────────────────────���───────
  const openCount       = issues.filter(r => r.status === 'Open').length
  const inProgressCount = issues.filter(r => r.status === 'In Progress').length
  const resolvedCount   = issues.filter(r => r.status === 'Resolved').length
  const closedCount     = issues.filter(r => r.status === 'Closed').length

  // ── Notification badge (new issues for my dept since last visit) ──
  const newDeptCount = hasDept && prevLastSeen.current
    ? issues.filter(r =>
        r.receiving_dept === session.department &&
        new Date(r.created_at) > new Date(prevLastSeen.current)
      ).length
    : 0

  const allChartAreas = [...new Set(filtered.map(r => {
    const parts = [r.issuing_plant, r.issuing_dept].filter(v => v && v !== 'N/A')
    return parts.join(' › ') || 'Unknown'
  }))].sort()
  const chartFiltered = chartAreaFilter === 'all' ? filtered : filtered.filter(r => {
    const area = [r.issuing_plant, r.issuing_dept].filter(v => v && v !== 'N/A').join(' › ') || 'Unknown'
    return area === chartAreaFilter
  })
  const charts    = buildChartData(chartFiltered, trendMode)
  const avgHours  = avgResolutionHours(filtered)
  const activeFilterCount =
    (filterStatus !== 'all' ? 1 : 0) + (filterPriority !== 'all' ? 1 : 0) +
    (filterSearch.trim() ? 1 : 0) + (dateRange !== 'all' ? 1 : 0) + (areaMine ? 1 : 0) +
    (filterIssuingPlant !== 'all' ? 1 : 0) + (filterIssuingDept !== 'all' ? 1 : 0)

  return (
    <div className={styles.page}>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      {/* ── Toast ── */}
      {toastMsg && (
        <div className={styles.toast}>
          <Bell size={14} /><span>{toastMsg}</span>
        </div>
      )}

      {/* ── Top Bar ── */}
      <header className={styles.topBar}>
        <div className={styles.topBarLeft}>
          <button className={styles.topBarBrand} onClick={() => navigate(`/${companySlug}`)} title="Home">
            {company?.logo_url && <img src={company.logo_url} alt={company.name} className={styles.topBarLogo} />}
            <div>
              <p className={styles.topBarCompany}>{company?.name}</p>
              <p className={styles.topBarTitle}>Issue Dashboard</p>
            </div>
          </button>
        </div>
        <div className={styles.topBarRight}>
          <span className={styles.topBarUser}>{session.name}</span>
          <button className={styles.logoutBtn} onClick={handleLogout} title="Sign out"><LogOut size={16} /></button>
        </div>
      </header>

      {/* ── Tab Navigation ── */}
      <nav className={styles.tabs}>
        <button className={`${styles.tab} ${tab === 'list' ? styles.tabActive : ''}`} onClick={() => setTab('list')}>
          <List size={15} /> Issues
        </button>
        <button className={`${styles.tab} ${tab === 'charts' ? styles.tabActive : ''}`} onClick={() => setTab('charts')}>
          <BarChart2 size={15} /> Analytics
        </button>

        {/* Dept toggle + desktop inline filters */}
        <div className={styles.areaFilters}>
          {hasDept && (
            <button
              className={`${styles.areaFilterBtn} ${!areaMine ? styles.areaFilterActive : ''}`}
              onClick={() => setAreaMine(false)}
            >
              All Depts
            </button>
          )}
          {hasDept && (
            <button
              className={`${styles.areaFilterBtn} ${areaMine ? styles.areaFilterMineActive : ''}`}
              onClick={() => setAreaMine(true)}
            >
              My Dept
              {newDeptCount > 0 && !areaMine && (
                <span className={styles.newBadge}>{newDeptCount}</span>
              )}
            </button>
          )}
          <div className={styles.navInlineFilters}>
            <select className={styles.navSelect} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="all">All Statuses</option>
              {Object.keys(STATUS_META).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className={styles.navSelect} value={filterPriority} onChange={e => setFilterPriority(e.target.value)}>
              <option value="all">All Priorities</option>
              {PRIORITY_ORDER.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className={styles.navSelect} value={dateRange} onChange={e => setDateRange(e.target.value)}>
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
            </select>
            {allIssuingPlants.length > 0 && (
              <select className={styles.navSelect} value={filterIssuingPlant} onChange={e => setFilterIssuingPlant(e.target.value)}>
                <option value="all">All Plants</option>
                {allIssuingPlants.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {allIssuingDepts.length > 0 && (
              <select className={styles.navSelect} value={filterIssuingDept} onChange={e => setFilterIssuingDept(e.target.value)}>
                <option value="all">All Depts</option>
                {allIssuingDepts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </div>

          {/* Export — in area filters row, pushed right */}
          <div ref={exportRef} className={styles.exportWrap} style={{ marginLeft: 'auto' }}>
            <button
              className={`${styles.exportBtn} ${exportOpen ? styles.exportBtnActive : ''}`}
              onClick={() => setExportOpen(v => !v)}
            >
              <Download size={13} /><span>Export</span><ChevronDown size={11} />
            </button>
            {exportOpen && (
              <div className={styles.exportDropdown}>
                <button className={styles.exportDropdownItem} onClick={() => { setExportOpen(false); exportPDF({ filtered, company, filters: { dateRange, status: filterStatus, priority: filterPriority, search: filterSearch } }) }}>
                  <FileText size={13} /><span><strong>Report</strong> <em>.pdf</em></span>
                </button>
                <button className={styles.exportDropdownItem} onClick={() => { setExportOpen(false); exportCSV(filtered) }}>
                  <Table2 size={13} /><span><strong>Raw</strong> <em>.csv</em></span>
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>

      {/* Stat pills — full-width bar between tab nav and content */}
      <div className={styles.mobileStatPills}>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--status-open)' }}>{openCount} Open</span>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--status-inprogress)' }}>{inProgressCount} In Progress</span>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--status-resolved)' }}>{resolvedCount} Resolved</span>
        <span className={styles.mobileStatPill} style={{ '--s': 'var(--status-closed)' }}>{closedCount} Closed</span>
      </div>

      <div className={styles.content}>

        {/* ── LIST TAB ── */}
        {tab === 'list' && (
          <>
            <p className={styles.resultCount}>
              {filtered.length} issue{filtered.length !== 1 ? 's' : ''}{activeFilterCount > 0 ? ' (filtered)' : ''}
            </p>
            {loading && <p className={styles.emptyMsg}>Loading…</p>}
            {!loading && filtered.length === 0 && (
              <div className={styles.emptyState}>
                <CheckCircle2 size={36} color="var(--status-resolved)" />
                <p>No issues match your filters.</p>
              </div>
            )}
            <div className={styles.reportList}>
              {filtered.map(issue => {
                const prioMeta    = PRIORITY_META[issue.priority] || PRIORITY_META.Medium
                const statMeta    = STATUS_META[issue.status]     || STATUS_META['Open']
                const isExpanded  = expandedId === issue.id
                const currentAssigned = assignedToMap[issue.id] ?? issue.assigned_to ?? ''

                return (
                  <div key={issue.id}
                    className={`${styles.reportCard} ${issue.priority === 'Critical' ? styles.reportCritical : ''}`}
                  >
                    <div className={styles.cardHeader} onClick={() => setExpandedId(isExpanded ? null : issue.id)}>
                      <div className={styles.cardHeaderLeft}>
                        {issue.photo_url ? (
                          <div className={styles.photoThumb}
                            onClick={e => { e.stopPropagation(); setLightboxUrl(issue.photo_url) }}
                            title="Click to view photo"
                          >
                            <img src={issue.photo_url} alt="Issue" />
                            <div className={styles.photoThumbOverlay}><ZoomIn size={14} /></div>
                          </div>
                        ) : (
                          <div className={styles.photoPlaceholder} style={{ borderLeft: `3px solid ${prioMeta.color}` }}>
                            <ClipboardList size={20} color="var(--text-muted)" />
                          </div>
                        )}
                        <div className={styles.cardMeta}>
                          <p className={styles.issueTitle}>{issue.title}</p>
                          <p className={styles.receivingTag}>
                            <ArrowRight size={10} />{issue.receiving_dept || '—'}
                          </p>
                          <p className={styles.cardLocation}><MapPin size={11} />{issuingStr(issue)}</p>
                          <p className={styles.cardTime}>
                            {timeAgo(issue.created_at)}
                            {issue.submitted_by && issue.submitted_by !== 'Anonymous' && ` · ${issue.submitted_by}`}
                            {issue.assigned_to && ` · Assigned: ${issue.assigned_to}`}
                          </p>
                        </div>
                      </div>
                      <div className={styles.cardHeaderRight}>
                        <span className={styles.severityBadge} style={{ color: prioMeta.color, background: prioMeta.bg }}>
                          {issue.priority}
                        </span>
                        <span className={styles.statusBadge} style={{ color: statMeta.color }}>
                          <statMeta.Icon size={12} />{issue.status}
                        </span>
                        <ChevronDown size={16} className={`${styles.expandChev} ${isExpanded ? styles.expandChevOpen : ''}`} />
                      </div>
                    </div>

                    {isExpanded && (
                      <div className={styles.cardDetail}>
                        {issue.description && (
                          <div className={styles.detailSection}>
                            <p className={styles.detailLabel}><FileText size={13} /> Description</p>
                            <p className={styles.detailText}>{issue.description}</p>
                          </div>
                        )}
                        {issue.photo_url && (
                          <div className={styles.detailSection}>
                            <p className={styles.detailLabel}><ZoomIn size={13} /> Photo</p>
                            <div className={styles.photoThumb}
                              style={{ width: '100%', height: 160, cursor: 'zoom-in' }}
                              onClick={() => setLightboxUrl(issue.photo_url)}
                            >
                              <img src={issue.photo_url} alt="Issue" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              <div className={styles.photoThumbOverlay}><ZoomIn size={18} /></div>
                            </div>
                          </div>
                        )}
                        <div className={styles.detailSection}>
                          <p className={styles.detailLabel}><User size={13} /> Assigned To</p>
                          <div className={styles.notesFooter}>
                            <input
                              className={styles.notesInput}
                              style={{ resize: 'none', height: 40, padding: '10px 12px' }}
                              placeholder="Unassigned — enter name…"
                              value={currentAssigned}
                              onChange={e => setAssignedToMap(prev => ({ ...prev, [issue.id]: e.target.value }))}
                              maxLength={80}
                            />
                            <button className={styles.saveNotesBtn}
                              onClick={() => saveAssigned(issue.id)}
                              disabled={savingAssigned[issue.id]}
                            >
                              {savingAssigned[issue.id] ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                        <div className={styles.detailSection}>
                          <p className={styles.detailLabel}>Update Status</p>
                          <div className={styles.actionBtns}>
                            {NEXT_ACTIONS[issue.status]?.map(next => {
                              const m = STATUS_META[next]
                              return (
                                <button key={next} className={styles.actionBtn}
                                  style={{ borderColor: m.color, color: m.color }}
                                  onClick={() => updateStatus(issue.id, next)}
                                >
                                  <m.Icon size={13} /> Mark {next}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        {/* ── Tasks / Checklist ── */}
                        <div className={styles.detailSection}>
                          <p className={styles.detailLabel}><ClipboardList size={13} /> Tasks</p>
                          <div className={styles.tasksList}>
                            {(tasksMap[issue.id] || []).length === 0 && (
                              <p className={styles.taskEmpty}>No tasks yet</p>
                            )}
                            {(tasksMap[issue.id] || []).map(task => (
                              <div key={task.id} className={`${styles.taskItem} ${task.is_complete ? styles.taskCompleted : ''}`}>
                                <button
                                  className={styles.taskCheckbox}
                                  onClick={() => toggleTask(task, issue.id)}
                                  disabled={togglingTask[task.id]}
                                  title={task.is_complete ? 'Mark incomplete' : 'Mark complete'}
                                >
                                  {task.is_complete
                                    ? <CheckSquare size={16} color="var(--status-resolved)" />
                                    : <Square size={16} color="var(--text-muted)" />
                                  }
                                </button>
                                <div className={styles.taskMeta}>
                                  <span className={styles.taskLabel}>{task.title}</span>
                                  {task.is_complete && task.completed_by && (
                                    <span className={styles.taskCompletedBy}>Done by {task.completed_by}</span>
                                  )}
                                </div>
                                <button className={styles.taskDeleteBtn} onClick={() => deleteTask(task.id, issue.id)} title="Remove task">
                                  <X size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className={styles.addTaskRow}>
                            <input
                              className={styles.addTaskInput}
                              placeholder="Add a task…"
                              value={newTaskText[issue.id] || ''}
                              onChange={e => setNewTaskText(prev => ({ ...prev, [issue.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTask(issue.id) } }}
                              maxLength={120}
                            />
                            <button
                              className={styles.addTaskBtn}
                              onClick={() => addTask(issue.id)}
                              disabled={addingTask[issue.id] || !(newTaskText[issue.id] || '').trim()}
                              title="Add task"
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                        </div>

                        {/* ── Comments ── */}
                        <div className={styles.detailSection}>
                          <p className={styles.detailLabel}><MessageSquare size={13} /> Comments</p>
                          <div className={styles.commentsList}>
                            {(commentsMap[issue.id] || []).length === 0 && (
                              <p className={styles.taskEmpty}>No comments yet</p>
                            )}
                            {(commentsMap[issue.id] || []).map(comment => (
                              <div key={comment.id} className={styles.commentItem}>
                                <div className={styles.commentHeader}>
                                  <span className={styles.commentAuthor}>{comment.author}</span>
                                  <span className={styles.commentTime}>{timeAgo(comment.created_at)}</span>
                                </div>
                                <p className={styles.commentBody}>{comment.body}</p>
                              </div>
                            ))}
                          </div>
                          <div className={styles.addCommentWrap}>
                            <textarea
                              className={styles.addCommentTextarea}
                              placeholder="Add a comment…"
                              rows={2}
                              value={newCommentText[issue.id] || ''}
                              onChange={e => setNewCommentText(prev => ({ ...prev, [issue.id]: e.target.value }))}
                              maxLength={500}
                            />
                            <button
                              className={styles.addCommentBtn}
                              onClick={() => addComment(issue.id)}
                              disabled={submittingComment[issue.id] || !(newCommentText[issue.id] || '').trim()}
                            >
                              {submittingComment[issue.id] ? 'Posting…' : 'Post Comment'}
                            </button>
                          </div>
                        </div>

                        <button className={styles.deleteBtn}
                          onClick={() => deleteIssue(issue.id, issue.photo_url)}
                          disabled={deletingId === issue.id}
                        >
                          <Trash2 size={14} />{deletingId === issue.id ? 'Deleting…' : 'Delete Issue'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ── CHARTS TAB ── */}
        {tab === 'charts' && (
          <>
            {/* Analytics filters bar */}
            <div className={styles.analyticsFilters}>
              <select className={styles.analyticsSelect} value={chartAreaFilter}
                onChange={e => setChartAreaFilter(e.target.value)}>
                <option value="all">All Areas</option>
                {allChartAreas.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
              {chartAreaFilter !== 'all' && (
                <button className={styles.analyticsClearBtn} onClick={() => setChartAreaFilter('all')}>
                  Clear
                </button>
              )}
              <span className={styles.analyticsCount}>
                {chartFiltered.length} issue{chartFiltered.length !== 1 ? 's' : ''}
                {chartAreaFilter !== 'all' ? ' (area filtered)' : activeFilterCount > 0 ? ' (filtered)' : ''}
              </span>
            </div>

            {avgHours !== null && (
              <div className={styles.avgResCard}>
                <Clock size={16} color="var(--status-inprogress)" />
                <span><strong>{avgHours}h</strong> avg resolution time ({filtered.filter(r => r.resolved_at).length} resolved/closed)</span>
              </div>
            )}
            <div className={styles.chartsGrid}>

              <div className={styles.chartCard}>
                <p className={styles.chartTitle}>Issues by Receiving Department</p>
                {charts.byDept.length === 0 ? <p className={styles.chartEmpty}>No data yet</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={charts.byDept} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,31,61,0.07)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                      <Tooltip {...tooltipStyle} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {charts.byDept.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className={styles.chartCard}>
                <p className={styles.chartTitle}>Issues by Issuing Area</p>
                {charts.byArea.length === 0 ? <p className={styles.chartEmpty}>No data yet</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={charts.byArea} layout="vertical" margin={{ left: 0, right: 12, top: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,31,61,0.07)" />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                      <Tooltip {...tooltipStyle} />
                      <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                        {charts.byArea.map((_, i) => <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className={styles.chartCard}>
                <p className={styles.chartTitle}>Issues by Priority</p>
                {chartFiltered.length === 0 ? <p className={styles.chartEmpty}>No data yet</p> : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={charts.byPriority.filter(d => d.count > 0)} dataKey="count" nameKey="name"
                        cx="50%" cy="50%" outerRadius={80}
                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      >
                        {charts.byPriority.map(p => (
                          <Cell key={p.name} fill={(PRIORITY_META[p.name] || {}).color || '#ccc'} />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              <div className={styles.chartCard}>
                <div className={styles.chartTitleRow}>
                  <p className={styles.chartTitle}>Volume Trend</p>
                  <div className={styles.trendSelector}>
                    {[['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']].map(([v, l]) => (
                      <button key={v}
                        className={`${styles.trendBtn} ${trendMode === v ? styles.trendBtnActive : ''}`}
                        onClick={() => setTrendMode(v)}
                      >{l}</button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={charts.trend} margin={{ left: -10, right: 12, top: 4, bottom: 4 }}>
                    <defs>
                      <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="var(--priority-high)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--priority-high)" stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,31,61,0.07)" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip {...tooltipStyle} />
                    <Area type="monotone" dataKey="count" name="Issues"
                      stroke="var(--priority-high)" fill="url(#trendGrad)" strokeWidth={2} dot={{ r: 3 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

            </div>
          </>
        )}

      </div>

      {/* ── Mobile Filter FAB ── */}
      <button
        className={`${styles.mobileFilterFab} ${activeFilterCount > 0 ? styles.mobileFilterFabActive : ''}`}
        onClick={() => setFiltersOpen(v => !v)}
        aria-label="Open filters"
      >
        <SlidersHorizontal size={15} />
        {activeFilterCount > 0 && <span className={styles.mobileFilterBadge}>{activeFilterCount}</span>}
      </button>

      {filtersOpen && <div className={styles.mobileFilterBackdrop} onClick={() => setFiltersOpen(false)} />}

      <div className={`${styles.mobileFilterSheet} ${filtersOpen ? styles.mobileFilterSheetOpen : ''}`}>
        <div className={styles.mobileFilterHandle} />
        <div className={styles.mobileFilterSheetHeader}>
          <span className={styles.mobileFilterSheetTitle}>Filters</span>
          <button className={styles.mobileFilterClose} onClick={() => setFiltersOpen(false)}><X size={16} /></button>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Search</span>
          <div className={styles.mobileSearchWrap}>
            <Search size={13} className={styles.searchIcon} />
            <input className={styles.mobileSearchInput} placeholder="Title, dept, location…"
              value={filterSearch} onChange={e => setFilterSearch(e.target.value)} />
          </div>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Date Range</span>
          <div className={styles.mobileChipRow}>
            {[{ value: 'all', label: 'All Time' }, { value: 'today', label: 'Today' }, { value: '7d', label: 'Last 7 Days' }, { value: '30d', label: 'Last 30 Days' }].map(o => (
              <button key={o.value} className={`${styles.mobileChip} ${dateRange === o.value ? styles.mobileChipActive : ''}`}
                onClick={() => setDateRange(o.value)}>{o.label}</button>
            ))}
          </div>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Status</span>
          <div className={styles.mobileChipRow}>
            {[{ value: 'all', label: 'All' }, ...Object.keys(STATUS_META).map(s => ({ value: s, label: s }))].map(o => (
              <button key={o.value} className={`${styles.mobileChip} ${filterStatus === o.value ? styles.mobileChipActive : ''}`}
                onClick={() => setFilterStatus(o.value)}>{o.label}</button>
            ))}
          </div>
        </div>

        <div className={styles.mobileFilterSection}>
          <span className={styles.mobileFilterLabel}>Priority</span>
          <div className={styles.mobileChipRow}>
            {[{ value: 'all', label: 'All' }, ...PRIORITY_ORDER.map(p => ({ value: p, label: p }))].map(o => (
              <button key={o.value} className={`${styles.mobileChip} ${filterPriority === o.value ? styles.mobileChipActive : ''}`}
                onClick={() => setFilterPriority(o.value)}>{o.label}</button>
            ))}
          </div>
        </div>

        {hasDept && (
          <div className={styles.mobileFilterSection}>
            <span className={styles.mobileFilterLabel}>Department</span>
            <div className={styles.mobileChipRow}>
              <button className={`${styles.mobileChip} ${!areaMine ? styles.mobileChipActive : ''}`}
                onClick={() => setAreaMine(false)}>All Departments</button>
              <button className={`${styles.mobileChip} ${areaMine ? styles.mobileChipMineActive : ''}`}
                onClick={() => setAreaMine(true)}>My Department</button>
            </div>
          </div>
        )}

        {allIssuingPlants.length > 0 && (
          <div className={styles.mobileFilterSection}>
            <span className={styles.mobileFilterLabel}>Issuing Plant</span>
            <div className={styles.mobileChipRow}>
              <button className={`${styles.mobileChip} ${filterIssuingPlant === 'all' ? styles.mobileChipActive : ''}`} onClick={() => setFilterIssuingPlant('all')}>All</button>
              {allIssuingPlants.map(p => (
                <button key={p} className={`${styles.mobileChip} ${filterIssuingPlant === p ? styles.mobileChipActive : ''}`} onClick={() => setFilterIssuingPlant(p)}>{p}</button>
              ))}
            </div>
          </div>
        )}

        {allIssuingDepts.length > 0 && (
          <div className={styles.mobileFilterSection}>
            <span className={styles.mobileFilterLabel}>Issuing Dept</span>
            <div className={styles.mobileChipRow}>
              <button className={`${styles.mobileChip} ${filterIssuingDept === 'all' ? styles.mobileChipActive : ''}`} onClick={() => setFilterIssuingDept('all')}>All</button>
              {allIssuingDepts.map(d => (
                <button key={d} className={`${styles.mobileChip} ${filterIssuingDept === d ? styles.mobileChipActive : ''}`} onClick={() => setFilterIssuingDept(d)}>{d}</button>
              ))}
            </div>
          </div>
        )}

        <div className={styles.mobileFilterActions}>
          {activeFilterCount > 0 && (
            <button className={styles.mobileFilterClear}
              onClick={() => { setFilterSearch(''); setFilterStatus('all'); setFilterPriority('all'); setDateRange('all'); setAreaMine(false); setFilterIssuingPlant('all'); setFilterIssuingDept('all') }}
            >Clear All</button>
          )}
          <button className={styles.mobileFilterApply} onClick={() => setFiltersOpen(false)}>Done</button>
        </div>
      </div>

    </div>
  )
}
