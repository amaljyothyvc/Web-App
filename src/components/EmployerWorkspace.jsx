import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";

export default function EmployerWorkspace({ company, onPost, onError, refreshKey }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openJobId, setOpenJobId] = useState(null);
  const [applicants, setApplicants] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try { setJobs(await api("/api/companies/me/jobs", { role: "employer" })); }
    catch (error) { onError(error.message); }
    finally { setLoading(false); }
  }, [onError]);

  useEffect(() => { loadJobs(); }, [loadJobs, refreshKey]);

  async function toggleApplicants(jobId) {
    if (openJobId === jobId) { setOpenJobId(null); return; }
    setOpenJobId(jobId);
    try { setApplicants(await api(`/api/jobs/${jobId}/applications`, { role: "employer" })); }
    catch (error) { onError(error.message); }
  }

  async function updateStatus(applicationId, status) {
    try {
      await api(`/api/applications/${applicationId}/status`, { role: "employer", method: "PATCH", body: JSON.stringify({ status }) });
      setApplicants((current) => current.map((applicant) => applicant.id === applicationId ? { ...applicant, status } : applicant));
    } catch (error) { onError(error.message); }
  }

  async function deleteJob(jobId) {
    if (!window.confirm("Remove this job posting? Applicants will no longer be able to find it.")) return;
    setBusy(true);
    try { await api(`/api/jobs/${jobId}`, { role: "employer", method: "DELETE" }); setJobs((current) => current.filter((job) => job.id !== jobId)); }
    catch (error) { onError(error.message); }
    finally { setBusy(false); }
  }

  return (
    <section className="workspace-section">
      <div className="workspace-header"><div><span className="eyebrow">Hiring workspace</span><h2>{company.company_name}</h2><p>Manage your open roles and follow up with applicants.</p></div><button className="button button-primary" type="button" onClick={onPost}>＋ Post a job</button></div>
      <div className="workspace-summary"><div><span>Open roles</span><strong>{jobs.filter((job) => !job.is_expired).length}</strong></div><div><span>Total applicants</span><strong>{jobs.reduce((sum, job) => sum + Number(job.applicant_count || 0), 0)}</strong></div><div><span>Company location</span><strong>{company.location || "Not set"}</strong></div></div>
      <div className="workspace-jobs"><div className="subsection-heading"><h3>Your job posts</h3><span>{jobs.filter((job) => !job.is_expired).length} active</span></div>
        {loading ? <div className="inline-loading">Loading your roles…</div> : jobs.length === 0 ? <div className="empty-state compact"><span className="empty-icon">＋</span><h3>Your first role is one step away</h3><p>Share what you’re hiring for and JobApp will alert opted-in job seekers.</p><button className="button button-primary" type="button" onClick={onPost}>Create a job post</button></div> : jobs.map((job) => (
          <article className="posting-card" key={job.id}>
            <div className="posting-main"><div><h4>{job.job_title}</h4><p>{job.location || "Location flexible"} <span>·</span> {job.applicant_count || 0} applicants</p></div><span className={`status-tag ${job.is_expired ? "closed" : ""}`}>{job.is_expired ? "Expired" : "Live"}</span></div>
            <div className="posting-actions"><button className="button button-outline button-small" type="button" onClick={() => toggleApplicants(job.id)}>{openJobId === job.id ? "Hide applicants" : "View applicants"}</button><button className="text-button danger-button" type="button" disabled={busy} onClick={() => deleteJob(job.id)}>Remove post</button></div>
            {openJobId === job.id && <div className="applicant-list"><h5>Applicants</h5>{applicants.length === 0 ? <p className="muted-copy">No applications yet. New applications will appear here.</p> : applicants.map((applicant) => <div className="applicant-row" key={applicant.id}><div><strong>{applicant.applicant_email}</strong><span>Applied {new Date(applicant.applied_at.replace(" ", "T") + "Z").toLocaleDateString()}</span></div><select aria-label={`Application status for ${applicant.applicant_email}`} value={applicant.status} onChange={(event) => updateStatus(applicant.id, event.target.value)}><option>Applied</option><option>Reviewing</option><option>Rejected</option><option>Hired</option></select></div>)}</div>}
          </article>
        ))}
      </div>
    </section>
  );
}
