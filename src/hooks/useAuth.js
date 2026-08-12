/**
 * useAuth — manager session stored in localStorage
 * Session shape: { id, name, username, plant, department, zone, line, company_id }
 * Prefixed gits_ to avoid cross-app session collisions with SRTS/SHRS.
 */

export function getSession(companySlug) {
  try {
    const raw = localStorage.getItem(`gits_session_${companySlug}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveSession(companySlug, manager) {
  localStorage.setItem(`gits_session_${companySlug}`, JSON.stringify(manager))
}

export function clearSession(companySlug) {
  localStorage.removeItem(`gits_session_${companySlug}`)
}
