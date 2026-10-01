import { useCallback, useEffect, useMemo, useState } from "react";
import { api, clearSession, saveSession } from "./api.js";
import AuthPanel from "./components/AuthPanel.jsx";
import EmployerWorkspace from "./components/EmployerWorkspace.jsx";
import JobBoard from "./components/JobBoard.jsx";

const EMPTY_STATS = { today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0 };

function Brand({ onHome }) {
  return <button className="brand" type="button" onClick={onHome} aria-label="JobApp home"><span className="brand-symbol">j<span>.</span></span><span className="brand-name">jobapp</span></button>;
}

function ApplicationsView({ applications }) {
  return <section className="content-section"><div className="section-heading"><div><span className="eyebrow">Your journey</span><h2>Your applications.</h2><p>Keep up with every role you’ve taken a step toward.</p></div><span className="results-count">{applications.length} {applications.length === 1 ? "application" : "applications"}</span></div>
    {applications.length === 0 ? <div className="empty-state"><span className="empty-icon">↗</span><h3>Your next step starts with an application</h3><p>When you apply to a role, you’ll be able to follow its status here.</p></div> : <div className="application-list">{applications.map((application) => <article className="application-card" key={application.application_id}><div className="company-mark small-mark">{application.company_name.slice(0, 1).toUpperCase()}</div><div className="application-main"><h3>{application.job_title}</h3><p>{application.company_name} <span>·</span> {application.location || "Location flexible"}</p><span className="application-date">Applied {new Date(application.applied_at.replace(" ", "T") + "Z").toLocaleDateString()}</span></div><span className={`application-status status-${application.status.toLowerCase()}`}>{application.status}</span></article>)}</div>}
  </section>;
}

function NotificationCenter({ notifications, onRead, onBrowse, jobAlertsEnabled, onToggleAlerts }) {
  return <section className="content-section"><div className="section-heading"><div><span className="eyebrow">Good things happen here</span><h2>Your job alerts.</h2><p>New roles shared by teams on JobApp.</p></div><label className="alerts-toggle"><input type="checkbox" checked={jobAlertsEnabled} onChange={(event) => onToggleAlerts(event.target.checked)} /><span>Email me about new roles</span></label></div>
    {notifications.length === 0 ? <div className="empty-state"><span className="empty-icon">✳</span><h3>No new alerts yet</h3><p>{jobAlertsEnabled ? "New roles from participating teams will show here. Email delivery is available when the site owner configures it." : "Turn on alerts to see new roles here. Email delivery is available when the site owner configures it."}</p><button type="button" className="button button-outline" onClick={onBrowse}>Browse jobs</button></div> : <div className="notification-list">{notifications.map((item) => <button className={`notification-card ${item.read_at ? "is-read" : ""}`} key={item.id} type="button" onClick={() => { if (!item.read_at) onRead(item.id); onBrowse(); }}><span className="notification-icon">✳</span><span className="notification-copy"><strong>{item.title}</strong><span>{item.job_title} at {item.company_name}{item.message.includes(" · ") ? ` · ${item.message.split(" · ").slice(1).join(" · ")}` : ""}</span><small>{new Date(item.created_at.replace(" ", "T") + "Z").toLocaleString()}</small></span>{!item.read_at && <span className="unread-dot" aria-label="Unread" />}</button>)}</div>}
  </section>;
}

function PostJobForm({ company, onCancel, onPublished }) {
  const [form, setForm] = useState({ job_title: "", location: company.location || "", experience: "", salary: "", skills: "", description: "", deadline: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  function update(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }
  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await api("/api/jobs", { role: "employer", method: "POST", body: JSON.stringify(form) });
      onPublished(result.notification || { notified: 0, emailed: 0 });
    } catch (requestError) { setError(requestError.message); }
    finally { setSubmitting(false); }
  }
  return <section className="content-section post-form-section"><button className="back-link" type="button" onClick={onCancel}>← Hiring workspace</button><div className="section-heading"><div><span className="eyebrow">Reach your next teammate</span><h2>Post a job.</h2><p>Write a clear role description and we’ll share it with job seekers.</p></div></div><form className="job-post-form" onSubmit={submit}><div className="form-row"><label>Job title<input name="job_title" value={form.job_title} onChange={update} placeholder="e.g. Product Designer" minLength={3} maxLength={120} required /></label><label>Location<input name="location" value={form.location} onChange={update} placeholder="City, region, or remote" maxLength={120} /></label></div><div className="form-row three-fields"><label>Experience<input name="experience" value={form.experience} onChange={update} placeholder="e.g. 3+ years" maxLength={80} /></label><label>Salary range<input name="salary" value={form.salary} onChange={update} placeholder="e.g. $90k–$120k" maxLength={80} /></label><label>Application deadline<input type="date" name="deadline" min={new Date().toISOString().slice(0, 10)} value={form.deadline} onChange={update} /></label></div><label>Skills <span className="optional">Separate with commas</span><input name="skills" value={form.skills} onChange={update} placeholder="Research, Figma, prototyping" maxLength={600} /></label><label>Role description<textarea name="description" value={form.description} onChange={update} placeholder="What will this person own? What would make them successful on your team?" minLength={20} maxLength={4000} rows={7} required /></label>{error && <p className="form-error" role="alert">{error}</p>}<div className="publish-footer"><p>Publishing creates in-app alerts for opted-in job seekers. Email alerts are sent when email delivery is configured.</p><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? "Publishing…" : "Publish job →"}</button></div></form></section>;
}

export default function App() {
  const [view, setView] = useState("discover");
  const [jobs, setJobs] = useState([]);
  const [account, setAccount] = useState(null);
  const [role, setRole] = useState(null);
  const [authRole, setAuthRole] = useState("seeker");
  const [authChecked, setAuthChecked] = useState(false);
  const [applications, setApplications] = useState([]);
  const [stats, setStats] = useState(EMPTY_STATS);
  const [notifications, setNotifications] = useState([]);
  const [toast, setToast] = useState("");
  const [busyJobId, setBusyJobId] = useState(null);
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [loadingJobs, setLoadingJobs] = useState(true);

  const showToast = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4500);
  }, []);

  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try { setJobs(await api("/api/jobs")); }
    catch (error) { showToast(error.message); }
    finally { setLoadingJobs(false); }
  }, [showToast]);

  const loadSeekerData = useCallback(async () => {
    try {
      const [mine, summary, alerts] = await Promise.all([
        api("/api/applications/mine", { role: "seeker" }),
        api("/api/applications/stats", { role: "seeker" }),
        api("/api/notifications", { role: "seeker" }),
      ]);
      setApplications(mine);
      setStats(summary);
      setNotifications(alerts);
    } catch (error) { showToast(error.message); }
  }, [showToast]);

  useEffect(() => {
    loadJobs();
    async function restoreSession() {
      const sessionRole = localStorage.getItem("userToken") ? "seeker" : localStorage.getItem("companyToken") ? "employer" : null;
      if (!sessionRole) { setAuthChecked(true); return; }
      try {
        const result = await api("/api/auth/me", { role: sessionRole });
        setRole(sessionRole);
        setAccount(result[sessionRole === "employer" ? "company" : "user"]);
      } catch { clearSession(sessionRole); }
      finally { setAuthChecked(true); }
    }
    restoreSession();
  }, [loadJobs]);

  useEffect(() => { if (role === "seeker") loadSeekerData(); }, [role, loadSeekerData]);

  const appliedIds = useMemo(() => new Set(applications.map((item) => item.job_id)), [applications]);
  const visibleJobs = useMemo(() => jobs.map((job) => ({ ...job, applied: appliedIds.has(job.id) })), [jobs, appliedIds]);
  const unreadCount = notifications.filter((item) => !item.read_at).length;

  function openAuth(nextRole = "seeker") {
    setAuthRole(nextRole);
    setView("auth");
  }

  function authenticated({ role: signedInRole, token, account: signedInAccount }) {
    saveSession(signedInRole, token);
    setRole(signedInRole);
    setAccount(signedInAccount);
    setView(signedInRole === "employer" ? "workspace" : "discover");
    showToast(signedInRole === "employer" ? `Welcome, ${signedInAccount.company_name}. Your hiring space is ready.` : "You’re signed in. Your job search is ready.");
    if (signedInRole === "seeker") loadSeekerData();
  }

  async function signOut() {
    if (role) api("/api/auth/logout", { role, method: "POST" }).catch(() => {});
    if (role) clearSession(role);
    setRole(null); setAccount(null); setApplications([]); setNotifications([]); setStats(EMPTY_STATS); setView("discover");
    showToast("You’ve signed out.");
  }

  async function applyToJob(jobId) {
    if (role !== "seeker") { openAuth("seeker"); return; }
    setBusyJobId(jobId);
    try {
      await api("/api/applications", { role: "seeker", method: "POST", body: JSON.stringify({ job_id: jobId }) });
      await loadSeekerData();
      showToast("Application sent. You can follow its status in My applications.");
    } catch (error) { showToast(error.message); }
    finally { setBusyJobId(null); }
  }

  async function markNotificationRead(id) {
    try {
      await api(`/api/notifications/${id}/read`, { role: "seeker", method: "PATCH" });
      setNotifications((current) => current.map((item) => item.id === id ? { ...item, read_at: new Date().toISOString() } : item));
    } catch (error) { showToast(error.message); }
  }

  async function updateJobAlerts(enabled) {
    try {
      const result = await api("/api/auth/user/job-alerts", { role: "seeker", method: "PATCH", body: JSON.stringify({ job_alerts: enabled }) });
      setAccount((current) => ({ ...current, job_alerts: result.job_alerts }));
      showToast(enabled ? "You’ll receive alerts when new roles are published." : "New job email alerts are turned off.");
    } catch (error) { showToast(error.message); }
  }

  function jobPublished(notification) {
    setWorkspaceRefreshKey((value) => value + 1);
    loadJobs();
    setView("workspace");
    showToast(notification.notified ? `Job published. ${notification.notified} opted-in job seeker${notification.notified === 1 ? "" : "s"} notified${notification.emailed ? `, including ${notification.emailed} email alert${notification.emailed === 1 ? "" : "s"}` : ""}.` : "Job published. Job seekers can now find it in the job board.");
  }

  if (!authChecked) return <main className="loading-screen"><div className="loading-mark">j<span>.</span></div><p>Getting your JobApp ready…</p></main>;
  if (view === "auth") return <AuthPanel initialRole={authRole} onClose={() => setView("discover")} onAuthenticated={authenticated} />;

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner"><Brand onHome={() => setView("discover")} /><nav className="top-nav" aria-label="Main navigation"><button className={view === "discover" ? "active" : ""} type="button" onClick={() => setView("discover")}>Find jobs</button>{role === "seeker" && <><button className={view === "applications" ? "active" : ""} type="button" onClick={() => setView("applications")}>My applications</button><button className={`notification-nav ${view === "notifications" ? "active" : ""}`} type="button" onClick={() => setView("notifications")}>Job alerts{unreadCount > 0 && <span className="nav-count">{unreadCount}</span>}</button></>}{role === "employer" && <button className={view === "workspace" ? "active" : ""} type="button" onClick={() => setView("workspace")}>Hiring workspace</button>}</nav><div className="header-actions">{role && <span className="account-chip"><span className="online-dot" />{role === "employer" ? account?.company_name : account?.email}</span>}{role === "employer" ? <button className="button button-primary header-post" type="button" onClick={() => setView("post")}>＋ Post a job</button> : <button className="button button-outline header-post" type="button" onClick={() => role ? setView("workspace") : openAuth("employer")}>For employers</button>}{role ? <button className="signout-button" type="button" onClick={signOut}>Sign out</button> : <button className="signin-button" type="button" onClick={() => openAuth("seeker")}>Sign in</button>}</div></div></header>

    <main>
      {view === "discover" && <><section className="hero"><div className="hero-content"><span className="eyebrow"><span className="eyebrow-dot" />A more human job search</span><h1>Good work<br />starts with <em>good fit.</em></h1><p>Find a role where you can do your best work—or help the right person find theirs.</p><div className="hero-actions"><a className="button button-primary" href="#jobs-heading">Explore open roles <span>↓</span></a>{role !== "employer" && <button className="button button-quiet" type="button" onClick={() => role ? setView("applications") : openAuth("seeker")}>{role ? "Track your applications" : "Create a job seeker account"} <span>→</span></button>}</div><div className="hero-trust"><span className="hero-avatars"><i>J</i><i>M</i><i>A</i></span><span>For people building what’s next</span></div></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="hero-sun" /><div className="hero-spark spark-one">✳</div><div className="hero-spark spark-two">✳</div><div className="hero-note"><span className="note-label">A place to grow</span><strong>Find your<br />next thing.</strong><span className="note-arrow">↗</span></div><div className="hero-caption"><span>Opportunity, in motion</span><b>01 / 03</b></div></div></section><section className="proof-strip"><div><strong>{jobs.length.toLocaleString()}</strong><span>roles ready to explore</span></div><p>Thoughtful teams. Clear opportunities. Better work, together.</p><button type="button" onClick={() => role === "employer" ? setView("workspace") : openAuth("employer")}>Hiring? Meet JobApp <span>→</span></button></section><div className="main-content"><JobBoard jobs={visibleJobs} currentUser={role === "seeker"} onApply={applyToJob} busyJobId={busyJobId} onHire={() => role === "employer" ? setView("workspace") : openAuth("employer")} />{loadingJobs && <p className="loading-inline">Refreshing roles…</p>}</div></>}
      {view === "workspace" && role === "employer" && <div className="main-content inner-page"><EmployerWorkspace company={account} onPost={() => setView("post")} onError={showToast} refreshKey={workspaceRefreshKey} /></div>}
      {view === "workspace" && role !== "employer" && <div className="main-content inner-page"><div className="access-panel"><span className="eyebrow">For employers</span><h1>Bring your next role to JobApp.</h1><p>Create an employer account, build a company profile, and publish your opening. No manual company-registration queue.</p><button className="button button-primary" type="button" onClick={() => openAuth("employer")}>Create an employer account →</button></div></div>}
      {view === "post" && role === "employer" && <div className="main-content inner-page"><PostJobForm company={account} onCancel={() => setView("workspace")} onPublished={jobPublished} /></div>}
      {view === "applications" && role === "seeker" && <div className="main-content inner-page"><div className="activity-summary"><div><span className="eyebrow">Your progress</span><h2>Every application is a step.</h2></div><div className="mini-stats">{[["Today", stats.today], ["This week", stats.thisWeek], ["This month", stats.thisMonth]].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div></div><ApplicationsView applications={applications} /></div>}
      {view === "applications" && role !== "seeker" && <div className="main-content inner-page"><div className="empty-state"><h3>Sign in to follow your applications</h3><button className="button button-primary" onClick={() => openAuth("seeker")} type="button">Sign in as a job seeker</button></div></div>}
      {view === "notifications" && role === "seeker" && <div className="main-content inner-page"><NotificationCenter notifications={notifications} onRead={markNotificationRead} onBrowse={() => setView("discover")} jobAlertsEnabled={Boolean(account?.job_alerts)} onToggleAlerts={updateJobAlerts} /></div>}
      {view === "notifications" && role !== "seeker" && <div className="main-content inner-page"><div className="empty-state"><h3>Sign in to view job alerts</h3><button className="button button-primary" onClick={() => openAuth("seeker")} type="button">Sign in as a job seeker</button></div></div>}
    </main>

    <footer className="site-footer"><Brand onHome={() => setView("discover")} /><p>Make room for the work you want to do.</p><span>© {new Date().getFullYear()} JobApp</span></footer>
    {toast && <div className="toast" role="status" aria-live="polite">{toast}<button type="button" aria-label="Dismiss notification" onClick={() => setToast("")}>×</button></div>}
  </div>;
}
