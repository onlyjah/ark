// SO/IL provider configuration is server owned. Only public URLs reach the browser.
export function soilConfig(env: Record<string, string | undefined>) {
  const checked = (value: string) => {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash ||
        (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))))
      throw new Error('SO/IL URLs require HTTPS, without credentials, query or fragment');
    return u.href.replace(/\/$/, '');
  };
  const mode = env.SOIL_AUTH_MODE || 'compatible';
  if (!['compatible', 'soil'].includes(mode)) throw new Error('Unsupported SO/IL authentication mode');
  const apiUrl = checked(env.SOIL_API_URL || 'https://soil.jah.earth/api/v1');
  const appUrl = checked(env.SOIL_APP_URL || 'https://soil.jah.earth/app');
  const issuer = checked(env.SOIL_ISSUER || apiUrl);
  const jwksUrl = checked(env.SOIL_JWKS_URL || apiUrl + '/.well-known/jwks.json');
  const audience = env.SOIL_AUDIENCE || 'kash';
  if (!/^[a-zA-Z0-9:._-]{1,128}$/.test(audience)) throw new Error('Invalid SO/IL audience');
  return Object.freeze({ mode, apiUrl, appUrl, issuer, jwksUrl, audience });
}
export const soilVariables = ['SOIL_AUTH_MODE', 'SOIL_API_URL', 'SOIL_APP_URL', 'SOIL_ISSUER', 'SOIL_JWKS_URL', 'SOIL_AUDIENCE'];
