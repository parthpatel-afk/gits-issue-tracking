import { useNavigate, useParams } from 'react-router-dom'
import { useCompany } from '../hooks/useCompany'
import styles from './Home.module.css'

export default function Home() {
  const { companySlug } = useParams()
  const { company, loading } = useCompany(companySlug)
  const navigate = useNavigate()

  if (loading) return <div className={styles.page} />

  return (
    <div className={styles.page}>
      <div className={styles.inner}>

        {/* Brand */}
        <div className={styles.brandWrap}>
          {company?.logo_url && (
            <img
              src={company.logo_url}
              alt={`${company.name} logo`}
              className={styles.companyLogo}
            />
          )}
          <p className={styles.brandName}>{company?.name ?? companySlug}</p>
          <h1 className={styles.headline}>Global Issue<br />Tracking System</h1>
          <p className={styles.tagline}>Submit an issue to any department — fast, tracked, resolved.</p>
        </div>

        {/* Two cards */}
        <div className={styles.cards}>

          <button
            className={`${styles.card} ${styles.cardSubmit}`}
            onClick={() => navigate(`/issue/${companySlug}`)}
          >
            <span className={styles.cardIcon}>📋</span>
            <span className={styles.cardTitle}>Submit an Issue</span>
            <span className={styles.cardDesc}>
              Employees — tap to report an issue to any department for tracking and resolution.
            </span>
            <span className={styles.cardCta}>Get Started →</span>
          </button>

          <button
            className={`${styles.card} ${styles.cardDashboard}`}
            onClick={() => navigate(`/admin/${companySlug}`)}
          >
            <span className={styles.cardIcon}>📊</span>
            <span className={styles.cardTitle}>Issue Dashboard</span>
            <span className={styles.cardDesc}>
              Team members — log in to manage, action, and track open issues assigned to your department.
            </span>
            <span className={styles.cardCta}>Log In →</span>
          </button>

        </div>

        {/* Register link */}
        <p className={styles.registerHint}>
          New team member?{' '}
          <button className={styles.registerLink} onClick={() => navigate(`/register/${companySlug}`)}>
            Create an account
          </button>
        </p>

      </div>
    </div>
  )
}
