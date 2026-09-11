export function resolveClientApiUrl(value: string | undefined, production: boolean): string {
  if (!value?.trim()) throw new Error("PUBLIC_API_URL no está definida");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("PUBLIC_API_URL debe ser una URL absoluta válida");
  }

  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("PUBLIC_API_URL no debe incluir credenciales, query ni fragmento");
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath !== "/api") {
    throw new Error("PUBLIC_API_URL debe apuntar exactamente al prefijo /api");
  }

  if (production) {
    if (parsed.protocol !== "https:") throw new Error("PUBLIC_API_URL debe usar HTTPS en producción");
    if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname)) {
      throw new Error("PUBLIC_API_URL no puede apuntar a un host local en producción");
    }
  } else if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error("PUBLIC_API_URL debe usar HTTP(S)");
  }

  return `${parsed.origin}/api`;
}
