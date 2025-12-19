// cloudSync.js
// Google Drive sync for extension settings - no Firebase, no external dependencies

const SETTINGS_FILENAME = 'imaginex-settings.json';
let cachedFileId = null;

// Log once when module loads
console.info('[Imaginex] Drive sync module loaded');

export function isCloudConfigured() {
  try {
    const mf = chrome.runtime.getManifest?.() || {};
    const hasIdentity =
      Array.isArray(mf.permissions) && mf.permissions.includes('identity');
    const oauth = mf.oauth2 || {};
    const clientId = oauth.client_id || '';
    const scopes = oauth.scopes || [];
    const hasDriveScope = scopes.includes(
      'https://www.googleapis.com/auth/drive.appdata'
    );
    const clientLooksSet = clientId && !clientId.startsWith('YOUR_CLIENT_ID');
    return hasIdentity && hasDriveScope && clientLooksSet;
  } catch (_) {
    return false;
  }
}

function getAuthToken(interactive = false) {
  if (!isCloudConfigured()) {
    return Promise.reject(
      new Error(
        'Cloud sync not configured: set oauth2 client_id and Drive appdata scope in manifest.json'
      )
    );
  }
  return new Promise((resolve, reject) => {
    try {
      chrome.identity.getAuthToken({ interactive }, token => {
        const err = chrome.runtime.lastError;
        if (err || !token) {
          reject(err || new Error('No auth token'));
        } else {
          resolve(token);
        }
      });
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
