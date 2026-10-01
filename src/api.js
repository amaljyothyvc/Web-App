const API_BASE = import.meta.env.VITE_API_URL || "";

const tokenFor = (role) => localStorage.getItem(role === "employer" ? "companyToken" : "userToken");

export async function api(path, { role, ...options } = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = role ? tokenFor(role) : null;
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function saveSession(role, token) {
  const otherToken = role === "employer" ? "userToken" : "companyToken";
  const sessionToken = role === "employer" ? "companyToken" : "userToken";
  localStorage.removeItem(otherToken);
  localStorage.setItem(sessionToken, token);
}

export function clearSession(role) {
  localStorage.removeItem(role === "employer" ? "companyToken" : "userToken");
}
