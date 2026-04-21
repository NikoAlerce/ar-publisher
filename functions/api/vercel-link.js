export async function onRequestPost(context) {
  const { request, env } = context;
  const vcTokenShared = env.VERCEL_TOKEN;

  try {
    const { user, repoName, vToken, token } = await request.json();
    const clientVToken = vToken || vcTokenShared;

    if (!clientVToken) {
      return new Response(JSON.stringify({ ok: false, error: 'Token de Vercel no provisto' }), { status: 400 });
    }

    const vRes = await fetch('https://api.vercel.com/v11/projects', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${clientVToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repoName,
        gitRepository: {
          type: 'github',
          repo: `${user}/${repoName}`
        },
        framework: null
      })
    });

    const data = await vRes.json();
    if (!vRes.ok && vRes.status !== 409) {
      throw new Error(data.error?.message || 'Error vinculando a Vercel');
    }

    return new Response(JSON.stringify({ ok: true, url: `https://${repoName}.vercel.app` }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
}
