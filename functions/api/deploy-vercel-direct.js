import JSZip from 'jszip';

async function sha1(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const vToken = env.VERCEL_TOKEN;

  try {
    const formData = await request.formData();
    const zipBlob = formData.get('zip');
    const repoName = formData.get('repo');
    const clientVToken = formData.get('vToken') || vToken;

    if (!zipBlob || !clientVToken) {
      return new Response(JSON.stringify({ ok: false, error: 'ZIP o Token faltante' }), { status: 400 });
    }

    const zip = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    const filesToUpload = [];

    // Helper to find index.html to establish root
    const allPaths = Object.keys(zip.files);
    const validPaths = allPaths.filter(p => !p.includes('__MACOSX') && !p.split('/').pop().startsWith('.'));
    const indexFile = validPaths.filter(p => p.toLowerCase().endsWith('index.html'))
                               .sort((a,b) => a.split('/').length - b.split('/').length)[0];
    
    let basePath = '';
    if (indexFile && indexFile.includes('/')) {
        basePath = indexFile.substring(0, indexFile.lastIndexOf('/') + 1);
    }

    // Process files
    for (const [path, file] of Object.entries(zip.files)) {
      if (file.dir || !path.startsWith(basePath) || path.includes('__MACOSX') || path.split('/').pop().startsWith('.')) continue;

      const buffer = await file.async('uint8array');
      const hash = await sha1(buffer);
      const relPath = path.replace(basePath, '');

      // Upload file to Vercel (Skip if already there? Vercel API handles this if we just send the hash first, but for simplicity we upload)
      await fetch('https://api.vercel.com/v2/files', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${clientVToken}`, 
          'x-vercel-digest': hash, 
          'Content-Length': buffer.length 
        },
        body: buffer
      });

      filesToUpload.push({ file: relPath.replace(/\\/g, '/'), sha: hash, size: buffer.length });
    }

    // Create deployment
    const dRes = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientVToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repoName,
        files: filesToUpload,
        projectSettings: { framework: null }
      })
    });

    const dData = await dRes.json();
    if (!dRes.ok) throw new Error(dData.error?.message || 'Error en Vercel Deploy');

    return new Response(JSON.stringify({ ok: true, url: `https://${dData.alias[0] || dData.url}` }), {
        headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
}
