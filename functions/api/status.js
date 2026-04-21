export async function onRequestGet(context) {
  const { env } = context;
  
  const ghUser = env.GITHUB_USER || '';
  const ghToken = env.GITHUB_TOKEN || '';
  const vcToken = env.VERCEL_TOKEN || '';
  
  return new Response(JSON.stringify({
    git: true,
    tokenSet: !!ghToken && ghToken !== 'PEGAR_AQUI',
    vercelSet: !!vcToken,
    user: ghUser,
    online: true,
    provider: 'cloudflare'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
