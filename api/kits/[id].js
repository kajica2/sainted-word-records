// api/kits/[id].js — GET (read manifest + a fresh signed-download URL
// for the assembled .zip), DELETE (soft-delete, matches projects API).
//
// The actual zip construction happens lazily on GET — the server packs
// the named items, stores the result in object storage, returns a
// short-lived signed-download URL. The cache key is the kit id so a
// second GET gets a stable URL until the items change.

import { requireUser } from '../_lib/session.js';
import { getKit, softDeleteKit, upsertKit } from '../_lib/db.js';
import { buildZipFromItems } from '../_lib/kit-zip.js';
import { sendJson, setCors } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const id = String(req.query.id || '');
  if (!id) return sendJson(res, 400, { error: 'missing_id' });

  if (req.method === 'GET') {
    const kit = await getKit(ctx.user.id, id);
    if (!kit || kit.deletedAt) return sendJson(res, 404, { error: 'not_found' });
    // Build (or rebuild on ?refresh=1) the packed zip; store it.
    if (!kit.zipRef || (req.query.refresh === '1')) {
      const { storagePut } = await import('../_lib/db.js');
      const { createSignedDownload } = await import('../_lib/storage.js').catch(() => ({}));
      const z = await buildZipFromItems(ctx.user.id, kit);
      const storageKey = `kits/${id}.zip`;
      if (storagePut) await storagePut(ctx.user.id, storageKey, z, 'application/zip');
      kit.zipRef = storageKey;
      kit.size = z.length;
      // persist the refreshed manifest
      await upsertKit(ctx.user.id, id, kit);
      if (createSignedDownload) {
        const url = await createSignedDownload(ctx.user.id, storageKey);
        return sendJson(res, 200, { kit, url });
      }
    }
    return sendJson(res, 200, { kit });
  }

  if (req.method === 'DELETE') {
    const ok = await softDeleteKit(ctx.user.id, id);
    if (!ok) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, { ok: true });
  }

  res.setHeader('Allow', 'GET, DELETE, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}
