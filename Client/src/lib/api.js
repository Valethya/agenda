const API_URL = import.meta.env.PUBLIC_API_URL;

if (!API_URL) {
  throw new Error("PUBLIC_API_URL no está definida");
}

export async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}