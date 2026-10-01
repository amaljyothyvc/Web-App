const nodemailer = require("nodemailer");

function createTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) return null;
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: String(SMTP_SECURE || "false").toLowerCase() === "true",
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
}

async function sendJobAlert(db, job) {
  const insertNotification = db.prepare("INSERT INTO notifications (user_id, job_id, title, message) VALUES (?, ?, ?, ?)");
  const optedInUsers = db.prepare("SELECT id, email FROM users WHERE job_alerts = 1").all();
  if (!optedInUsers.length) return { notified: 0, emailed: 0 };
  const message = `${job.job_title} at ${job.company_name}${job.location ? ` · ${job.location}` : ""}`;
  const insertMany = db.transaction((users) => {
    for (const user of users) insertNotification.run(user.id, job.id, "New job posted", message);
  });
  insertMany(optedInUsers);

  const transport = createTransport();
  if (!transport) return { notified: optedInUsers.length, emailed: 0 };
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const results = await Promise.allSettled(optedInUsers.map((user) => transport.sendMail({
    from,
    to: user.email,
    subject: `New JobApp opportunity: ${job.job_title}`,
    text: `A new role is available on JobApp.\n\n${job.job_title}\n${job.company_name}\n${job.location || "Location flexible"}\n\n${job.description || "View the role and apply on JobApp."}`,
  })));
  return { notified: optedInUsers.length, emailed: results.filter((result) => result.status === "fulfilled").length };
}

module.exports = { sendJobAlert };
