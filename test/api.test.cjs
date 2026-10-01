const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../server/index.cjs");
const { createDatabase } = require("../server/db.cjs");
const Database = require("better-sqlite3");

const db = createDatabase(":memory:");
const { app } = createApp({ db, jwtSecret: "unit-test-secret-with-sufficient-entropy", staticDir: "/missing-static-directory" });
let server;
let baseUrl;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

async function request(path, { token, ...options } = {}) {
  const headers = { ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body) headers["Content-Type"] = "application/json";
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const data = await response.json();
  return { status: response.status, data };
}

test("self-serve employer hiring and opt-in job alerts work end to end", async () => {
  assert.deepEqual((await request("/api/health")).data, { status: "ok", service: "jobapp" });

  const employerSignup = await request("/api/auth/company/signup", {
    method: "POST",
    body: JSON.stringify({ company_name: "Northstar Studio", email: "hiring@northstar.example", password: "strong-password-1", location: "Remote", industry: "Design" }),
  });
  assert.equal(employerSignup.status, 201);
  const employerLogin = await request("/api/auth/company/login", {
    method: "POST",
    body: JSON.stringify({ email: "hiring@northstar.example", password: "strong-password-1" }),
  });
  assert.equal(employerLogin.status, 200);
  const employerToken = employerLogin.data.token;
  assert.equal(employerSignup.data.company.company_name, "Northstar Studio");
  assert.equal("apiKey" in employerSignup.data.company, false);

  const seekerSignup = await request("/api/auth/user/signup", {
    method: "POST",
    body: JSON.stringify({ email: "seeker@example.test", password: "strong-password-2", job_alerts: true }),
  });
  assert.equal(seekerSignup.status, 201);
  const seekerLogin = await request("/api/auth/user/login", {
    method: "POST",
    body: JSON.stringify({ email: "seeker@example.test", password: "strong-password-2" }),
  });
  assert.equal(seekerLogin.status, 200);
  const seekerToken = seekerLogin.data.token;

  const firstPost = await request("/api/jobs", {
    method: "POST",
    token: employerToken,
    body: JSON.stringify({ job_title: "Product Designer", location: "Remote", experience: "3+ years", salary: "$90k-$120k", skills: "Research, Figma", description: "Build useful, accessible product experiences with a thoughtful team." }),
  });
  assert.equal(firstPost.status, 201);
  assert.equal(firstPost.data.notification.notified, 1);

  const publicJobs = await request("/api/jobs");
  assert.equal(publicJobs.data.length, 1);
  assert.equal(publicJobs.data[0].company_name, "Northstar Studio");

  const alerts = await request("/api/notifications", { token: seekerToken });
  assert.equal(alerts.status, 200);
  assert.equal(alerts.data.length, 1);
  assert.equal(alerts.data[0].job_title, "Product Designer");

  const apply = await request("/api/applications", { method: "POST", token: seekerToken, body: JSON.stringify({ job_id: firstPost.data.jobId }) });
  assert.equal(apply.status, 201);
  assert.equal((await request("/api/applications", { method: "POST", token: seekerToken, body: JSON.stringify({ job_id: firstPost.data.jobId }) })).status, 409);
  const seekerId = db.prepare("SELECT id FROM users WHERE email = ?").get("seeker@example.test").id;
  assert.throws(() => db.prepare("INSERT INTO applications (job_id, user_id) VALUES (?, ?)").run(firstPost.data.jobId, seekerId), { code: "SQLITE_CONSTRAINT_UNIQUE" });

  const companyJobs = await request("/api/companies/me/jobs", { token: employerToken });
  assert.equal(companyJobs.data[0].applicant_count, 1);
  const applicants = await request(`/api/jobs/${firstPost.data.jobId}/applications`, { token: employerToken });
  assert.equal(applicants.data[0].applicant_email, "seeker@example.test");

  const updated = await request(`/api/applications/${apply.data.applicationId}/status`, { method: "PATCH", token: employerToken, body: JSON.stringify({ status: "Reviewing" }) });
  assert.equal(updated.status, 200);
  const mine = await request("/api/applications/mine", { token: seekerToken });
  assert.equal(mine.data[0].status, "Reviewing");

  const optedOut = await request("/api/auth/user/job-alerts", { method: "PATCH", token: seekerToken, body: JSON.stringify({ job_alerts: false }) });
  assert.equal(optedOut.data.job_alerts, false);
  await request("/api/jobs", { method: "POST", token: employerToken, body: JSON.stringify({ job_title: "Product Researcher", description: "Help teams learn what people need and build better services." }) });
  assert.equal((await request("/api/notifications", { token: seekerToken })).data.length, 1);

  await request("/api/auth/user/job-alerts", { method: "PATCH", token: seekerToken, body: JSON.stringify({ job_alerts: true }) });
  await request("/api/jobs", { method: "POST", token: employerToken, body: JSON.stringify({ job_title: "Design Research Lead", description: "Lead collaborative research that improves product experiences." }) });
  assert.equal((await request("/api/notifications", { token: seekerToken })).data.length, 2);

  const pastDeadlinePost = await request("/api/jobs", { method: "POST", token: employerToken, body: JSON.stringify({ job_title: "Expired role", description: "This role should not accept applications after its deadline.", deadline: "2000-01-01" }) });
  assert.equal(pastDeadlinePost.status, 400);
  const companyId = db.prepare("SELECT id FROM companies WHERE email = ?").get("hiring@northstar.example").id;
  const expiredJobId = Number(db.prepare("INSERT INTO jobs (company_id, job_title, description, deadline) VALUES (?, ?, ?, ?)").run(companyId, "Legacy expired role", "An old role from an earlier posting.", "2000-01-01").lastInsertRowid);
  assert.equal((await request("/api/jobs")).data.some((job) => job.id === expiredJobId), false);
  assert.equal((await request("/api/applications", { method: "POST", token: seekerToken, body: JSON.stringify({ job_id: expiredJobId }) })).status, 404);

  assert.equal((await request("/api/jobs", { method: "POST", token: seekerToken, body: JSON.stringify({}) })).status, 403);
  assert.equal((await request("/api/companies/me/jobs")).status, 401);
});

test("migrates the original company and application schema without losing rows", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jobapp-legacy-"));
  const filename = path.join(directory, "legacy.db");
  const legacy = new Database(filename);
  legacy.exec(`
    CREATE TABLE companies (id INTEGER PRIMARY KEY AUTOINCREMENT, company_name TEXT NOT NULL, company_email TEXT, company_website TEXT, location TEXT, apiKey TEXT UNIQUE NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER NOT NULL, job_title TEXT NOT NULL, location TEXT, experience TEXT, salary TEXT, skills TEXT, description TEXT, deadline TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id INTEGER NOT NULL, applied_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO companies (company_name, company_email, apiKey) VALUES ('Legacy Co', 'hello@legacy.test', 'legacy-key');
  `);
  legacy.close();

  const migrated = createDatabase(filename);
  const companyColumns = migrated.prepare("PRAGMA table_info(companies)").all().map((column) => column.name);
  const applicationColumns = migrated.prepare("PRAGMA table_info(applications)").all().map((column) => column.name);
  assert.ok(companyColumns.includes("password_hash"));
  assert.ok(companyColumns.includes("email"));
  assert.ok(applicationColumns.includes("user_id"));
  assert.ok(applicationColumns.includes("status"));
  assert.equal(migrated.prepare("SELECT company_name FROM companies WHERE apiKey = 'legacy-key'").get().company_name, "Legacy Co");
  migrated.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
