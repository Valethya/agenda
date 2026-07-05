const API_URL = import.meta.env.PUBLIC_API_URL;

if (!API_URL) {
  throw new Error("PUBLIC_API_URL no está definida");
}

export async function apiFetch(path, options = {}) {
  // Obtener slug de la URL actual (?slug=nombre-negocio)
  let slug = "atmosfera";
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    const urlSlug = params.get("slug");
    if (urlSlug) {
      slug = urlSlug;
    }
  }

  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "x-business-slug": slug, // Adjuntar el slug del negocio
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status}`);
  }

  return res.json();
}