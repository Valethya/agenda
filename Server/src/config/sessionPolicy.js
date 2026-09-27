export const sessionCookieOptionsFor = (environment) => ({
  httpOnly: true,
  maxAge: 1000 * 60 * 60 * 24,
  secure: environment === "production",
  sameSite: environment === "production" ? "none" : "lax",
});
