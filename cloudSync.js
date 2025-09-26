// cloudSync.js
// Manual Firestore sync for extension settings
// Replace firebaseConfig with your own project values

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
};

let firebaseApp = null;
let firestore = null;
let auth = null;
let user = null;

async function ensureFirebase() {
  if (firebaseApp) return;
  try {
    const appMod = await import(
      'https://www.gstatic.com/firebasejs/9.24.0/firebase-app.js'
    );
    const authMod = await import(
      'https://www.gstatic.com/firebasejs/9.24.0/firebase-auth.js'
    );
    const fsMod = await import(
      'https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js'
    );
    firebaseApp = appMod.initializeApp(firebaseConfig);
    auth = authMod.getAuth(firebaseApp);
    firestore = fsMod.getFirestore(firebaseApp);
  } catch (e) {
    throw new Error('Failed to load Firebase SDK');
  }
}

export async function signIn(interactive = true) {
  await ensureFirebase();
  if (user) return user;
  const { GoogleAuthProvider, signInWithPopup } = await import(
    'https://www.gstatic.com/firebasejs/9.24.0/firebase-auth.js'
  );
  try {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    user = cred.user;
    return user;
  } catch (e) {
    throw new Error('Sign-in failed');
  }
}

export function getCurrentUser() {
  return user;
}

export async function saveSettingsToCloud(settings) {
  await ensureFirebase();
  if (!user) await signIn(true);
  const { doc, setDoc } = await import(
    'https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js'
  );
  const docRef = doc(firestore, 'settings', user.uid);
  await setDoc(docRef, settings, { merge: true });
  return true;
}

export async function loadSettingsFromCloud() {
  await ensureFirebase();
  if (!user) await signIn(true);
  const { doc, getDoc } = await import(
    'https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore.js'
  );
  const docRef = doc(firestore, 'settings', user.uid);
  const snap = await getDoc(docRef);
  if (!snap.exists()) throw new Error('No cloud settings found');
  return snap.data();
}
