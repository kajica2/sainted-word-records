// lib/storage.client.js — window.SWR_STORAGE: upload/download/list blobs
// and projects via the API. Backed by /api/storage/sign-upload,
// /api/storage/object (PUT/GET), /api/projects (GET/POST),
// /api/projects/<id> (GET/PUT/DELETE).

(function () {
  if (window.SWR_STORAGE) return;

  async function jsonReq(url, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    const res = await fetch(url, Object.assign({ credentials: 'include' }, opts, { headers }));
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch {}
      const err = new Error((body && body.error) || `http_${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function uploadBlob(blob, key, opts) {
    opts = opts || {};
    const signed = await jsonReq('/api/storage/sign-upload', {
      method: 'POST',
      body: JSON.stringify({ key, contentType: blob.type || opts.contentType || 'application/octet-stream' }),
    });
    const putRes = await fetch(signed.uploadUrl, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!putRes.ok) {
      throw new Error('upload_failed: ' + putRes.status);
    }
    return signed;
  }

  async function downloadBlob(key) {
    const signed = await jsonReq('/api/storage/sign-download', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    const res = await fetch(signed.downloadUrl, { credentials: 'include' });
    if (!res.ok) throw new Error('download_failed: ' + res.status);
    return res.blob();
  }

  async function listProjects() {
    const body = await jsonReq('/api/projects', { method: 'GET' });
    return body && body.items ? body.items : [];
  }

  async function loadProject(id) {
    return jsonReq('/api/projects/' + encodeURIComponent(id), { method: 'GET' });
  }

  async function saveProject(doc) {
    if (doc && doc.id) {
      return jsonReq('/api/projects/' + encodeURIComponent(doc.id), {
        method: 'PUT',
        body: JSON.stringify(doc),
      });
    }
    return jsonReq('/api/projects', {
      method: 'POST',
      body: JSON.stringify(doc),
    });
  }

  async function deleteProject(id) {
    return jsonReq('/api/projects/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  // Convenience: upload a File (from <input type="file">) and return { key, size }.
  async function uploadFile(file, keyPrefix) {
    const safeName = (file.name || 'blob').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const key = (keyPrefix || 'uploads') + '/' + Date.now() + '_' + safeName;
    const signed = await uploadBlob(file, key);
    return { key: signed.key, size: file.size, contentType: file.type, name: file.name };
  }

  // Convenience: download a blob and return a File (so it can be loaded
  // via the engine's existing file-input handler).
  async function downloadAsFile(key, fileName) {
    const blob = await downloadBlob(key);
    return new File([blob], fileName || key.split('/').pop(), { type: blob.type });
  }

  window.SWR_STORAGE = {
    uploadBlob,
    downloadBlob,
    uploadFile,
    downloadAsFile,
    listProjects,
    loadProject,
    saveProject,
    deleteProject,
  };
})();
