import JSZip from 'jszip';

async function ghApi(url, token, method = 'GET', body = null) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'AR-Publisher-Cloudflare',
    ...(body ? { 'Content-Type': 'application/json' } : {})
  };
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API Error: ${res.status} ${err}`);
  }
  return res.json();
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const ghToken = env.GITHUB_TOKEN;
  const ghUser = env.GITHUB_USER;

  try {
    const formData = await request.formData();
    const zipBlob = formData.get('zip');
    let repoName = (formData.get('repo') || 'ar-experience').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const clientToken = formData.get('token') || ghToken;
    const clientUser = formData.get('user') || ghUser;

    if (!zipBlob || !clientToken || !clientUser) {
      return new Response(JSON.stringify({ ok: false, error: 'Credenciales o ZIP faltante' }), { status: 400 });
    }

    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    
    // Find root
    const allPaths = Object.keys(zip.files);
    const validPaths = allPaths.filter(p => !p.includes('__MACOSX') && !p.split('/').pop().startsWith('.'));
    const indexFile = validPaths.filter(p => p.toLowerCase().endsWith('index.html'))
                               .sort((a,b) => a.split('/').length - b.split('/').length)[0];
    let basePath = '';
    if (indexFile && indexFile.includes('/')) basePath = indexFile.substring(0, indexFile.lastIndexOf('/') + 1);

    // 1. Ensure Repo
    try {
      await ghApi(`/repos/${clientUser}/${repoName}`, clientToken);
    } catch (e) {
      if (e.message.includes('404')) {
        await ghApi('/user/repos', clientToken, 'POST', {
          name: repoName,
          description: 'WebAR — publicado con AR Publisher (Cloudflare)',
          private: false,
          auto_init: true
        });
        await new Promise(r => setTimeout(r, 4000));
      } else throw e;
    }

    // 2. Upload Blobs
    const treeItems = [];
    treeItems.push({ path: '.nojekyll', mode: '100644', type: 'blob', content: '' });

    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir || !path.startsWith(basePath) || path.includes('__MACOSX') || path.split('/').pop().startsWith('.')) continue;

      const buffer = await file.async('uint8array');
      const blobRes = await ghApi(`/repos/${clientUser}/${repoName}/git/blobs`, clientToken, 'POST', {
        content: btoa(String.fromCharCode(...buffer)), // Simple base64 for Cloudflare
        encoding: 'base64'
      });

      treeItems.push({
        path: path.replace(basePath, '').replace(/\\/g, '/'),
        mode: '100644',
        type: 'blob',
        sha: blobRes.sha
      });
    }

    // 3. Tree, Commit, Ref
    const treeRes = await ghApi(`/repos/${clientUser}/${repoName}/git/trees`, clientToken, 'POST', { tree: treeItems });
    const commitRes = await ghApi(`/repos/${clientUser}/${repoName}/git/commits`, clientToken, 'POST', {
      message: 'Deploy via AR Publisher (Cloudflare Pages)',
      tree: treeRes.sha
    });

    let headRef = 'heads/main';
    try {
      await ghApi(`/repos/${clientUser}/${repoName}/git/refs/${headRef}`, clientToken, 'PATCH', { sha: commitRes.sha, force: true });
    } catch (e) {
      await ghApi(`/repos/${clientUser}/${repoName}/git/refs`, clientToken, 'POST', { ref: `refs/${headRef}`, sha: commitRes.sha });
    }

    // 4. Activate Pages
    try {
      await fetch(`https://api.github.com/repos/${clientUser}/${repoName}/pages`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${clientToken}`, 
          Accept: 'application/vnd.github.switcheroo-preview+json',
          'Content-Type': 'application/json',
          'User-Agent': 'AR-Publisher-Cloudflare'
        },
        body: JSON.stringify({ source: { branch: 'main', path: '/' } })
      });
    } catch (e) {}

    return new Response(JSON.stringify({
      ok: true,
      url: `https://${clientUser}.github.io/${repoName}/`,
      repo: `https://github.com/${clientUser}/${repoName}`
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
}
