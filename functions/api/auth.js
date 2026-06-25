// POST /api/auth — Verify password
export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' } });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const body = await request.json();
    const inputPwd = body.password || '';
    
    // Query stored password from DB
    const row = await env.DB.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).bind('site_password').first();
    
    const storedPwd = row ? row.value : '123456789A';
    
    if (inputPwd === storedPwd) {
      // Generate simple token (base64 encoded timestamp+password)
      const token = btoa(Date.now() + ':' + storedPwd);
      return new Response(JSON.stringify({ ok: true, token }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }
    
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 400 });
  }
}
