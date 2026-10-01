const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { createDatabase } = require("./db.cjs");
const { sendJobAlert } = require("./mailer.cjs");

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-development-secret-change-before-deploy");
const STATUSES = new Set(["Applied", "Reviewing", "Rejected", "Hired"]);

function clean(value, maxLength = 500) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, maxLength);
}

function publicCompany(company) {
  return {
    id: company.id,
    company_name: company.company_name,
    email: company.email,
    company_website: company.company_website,
    location: company.location,
    industry: company.industry,
    description: company.description,
  };
}

function createApp({ db = createDatabase(), staticDir = path.join(__dirname, "..", "dist"), jwtSecret = JWT_SECRET } = {}) {
  if (!jwtSecret) throw new Error("JWT_SECRET is required in production.");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  if (process.env.NODE_ENV !== "production") {
    app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:5173" }));
  }
  app.use(express.json({ limit: "100kb" }));

  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: "draft-7", legacyHeaders: false });
  const authLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many account attempts. Try again later." } });
  app.use("/api/", apiLimiter);

  function createToken(role, id) {
    return jwt.sign({ role, id }, jwtSecret, { expiresIn: "7d", issuer: "jobapp" });
  }

  function requireRole(role) {
    return (req, res, next) => {
      const header = req.get("authorization") || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      if (!token) return res.status(401).json({ error: "Sign in to continue." });
      try {
        const payload = jwt.verify(token, jwtSecret, { issuer: "jobapp" });
        if (payload.role !== role) return res.status(403).json({ error: "This action is not available for this account." });
        req.identity = { id: Number(payload.id), role: payload.role };
        if (!Number.isInteger(req.identity.id) || req.identity.id < 1) return res.status(401).json({ error: "Invalid session." });
        next();
      } catch {
        return res.status(401).json({ error: "Your session expired. Please sign in again." });
      }
    };
  }

  const seekerOnly = requireRole("seeker");
  const employerOnly = requireRole("employer");

  app.get("/api/health", (_req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok", service: "jobapp" });
  });

  app.post("/api/auth/user/signup", authLimiter, async (req, res, next) => {
    try {
      const email = clean(req.body.email, 254).toLowerCase();
      const password = String(req.body.password || "");
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
      if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ error: "Password must be at least 8 characters and no more than 72 UTF-8 bytes." });
      const passwordHash = await bcrypt.hash(password, 12);
      let result;
      try {
        result = db.prepare("INSERT INTO users (email, password_hash, job_alerts) VALUES (?, ?, ?)").run(email, passwordHash, req.body.job_alerts ? 1 : 0);
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "An account with this email already exists." });
        throw error;
      }
      const user = { id: Number(result.lastInsertRowid), email, job_alerts: Boolean(req.body.job_alerts) };
      return res.status(201).json({ token: createToken("seeker", user.id), user });
    } catch (error) { return next(error); }
  });

  app.post("/api/auth/user/login", authLimiter, async (req, res, next) => {
    try {
      const email = clean(req.body.email, 254).toLowerCase();
      const user = db.prepare("SELECT id, email, password_hash, job_alerts FROM users WHERE lower(email) = ?").get(email);
      if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
      return res.json({ token: createToken("seeker", user.id), user: { id: user.id, email: user.email, job_alerts: Boolean(user.job_alerts) } });
    } catch (error) { return next(error); }
  });

  app.post("/api/auth/company/signup", authLimiter, async (req, res, next) => {
    try {
      const companyName = clean(req.body.company_name, 120);
      const email = clean(req.body.email, 254).toLowerCase();
      const password = String(req.body.password || "");
      const website = clean(req.body.company_website, 240);
      const location = clean(req.body.location, 120);
      const industry = clean(req.body.industry, 80);
      if (companyName.length < 2) return res.status(400).json({ error: "Enter your company name." });
      if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid work email address." });
      if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ error: "Password must be at least 8 characters and no more than 72 UTF-8 bytes." });
      if (website && !/^https?:\/\//i.test(website)) return res.status(400).json({ error: "Company website must start with https:// or http://." });
      const passwordHash = await bcrypt.hash(password, 12);
      const apiKey = crypto.randomBytes(32).toString("hex");
      let result;
      try {
        result = db.prepare(`INSERT INTO companies (company_name, company_email, company_website, location, apiKey, email, password_hash, industry)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(companyName, email, website, location, apiKey, email, passwordHash, industry);
      } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "An employer account already exists for this email." });
        throw error;
      }
      const company = publicCompany({ id: Number(result.lastInsertRowid), company_name: companyName, email, company_website: website, location, industry });
      return res.status(201).json({ token: createToken("employer", company.id), company });
    } catch (error) { return next(error); }
  });

  app.post("/api/auth/company/login", authLimiter, async (req, res, next) => {
    try {
      const email = clean(req.body.email, 254).toLowerCase();
      const company = db.prepare("SELECT * FROM companies WHERE lower(email) = ?").get(email);
      if (!company || !company.password_hash || !(await bcrypt.compare(String(req.body.password || ""), company.password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
      return res.json({ token: createToken("employer", company.id), company: publicCompany(company) });
    } catch (error) { return next(error); }
  });

  app.get("/api/auth/me", (req, res) => {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Sign in to continue." });
    try {
      const payload = jwt.verify(token, jwtSecret, { issuer: "jobapp" });
      if (payload.role === "seeker") {
        const user = db.prepare("SELECT id, email, job_alerts FROM users WHERE id = ?").get(payload.id);
        return user ? res.json({ user: { ...user, job_alerts: Boolean(user.job_alerts) }, role: "seeker" }) : res.status(401).json({ error: "Account not found." });
      }
      if (payload.role === "employer") {
        const company = db.prepare("SELECT * FROM companies WHERE id = ?").get(payload.id);
        return company ? res.json({ company: publicCompany(company), role: "employer" }) : res.status(401).json({ error: "Account not found." });
      }
      return res.status(401).json({ error: "Invalid session." });
    } catch { return res.status(401).json({ error: "Your session expired. Please sign in again." }); }
  });

  app.post("/api/auth/logout", (_req, res) => res.json({ message: "Signed out." }));

  app.patch("/api/auth/user/job-alerts", seekerOnly, (req, res) => {
    if (typeof req.body.job_alerts !== "boolean") return res.status(400).json({ error: "Choose whether you want job alerts." });
    db.prepare("UPDATE users SET job_alerts = ? WHERE id = ?").run(req.body.job_alerts ? 1 : 0, req.identity.id);
    res.json({ job_alerts: req.body.job_alerts });
  });

  app.get("/api/jobs", (req, res) => {
    const jobs = db.prepare(`SELECT j.id, j.job_title, j.location, j.experience, j.salary, j.skills, j.description, j.deadline, j.created_at,
      c.company_name, c.company_website, c.industry
      FROM jobs j JOIN companies c ON c.id = j.company_id
      WHERE j.deadline IS NULL OR date(j.deadline) >= date('now')
      ORDER BY j.id DESC`).all();
    res.json(jobs);
  });

  app.post("/api/jobs", employerOnly, async (req, res, next) => {
    try {
      const company = db.prepare("SELECT id, company_name FROM companies WHERE id = ?").get(req.identity.id);
      if (!company) return res.status(401).json({ error: "Employer account not found." });
      const jobTitle = clean(req.body.job_title, 120);
      const location = clean(req.body.location, 120);
      const experience = clean(req.body.experience, 80);
      const salary = clean(req.body.salary, 80);
      const description = clean(req.body.description, 4000);
      const deadline = clean(req.body.deadline, 10);
      const skills = clean(req.body.skills, 600);
      if (jobTitle.length < 3) return res.status(400).json({ error: "Add a job title of at least 3 characters." });
      if (description.length < 20) return res.status(400).json({ error: "Add a description of at least 20 characters." });
      if (deadline) {
        const parsedDeadline = new Date(`${deadline}T00:00:00.000Z`);
        const isRealDate = /^\d{4}-\d{2}-\d{2}$/.test(deadline) && !Number.isNaN(parsedDeadline.getTime()) && parsedDeadline.toISOString().slice(0, 10) === deadline;
        if (!isRealDate) return res.status(400).json({ error: "Enter a valid application deadline." });
        if (deadline < new Date().toISOString().slice(0, 10)) return res.status(400).json({ error: "The application deadline must be today or later." });
      }
      const inserted = db.prepare(`INSERT INTO jobs (company_id, job_title, location, experience, salary, skills, description, deadline)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(company.id, jobTitle, location, experience, salary, skills, description, deadline || null);
      const job = { id: Number(inserted.lastInsertRowid), job_title: jobTitle, company_name: company.company_name, location, description };
      let notification = { notified: 0, emailed: 0 };
      try { notification = await sendJobAlert(db, job); }
      catch (error) { console.error("Job alert delivery failed:", error.message); }
      return res.status(201).json({ message: "Job posted successfully.", jobId: job.id, notification });
    } catch (error) { return next(error); }
  });

  app.get("/api/companies/me/jobs", employerOnly, (req, res) => {
    const rows = db.prepare(`SELECT j.id, j.job_title, j.location, j.experience, j.salary, j.skills, j.description, j.deadline, j.created_at,
      (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS applicant_count,
      CASE WHEN j.deadline IS NOT NULL AND date(j.deadline) < date('now') THEN 1 ELSE 0 END AS is_expired
      FROM jobs j WHERE j.company_id = ? ORDER BY j.id DESC`).all(req.identity.id);
    res.json(rows);
  });

  app.get("/api/jobs/:id/applications", employerOnly, (req, res) => {
    const jobId = Number(req.params.id);
    const job = db.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").get(jobId, req.identity.id);
    if (!job) return res.status(404).json({ error: "Job post not found." });
    const applicants = db.prepare(`SELECT a.id, a.applied_at, a.status, u.email AS applicant_email
      FROM applications a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.job_id = ? ORDER BY a.id DESC`).all(jobId);
    res.json(applicants);
  });

  app.delete("/api/jobs/:id", employerOnly, (req, res) => {
    const jobId = Number(req.params.id);
    const job = db.prepare("SELECT id FROM jobs WHERE id = ? AND company_id = ?").get(jobId, req.identity.id);
    if (!job) return res.status(404).json({ error: "Job post not found." });
    db.transaction(() => {
      db.prepare("DELETE FROM notifications WHERE job_id = ?").run(jobId);
      db.prepare("DELETE FROM applications WHERE job_id = ?").run(jobId);
      db.prepare("DELETE FROM jobs WHERE id = ?").run(jobId);
    })();
    res.json({ message: "Job post removed." });
  });

  app.post("/api/applications", seekerOnly, (req, res) => {
    const jobId = Number(req.body.job_id);
    if (!Number.isInteger(jobId) || jobId < 1) return res.status(400).json({ error: "Select a valid job." });
    const job = db.prepare("SELECT id FROM jobs WHERE id = ? AND (deadline IS NULL OR date(deadline) >= date('now'))").get(jobId);
    if (!job) return res.status(404).json({ error: "This job is no longer available." });
    const existing = db.prepare("SELECT id FROM applications WHERE job_id = ? AND user_id = ?").get(jobId, req.identity.id);
    if (existing) return res.status(409).json({ error: "You already applied to this role." });
    let result;
    try { result = db.prepare("INSERT INTO applications (job_id, user_id) VALUES (?, ?)").run(jobId, req.identity.id); }
    catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "You already applied to this role." });
      throw error;
    }
    res.status(201).json({ message: "Application received.", applicationId: Number(result.lastInsertRowid) });
  });

  app.get("/api/applications/mine", seekerOnly, (req, res) => {
    const rows = db.prepare(`SELECT a.id AS application_id, a.applied_at, a.status, j.id AS job_id, j.job_title, j.location,
      c.company_name FROM applications a JOIN jobs j ON j.id = a.job_id JOIN companies c ON c.id = j.company_id
      WHERE a.user_id = ? ORDER BY a.id DESC`).all(req.identity.id);
    res.json(rows);
  });

  app.get("/api/applications/stats", seekerOnly, (req, res) => {
    const row = db.prepare(`SELECT
      SUM(CASE WHEN date(applied_at, 'localtime') = date('now', 'localtime') THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN applied_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS thisWeek,
      SUM(CASE WHEN strftime('%Y-%m', applied_at) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END) AS thisMonth,
      SUM(CASE WHEN strftime('%Y', applied_at) = strftime('%Y', 'now') THEN 1 ELSE 0 END) AS thisYear
      FROM applications WHERE user_id = ?`).get(req.identity.id);
    res.json(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value || 0)])));
  });

  app.patch("/api/applications/:id/status", employerOnly, (req, res) => {
    const id = Number(req.params.id);
    const status = clean(req.body.status, 20);
    if (!STATUSES.has(status)) return res.status(400).json({ error: "Choose a valid application status." });
    const application = db.prepare(`SELECT a.id FROM applications a JOIN jobs j ON j.id = a.job_id
      WHERE a.id = ? AND j.company_id = ?`).get(id, req.identity.id);
    if (!application) return res.status(404).json({ error: "Application not found." });
    db.prepare("UPDATE applications SET status = ? WHERE id = ?").run(status, id);
    res.json({ message: "Application status updated." });
  });

  app.get("/api/notifications", seekerOnly, (req, res) => {
    const notifications = db.prepare(`SELECT n.id, n.title, n.message, n.read_at, n.created_at, n.job_id,
      j.job_title, c.company_name FROM notifications n JOIN jobs j ON j.id = n.job_id
      JOIN companies c ON c.id = j.company_id WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`).all(req.identity.id);
    res.json(notifications);
  });

  app.patch("/api/notifications/:id/read", seekerOnly, (req, res) => {
    const result = db.prepare("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(Number(req.params.id), req.identity.id);
    if (!result.changes) return res.status(404).json({ error: "Notification not found." });
    res.json({ message: "Notification marked as read." });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/")) return next();
      return res.sendFile(path.join(staticDir, "index.html"));
    });
  }

  app.use((error, _req, res, _next) => {
    console.error("Request failed:", error.message);
    if (res.headersSent) return;
    return res.status(500).json({ error: "Something went wrong. Please try again." });
  });

  return { app, db };
}

if (require.main === module) {
  if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    console.error("JWT_SECRET must be set in production.");
    process.exit(1);
  }
  const { app } = createApp();
  app.listen(PORT, "0.0.0.0", () => console.log(`JobApp listening on port ${PORT}`));
}

module.exports = { createApp };
