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

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ghUser = url.searchParams.get('ghUser') || env.GITHUB_USER;
  const ghToken = url.searchParams.get('ghToken') || env.GITHUB_TOKEN;
  const vcToken = url.searchParams.get('vcToken') || env.VERCEL_TOKEN;

  if (!ghUser || !ghToken) {
    return new Response(JSON.stringify({ ok: false, error: 'Credenciales incompletas' }), { status: 400 });
  }

  try {
    const results = [];

    // GitHub
    try {
      const repos = await ghApi(`/user/repos?sort=updated&per_page=100`, ghToken);
      repos.filter(r => r.name !== 'ar-publisher' && r.description && r.description.includes('AR Publisher'))
           .forEach(r => results.push({ name: r.name, url: `https://${r.owner.login}.github.io/${r.name}/`, provider: 'gh', updated: r.updated_at }));
    } catch (e) { console.error('GH Error:', e.message); }

    // Vercel
    if (vcToken) {
      try {
        const vRes = await fetch('https://api.vercel.com/v9/projects', {
          headers: { Authorization: `Bearer ${vcToken}` }
        }).then(r => r.json());

        if (vRes.projects) {
          vRes.projects.forEach(p => {
            const existing = results.find(ext => ext.name === p.name);
            if (!existing) {
              results.push({ 
                name: p.name, 
                url: `https://${p.link?.repo ? p.name : (p.targets?.production?.url || p.name + '.vercel.app')}`, 
                provider: 'vc', 
                updated: p.updatedAt 
              });
            } else {
              existing.provider = 'both';
              existing.url = `https://${p.name}.vercel.app`;
            }
          });
        }
      } catch (e) { console.error('VC Error:', e.message); }
    }

    results.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
    return new Response(JSON.stringify({ ok: true, projects: results }), { headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
}
