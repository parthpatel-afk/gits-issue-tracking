-- ============================================================
-- GITS: Global Issue Tracking System
-- Run this entire file in the Supabase SQL Editor:
--   Project Dashboard → SQL Editor → New Query → Paste → Run
--
-- NOTE: Shares the public.companies and public.managers tables
-- with SRTS and SHRS (same "AutoRise MVPs" Supabase project).
-- Adds: issues, issue_tasks, issue_comments tables, storage
-- bucket, and a departments column on companies.
-- ============================================================


-- ============================================================
-- 1. ADD DEPARTMENTS COLUMN TO COMPANIES
--    Stores the per-company list of receiving departments shown
--    in the IssueCapture form dropdown. Defaults are injected
--    by the Onboard portal at provisioning time.
-- ============================================================

ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS departments JSONB NOT NULL DEFAULT '[]'::JSONB;

COMMENT ON COLUMN public.companies.departments IS
    'Array of department name strings configured per tenant (e.g. ["Manufacturing","Quality","Safety"]). '
    'Drives the Receiving Department dropdown in IssueCapture.';


-- ============================================================
-- 2. ISSUES TABLE
--    Core table. One row per submitted issue.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.issues (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id          UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Issue content
    title               TEXT        NOT NULL,
    description         TEXT        NOT NULL DEFAULT '',

    -- Where the issue came from (4-level hierarchy, same as SRTS/SHRS)
    issuing_plant       TEXT        NOT NULL DEFAULT '',
    issuing_dept        TEXT        NOT NULL DEFAULT '',
    issuing_zone        TEXT        NOT NULL DEFAULT '',
    issuing_area        TEXT        NOT NULL DEFAULT '',

    -- Where the issue is going (routing field — drives My Department filter)
    receiving_dept      TEXT        NOT NULL DEFAULT '',

    -- Classification
    priority            TEXT        NOT NULL DEFAULT 'Medium'
                                    CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),

    -- Lifecycle
    status              TEXT        NOT NULL DEFAULT 'Open'
                                    CHECK (status IN ('Open', 'In Progress', 'Resolved', 'Closed')),

    -- People
    submitted_by        TEXT        NOT NULL DEFAULT 'Anonymous',
    assigned_to         TEXT        NOT NULL DEFAULT '',

    -- Optional photo (uploaded to Supabase Storage bucket: issue-photos)
    photo_url           TEXT        NOT NULL DEFAULT '',

    -- Timestamps
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.issues                  IS 'One row per submitted issue. Central table for GITS.';
COMMENT ON COLUMN public.issues.company_id       IS 'Tenant isolation key — all queries must filter by this.';
COMMENT ON COLUMN public.issues.receiving_dept   IS 'The team responsible for resolving this issue. Drives My Department filter.';
COMMENT ON COLUMN public.issues.priority         IS 'Low / Medium / High / Critical — same palette as SHRS severity.';
COMMENT ON COLUMN public.issues.status           IS 'Lifecycle: Open → In Progress → Resolved → Closed';
COMMENT ON COLUMN public.issues.photo_url        IS 'Public URL from Supabase Storage bucket: issue-photos';

-- Indexes for dashboard and real-time queries
CREATE INDEX IF NOT EXISTS idx_issues_company_status
    ON public.issues (company_id, status);

CREATE INDEX IF NOT EXISTS idx_issues_company_receiving
    ON public.issues (company_id, receiving_dept);

CREATE INDEX IF NOT EXISTS idx_issues_created_at
    ON public.issues (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_issues_priority
    ON public.issues (company_id, priority);


-- ============================================================
-- 3. ISSUE_TASKS TABLE
--    Checklist items attached to an issue. The assignee creates
--    these to break the issue into discrete action items.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.issue_tasks (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id        UUID        NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
    company_id      UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Task content
    title           TEXT        NOT NULL,

    -- Completion state
    is_complete     BOOLEAN     NOT NULL DEFAULT FALSE,
    completed_by    TEXT        NOT NULL DEFAULT '',
    completed_at    TIMESTAMPTZ,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.issue_tasks              IS 'Checklist items for an issue. Cascade-deletes with parent issue.';
COMMENT ON COLUMN public.issue_tasks.issue_id     IS 'Parent issue. Deletes cascade from issues table.';
COMMENT ON COLUMN public.issue_tasks.company_id   IS 'Denormalized for RLS filtering without a join.';
COMMENT ON COLUMN public.issue_tasks.is_complete  IS 'Drives task progress bar (n completed / total).';

-- Index for fetching all tasks for a given issue
CREATE INDEX IF NOT EXISTS idx_tasks_issue_id
    ON public.issue_tasks (issue_id);

CREATE INDEX IF NOT EXISTS idx_tasks_company
    ON public.issue_tasks (company_id);


-- ============================================================
-- 4. ISSUE_COMMENTS TABLE
--    Append-only discussion thread on an issue. Both submitters
--    and assignees can post. No edit or delete (audit trail).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.issue_comments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    issue_id        UUID        NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
    company_id      UUID        NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Comment content
    author          TEXT        NOT NULL DEFAULT 'Anonymous',
    body            TEXT        NOT NULL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.issue_comments            IS 'Append-only comment thread on an issue. Cascade-deletes with parent issue.';
COMMENT ON COLUMN public.issue_comments.issue_id   IS 'Parent issue. Deletes cascade from issues table.';
COMMENT ON COLUMN public.issue_comments.company_id IS 'Denormalized for RLS filtering without a join.';

-- Index for fetching all comments for a given issue (chronological)
CREATE INDEX IF NOT EXISTS idx_comments_issue_id
    ON public.issue_comments (issue_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_comments_company
    ON public.issue_comments (company_id);


-- ============================================================
-- 5. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.issues         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_tasks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_comments ENABLE ROW LEVEL SECURITY;

-- ---- ISSUES ------------------------------------------------

-- Anyone (anon) can INSERT — employees submit without login
CREATE POLICY "anon_insert_issues"
    ON public.issues
    FOR INSERT
    TO anon
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies)
    );

-- Anyone (anon) can SELECT — dashboard reads without auth
CREATE POLICY "anon_read_issues"
    ON public.issues
    FOR SELECT
    TO anon
    USING (true);

-- Anyone (anon) can UPDATE — managers update status, assigned_to, resolved_at
CREATE POLICY "anon_update_issues"
    ON public.issues
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

-- Anyone (anon) can DELETE — managers can remove invalid/duplicate issues
CREATE POLICY "anon_delete_issues"
    ON public.issues
    FOR DELETE
    TO anon
    USING (true);

-- ---- ISSUE_TASKS -------------------------------------------

CREATE POLICY "anon_insert_issue_tasks"
    ON public.issue_tasks
    FOR INSERT
    TO anon
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies)
    );

CREATE POLICY "anon_read_issue_tasks"
    ON public.issue_tasks
    FOR SELECT
    TO anon
    USING (true);

CREATE POLICY "anon_update_issue_tasks"
    ON public.issue_tasks
    FOR UPDATE
    TO anon
    USING (true)
    WITH CHECK (true);

CREATE POLICY "anon_delete_issue_tasks"
    ON public.issue_tasks
    FOR DELETE
    TO anon
    USING (true);

-- ---- ISSUE_COMMENTS ----------------------------------------

CREATE POLICY "anon_insert_issue_comments"
    ON public.issue_comments
    FOR INSERT
    TO anon
    WITH CHECK (
        company_id IN (SELECT id FROM public.companies)
    );

CREATE POLICY "anon_read_issue_comments"
    ON public.issue_comments
    FOR SELECT
    TO anon
    USING (true);

-- No UPDATE or DELETE on comments — append-only by design


-- ============================================================
-- 6. SUPABASE STORAGE BUCKET: issue-photos
--    Public bucket for optional issue photo attachments.
--    Same pattern as SHRS hazard-photos bucket.
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('issue-photos', 'issue-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Allow anon to upload photos
CREATE POLICY "anon_upload_issue_photos"
    ON storage.objects
    FOR INSERT
    TO anon
    WITH CHECK (bucket_id = 'issue-photos');

-- Public read (photos accessible via public URL)
CREATE POLICY "public_read_issue_photos"
    ON storage.objects
    FOR SELECT
    TO anon
    USING (bucket_id = 'issue-photos');

-- Allow anon to delete (manager cleanup)
CREATE POLICY "anon_delete_issue_photos"
    ON storage.objects
    FOR DELETE
    TO anon
    USING (bucket_id = 'issue-photos');


-- ============================================================
-- 7. VERIFY
--    Run these after executing the script to confirm success.
-- ============================================================

-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'companies' AND column_name = 'departments';
-- SELECT * FROM public.issues LIMIT 5;
-- SELECT * FROM public.issue_tasks LIMIT 5;
-- SELECT * FROM public.issue_comments LIMIT 5;
-- SELECT * FROM storage.buckets WHERE id = 'issue-photos';
