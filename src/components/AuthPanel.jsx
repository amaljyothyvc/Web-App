import { useState } from "react";
import { api } from "../api.js";

export default function AuthPanel({ onClose, onAuthenticated, initialRole = "seeker" }) {
  const [role, setRole] = useState(initialRole);
  const [mode, setMode] = useState("signup");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [jobAlerts, setJobAlerts] = useState(false);
  const [form, setForm] = useState({
    email: "",
    password: "",
    company_name: "",
    company_website: "",
    location: "",
    industry: "",
  });

  const isEmployer = role === "employer";
  const isSignup = mode === "signup";
  const update = (event) => setForm((current) => ({ ...current, [event.target.name]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const endpoint = isEmployer
      ? `/api/auth/company/${isSignup ? "signup" : "login"}`
      : `/api/auth/user/${isSignup ? "signup" : "login"}`;

    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ ...form, job_alerts: jobAlerts }),
      });
      onAuthenticated({ role, token: result.token, account: result[isEmployer ? "company" : "user"] });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  function changeRole(nextRole) {
    setRole(nextRole);
    setError("");
  }

  return (
    <section className="auth-layout" aria-labelledby="auth-title">
      <div className="auth-aside">
        <button className="back-link light-link" type="button" onClick={onClose}>← Back to jobs</button>
        <div className="auth-aside-copy">
          <span className="eyebrow">A better next step</span>
          <h1>{isEmployer ? "Meet the people who will move your team forward." : "Your next chapter starts with the right opportunity."}</h1>
          <p>{isEmployer ? "Create your employer profile, share a role and reach job seekers who asked to hear about new work." : "Find thoughtful opportunities from teams looking for people like you."}</p>
          <div className="auth-aside-note"><span className="note-mark">✳</span><span>One account. Real opportunities. A clearer way to connect.</span></div>
        </div>
      </div>

      <div className="auth-main">
        <div className="auth-card">
          <div className="account-switch" role="group" aria-label="Account type">
            <button className={role === "seeker" ? "selected" : ""} type="button" onClick={() => changeRole("seeker")}>I’m looking for work</button>
            <button className={role === "employer" ? "selected" : ""} type="button" onClick={() => changeRole("employer")}>I’m hiring</button>
          </div>

          <span className="eyebrow">{isEmployer ? "Employer workspace" : "Job seeker account"}</span>
          <h2 id="auth-title">{isEmployer ? (isSignup ? "Create your company profile" : "Welcome back") : (isSignup ? "Create your account" : "Welcome back")}</h2>
          <p className="auth-subtitle">{isEmployer ? (isSignup ? "Start a hiring profile and publish a role in minutes." : "Sign in to manage your team’s open roles.") : (isSignup ? "Save opportunities, apply, and follow every application." : "Sign in to continue your job search.")}</p>

          <form className="form-stack" onSubmit={submit}>
            {isEmployer && isSignup && (
              <>
                <label>Company name<input autoComplete="organization" name="company_name" value={form.company_name} onChange={update} placeholder="e.g. Northstar Studio" required maxLength={120} /></label>
                <div className="form-row">
                  <label>Website <span className="optional">Optional</span><input type="url" name="company_website" value={form.company_website} onChange={update} placeholder="https://company.com" /></label>
                  <label>Location <span className="optional">Optional</span><input name="location" value={form.location} onChange={update} placeholder="City or remote" maxLength={120} /></label>
                </div>
                <label>Industry <span className="optional">Optional</span><input name="industry" value={form.industry} onChange={update} placeholder="e.g. Technology" maxLength={80} /></label>
              </>
            )}
            <label>{isEmployer ? "Work email" : "Email"}<input type="email" name="email" autoComplete="email" value={form.email} onChange={update} placeholder={isEmployer ? "you@company.com" : "you@example.com"} required maxLength={254} /></label>
            <label>Password<input type="password" name="password" autoComplete={isSignup ? "new-password" : "current-password"} value={form.password} onChange={update} placeholder={isSignup ? "At least 8 characters" : "Your password"} required minLength={isSignup ? 8 : undefined} maxLength={72} /></label>
            {!isEmployer && isSignup && (
              <label className="checkbox-line"><input type="checkbox" checked={jobAlerts} onChange={(event) => setJobAlerts(event.target.checked)} /><span>Email me when new job opportunities are posted.</span></label>
            )}
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="button button-primary button-wide" disabled={submitting} type="submit">{submitting ? "Please wait…" : (isEmployer ? (isSignup ? "Create employer account" : "Sign in as employer") : (isSignup ? "Create account" : "Sign in"))}</button>
          </form>

          <p className="auth-toggle">{isSignup ? "Already have an account?" : "New to JobApp?"}{" "}<button type="button" className="text-button" onClick={() => { setMode(isSignup ? "login" : "signup"); setError(""); }}>{isSignup ? "Sign in" : "Create an account"}</button></p>
          {isEmployer && isSignup && <p className="auth-footnote">Create a company page as part of your employer account—no separate registration or API key step.</p>}
        </div>
      </div>
    </section>
  );
}
