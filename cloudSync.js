// cloudSync.js
// Google Drive sync for extension settings
// Vivaldi-friendly auth via chrome.identity.launchWebAuthFlow (Web OAuth client)

const SETTINGS_FILENAME = 'imaginex-settings.json';
let cachedFileId = null;
let cachedToken = null;
let cachedTokenExpiry = 0; // epoch ms

// Web OAuth Client (implicit flow)
// Provided by user: Web client created in Google Cloud console
const WEB_CLIENT_ID =
  '1054967656600-j262rupqi415tdqv4c0dmjhfkb6rlbpd.apps.googleusercontent.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// Log once when module loads
console.info('[Imaginex] Drive sync module loaded');

function buildOAuthUrls(interactive = true) {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('client_id', WEB_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', DRIVE_SCOPE);
  authUrl.searchParams.set('include_granted_scopes', 'true');
  authUrl.searchParams.set(
    'prompt',
    interactive ? 'consent' : 'select_account'
  );
  return { authUrl, redirectUri };
}

export function getOAuthDebugInfo() {
  const { authUrl, redirectUri } = buildOAuthUrls(true);
  return {
    extensionId: chrome.runtime.id,
    clientId: WEB_CLIENT_ID,
    redirectUri,
    scope: DRIVE_SCOPE,
    authUrl: authUrl.toString(),
  };
}

export function isCloudConfigured() {
  try {
    const mf = chrome.runtime.getManifest?.() || {};
    const hasIdentity =
      Array.isArray(mf.permissions) && mf.permissions.includes('identity');
    // For Vivaldi, we rely on Web OAuth client; manifest oauth2 is optional
    const webClientSet =
      typeof WEB_CLIENT_ID === 'string' &&
      WEB_CLIENT_ID.endsWith('.apps.googleusercontent.com');
    return hasIdentity && webClientSet;
  } catch (_) {
    return false;
  }
}

function parseFragmentParams(urlStr) {
  try {
    const u = new URL(urlStr);
    const hash = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
    const params = new URLSearchParams(hash);
    return params;
  } catch (_) {
    return new URLSearchParams('');
  }
}

function getAuthToken(interactive = true) {
  if (!isCloudConfigured()) {
    return Promise.reject(
      new Error('Cloud sync not configured: missing Web OAuth client')
    );
  }

  const now = Date.now();
  if (cachedToken && cachedTokenExpiry - 5000 > now) {
    return Promise.resolve(cachedToken);
  }

  const { authUrl, redirectUri } = buildOAuthUrls(interactive);
  console.info('[Imaginex] OAuth debug', {
    clientId: WEB_CLIENT_ID,
    redirectUri,
    authUrl: authUrl.toString(),
  });

  return new Promise((resolve, reject) => {
    try {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        redirect => {
          const err = chrome.runtime.lastError;
          if (err) return reject(err);
          if (!redirect) return reject(new Error('No redirect from OAuth'));
          const params = parseFragmentParams(redirect);
          const accessToken = params.get('access_token');
          const expiresIn = Number(params.get('expires_in') || '0');
          const errorDesc =
            params.get('error_description') || params.get('error');
          if (!accessToken) {
            console.error('[Imaginex] OAuth failure', { errorDesc, redirect });
            return reject(new Error(errorDesc || 'No access token'));
          }
          cachedToken = accessToken;
          cachedTokenExpiry =
            Date.now() + (expiresIn > 0 ? expiresIn * 1000 : 3600 * 1000);
          resolve(accessToken);
        }
      );
    } catch (e) {
      reject(e);
    }
  });
}

async function driveRequest(path, options = {}) {
  const { method = 'GET', token, query, body, headers } = options;
  const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const fetchOptions = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && typeof body === 'object' && !(body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...headers,
    },
  };

  if (body) {
    fetchOptions.body =
      typeof body === 'object' && !(body instanceof FormData)
        ? JSON.stringify(body)
        : body;
  }

  const response = await fetch(url.toString(), fetchOptions);
  if (!response.ok) {
    throw new Error(
      `Drive API error: ${response.status} ${response.statusText}`
    );
  }
  return response.json();
}

async function findSettingsFile(token) {
  if (cachedFileId) return cachedFileId;

  const result = await driveRequest('files', {
    token,
    query: {
      spaces: 'appDataFolder',
      q: `name='${SETTINGS_FILENAME}' and trashed=false`,
      fields: 'files(id,name)',
    },
  });

  const file = result.files?.[0];
  if (file) {
    cachedFileId = file.id;
  }
  return cachedFileId;
}

async function createSettingsFile(token, settings) {
  const metadata = {
    name: SETTINGS_FILENAME,
    parents: ['appDataFolder'],
  };

  const boundary = 'imaginex_boundary_' + Math.random().toString(36).slice(2);
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    '\r\n' +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify(settings) +
    '\r\n' +
    `--${boundary}--`;

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!response.ok) {
    throw new Error('Failed to create settings file');
  }

  const result = await response.json();
  cachedFileId = result.id;
  return cachedFileId;
}

export async function signIn(interactive = true) {
  const token = await getAuthToken(interactive);
  return { token };
}

export function getCurrentUser() {
  return null; // Not needed for Drive API
}

export async function saveSettingsToCloud(settings) {
  const token = await getAuthToken(true);
  let fileId = await findSettingsFile(token);

  if (!fileId) {
    fileId = await createSettingsFile(token, settings);
  } else {
    const response = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      }
    );

    if (!response.ok) {
      throw new Error('Failed to update settings file');
    }
  }

  return true;
}

export async function loadSettingsFromCloud() {
  const token = await getAuthToken(true);
  const fileId = await findSettingsFile(token);

  if (!fileId) {
    throw new Error('No cloud settings found');
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!response.ok) {
    throw new Error('Failed to download settings file');
  }

  return response.json();
}
