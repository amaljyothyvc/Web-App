import { useMemo, useState } from "react";

function skillsFor(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Existing records may store a comma-separated skill list.
  }
  return value.split(",").map((skill) => skill.trim()).filter(Boolean);
}

export default function JobBoard({ jobs, currentUser, onApply, busyJobId, onHire }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const visibleJobs = useMemo(() => {
    const term = query.trim().toLowerCase();
    const place = location.trim().toLowerCase();
    return jobs.filter((job) => {
      const searchable = `${job.job_title} ${job.company_name} ${job.skills || ""} ${job.description || ""}`.toLowerCase();
      return (!term || searchable.includes(term)) && (!place || (job.location || "").toLowerCase().includes(place));
    });
  }, [jobs, query, location]);

  return (
    <section className="discover-section" aria-labelledby="jobs-heading">
      <div className="section-heading">
        <div><span className="eyebrow">The latest opportunities</span><h2 id="jobs-heading">Find work that fits.</h2><p>Explore roles from teams ready to meet their next great hire.</p></div>
        <span className="results-count">{visibleJobs.length} {visibleJobs.length === 1 ? "role" : "roles"}</span>
      </div>
      <div className="search-panel">
        <label className="search-field"><span aria-hidden="true">⌕</span><input aria-label="Search job title, company, or skill" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Job title, company, or skill" /></label>
        <label className="search-field location-field"><span aria-hidden="true">⌖</span><input aria-label="Filter by location" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="City, region, or remote" /></label>
        {(query || location) && <button className="clear-search" type="button" onClick={() => { setQuery(""); setLocation(""); }}>Clear</button>}
      </div>

      {visibleJobs.length === 0 ? (
        <div className="empty-state"><span className="empty-icon">⌕</span><h3>{jobs.length ? "No roles match that search" : "Your next opportunity will show up here"}</h3><p>{jobs.length ? "Try a different title or location." : "New positions from hiring teams will appear here as soon as they’re published."}</p>{onHire && <button className="button button-outline" type="button" onClick={onHire}>Hiring? Share a role</button>}</div>
      ) : (
        <div className="job-grid">{visibleJobs.map((job) => {
          const applied = Boolean(job.applied);
          const skills = skillsFor(job.skills);
          return (
            <article className="job-card" key={job.id}>
              <div className="job-card-top"><div className="company-mark" aria-hidden="true">{(job.company_name || "J").slice(0, 1).toUpperCase()}</div><div className="job-card-heading"><h3>{job.job_title}</h3><p className="company-name">{job.company_name}</p></div><span className="fresh-pill">Open role</span></div>
              <div className="job-facts"><span>⌖ {job.location || "Location flexible"}</span>{job.experience && <span>◷ {job.experience}</span>}{job.salary && <span>↗ {job.salary}</span>}</div>
              {skills.length > 0 && <div className="skill-chips">{skills.slice(0, 5).map((skill) => <span key={skill}>{skill}</span>)}</div>}
              <p className="job-description">{job.description || "A new opportunity from a hiring team on JobApp."}</p>
              <div className="job-card-footer"><span className="posted-date">{job.deadline ? `Apply by ${job.deadline}` : `Posted ${job.created_at ? new Date(job.created_at.replace(" ", "T") + "Z").toLocaleDateString() : "recently"}`}</span><button className={`button ${applied ? "button-applied" : "button-primary"}`} type="button" onClick={() => onApply(job.id)} disabled={applied || busyJobId === job.id}>{applied ? "Applied ✓" : busyJobId === job.id ? "Applying…" : "Apply now →"}</button></div>
            </article>
          );
        })}</div>
      )}
      {currentUser && <p className="privacy-note">Applications are private to the hiring company. Your profile email is shared with them when you apply.</p>}
    </section>
  );
}
