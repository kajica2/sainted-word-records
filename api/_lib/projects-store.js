// api/_lib/projects-store.js — Project store with optional Firestore path.
//
// Mirrors the connect-store.js pattern: the local store (Vercel Postgres
// in production, JSON files in dev) is the default — see api/_lib/db.js.
// Firestore is the optional Google path, OFF by default:
//
//   SWR_PROJECTS_STORE=firestore  +  FIREBASE_PROJECT_ID  +  credentials
//
// Activating Firestore swaps the storage backend without changing the API
// surface; the only consumer (api/projects/index.js, [id].js,
// share/[shareId].js, kits/index.js, kits/[id].js) reads / writes via
// these helpers.
//
// Collections (Firestore only):
//   projects/{projectId}        { userId, name, updatedAt, share, shareId, doc }
//   kits/{kitId}                { userId, name, createdAt, items: [{kind, name, size}], zipRef }
//
// The kit zip is stored in Vercel Blob when projects use the local store
// (the default), and in a sibling Cloud Storage bucket referenced by
// `zipRef` when Firestore is the project store. The zip is ALWAYS in
// object storage — never inlined into Firestore; keeping it out of the
// document keeps Firestore document size (1 MiB cap) safe.

import { firestoreConfigured, getFirestore } from './firestore.js';

function backend() {
  return process.env.SWR_PROJECTS_STORE === 'firestore' && firestoreConfigured()
    ? 'firestore'
    : 'local';
}

function useFirestore() {
  return backend() === 'firestore';
}

// Mirror the api/_lib/db.js export shape so projects handlers can switch.
export async function listProjects(userId) {
  if (!useFirestore()) {
    const { listProjects: localList } = await import('./db.js');
    return localList(userId);
  }
  const fs = await getFirestore();
  const q = await fs.collection('projects')
    .where('userId', '==', userId)
    .orderBy('updatedAt', 'desc')
    .get();
  return q.docs
    .filter((d) => !d.get('deletedAt'))
    .map((d) => d.data());
}

export async function getProject(userId, id) {
  if (!useFirestore()) {
    const { getProject: localGet } = await import('./db.js');
    return localGet(userId, id);
  }
  const fs = await getFirestore();
  const doc = await fs.collection('projects').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.userId !== userId) return null;
  return data;
}

export async function upsertProject(userId, id, doc) {
  if (!useFirestore()) {
    const { upsertProject: localUpsert } = await import('./db.js');
    return localUpsert(userId, id, doc);
  }
  const fs = await getFirestore();
  if (!id) id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ref = fs.collection('projects').doc(id);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;
  if (existing && existing.userId !== userId) return null;
  const meta = {
    id, userId,
    name: (doc && doc.name) || (existing && existing.name) || 'Untitled',
    updatedAt: now,
    deletedAt: existing ? existing.deletedAt : null,
    share: !!(doc && doc.share),
    shareId: (doc && doc.shareId) || (existing && existing.shareId) || null,
    doc: doc && doc.doc ? doc.doc : doc || null,
  };
  await ref.set(meta, { merge: true });
  return { id, userId, name: meta.name, updatedAt: now };
}

export async function getSharedProject(shareId) {
  if (!shareId) return null;
  if (!useFirestore()) {
    const { getSharedProject: local } = await import('./db.js');
    return local(shareId);
  }
  const fs = await getFirestore();
  const q = await fs.collection('projects')
    .where('shareId', '==', shareId)
    .where('share', '==', true)
    .limit(1)
    .get();
  if (q.empty) return null;
  const d = q.docs[0];
  const data = d.data();
  // Strip userId before returning (privacy).
  const { userId, ...rest } = data;
  return rest;
}

// ---- kits ----
// A kit is a named bundle: a list of items (audio, image, video, project
// JSON) plus a zip stored in object storage. The listProjects / getProject
// surface stays unchanged; kits use a parallel `kits/` collection.

export async function listKits(userId) {
  if (!useFirestore()) {
    const { listKits: local } = await import('./db.js');
    return local(userId);
  }
  const fs = await getFirestore();
  const q = await fs.collection('kits')
    .where('userId', '==', userId)
    .orderBy('createdAt', 'desc')
    .get();
  return q.docs
    .filter((d) => !d.get('deletedAt'))
    .map((d) => d.data());
}

export async function getKit(userId, id) {
  if (!useFirestore()) {
    const { getKit: local } = await import('./db.js');
    return local(userId, id);
  }
  const fs = await getFirestore();
  const doc = await fs.collection('kits').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data();
  if (data.userId !== userId) return null;
  return data;
}

export async function upsertKit(userId, id, doc) {
  if (!useFirestore()) {
    const { upsertKit: local } = await import('./db.js');
    return local(userId, id, doc);
  }
  const fs = await getFirestore();
  if (!id) id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ref = fs.collection('kits').doc(id);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;
  if (existing && existing.userId !== userId) return null;
  const meta = {
    id, userId,
    name: (doc && doc.name) || (existing && existing.name) || 'Untitled kit',
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now,
    deletedAt: existing ? existing.deletedAt : null,
    items: doc && doc.items ? doc.items : (existing && existing.items) || [],
    zipRef: doc && doc.zipRef ? doc.zipRef : (existing && existing.zipRef) || null,
  };
  await ref.set(meta, { merge: true });
  return { id, userId, name: meta.name, updatedAt: now };
}

export function projectsBackend() { return backend(); }
