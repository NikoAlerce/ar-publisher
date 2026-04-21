export async function onRequestPost(context) {
  const { request, env } = context;
  const vcTokenShared = env.VERCEL_TOKEN;

  try {
    const { name, vToken } = await request.json();
    const clientVToken = vToken || vcTokenShared;

    if (!name || !clientVToken) {
      return new Response(JSON.stringify({ ok: false, error: 'Nombre o Token faltante' }), { status: 400 });
    }

    const vRes = await fetch(`https://api.vercel.com/v9/projects/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${clientVToken}` }
    });

    if (!vRes.ok && vRes.status !== 404) {
      const data = await vRes.json();
      throw new Error(data.error?.message || 'Error eliminando proyecto en Vercel');
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
}
