// GET /api/data — Query all data or filter by asin
// DELETE /api/data?asin=XXX&date=YYYY-MM-DD — Delete specific date
// DELETE /api/data?asin=XXX&keyword=YYY — Delete keyword across all dates
// PATCH /api/data — Update product name { asin, name }
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, DELETE, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

  // PATCH — Update product name
  if (request.method === 'PATCH') {
    try {
      const body = await request.json();
      const { asin, name } = body;
      if (!asin || !name) return new Response(JSON.stringify({ error: 'Missing asin or name' }), { status: 400, headers });
      await db.prepare('UPDATE products SET name = ? WHERE asin = ?').bind(name, asin).run();
      return new Response(JSON.stringify({ status: 'updated', asin, name }), { status: 200, headers });
    } catch(e) { return new Response(JSON.stringify({ error: e.message }), { status: 400, headers }); }
  }

  // DELETE
  if (request.method === 'DELETE') {
    const asin = url.searchParams.get('asin');
    const date = url.searchParams.get('date');
    const keyword = url.searchParams.get('keyword');

    // Delete by keyword (across all dates)
    if (asin && keyword) {
      const result = await db.prepare('DELETE FROM rankings WHERE asin = ? AND keyword = ?').bind(asin, keyword).run();
      return new Response(JSON.stringify({ status: 'deleted', asin, keyword, changes: result.changes || 0 }), { status: 200, headers });
    }

    // Delete by date
    if (asin && date) {
      const result = await db.prepare('DELETE FROM rankings WHERE asin = ? AND date = ?').bind(asin, date).run();
      return new Response(JSON.stringify({ status: 'deleted', asin, date, changes: result.changes || 0 }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: 'Missing parameters' }), { status: 400, headers });
  }

  // GET
  if (request.method === 'GET') {
    const asin = url.searchParams.get('asin');
    let products = asin 
      ? await db.prepare('SELECT * FROM products WHERE asin = ?').bind(asin).all()
      : await db.prepare('SELECT * FROM products ORDER BY asin').all();
    let rankings = asin
      ? await db.prepare('SELECT * FROM rankings WHERE asin = ? ORDER BY date DESC, keyword ASC').bind(asin).all()
      : await db.prepare('SELECT * FROM rankings ORDER BY asin, date DESC, keyword ASC').all();

    const grouped = {};
    for (const p of products.results) grouped[p.asin] = { name: p.name, dates: {} };
    for (const r of rankings.results) {
      if (!grouped[r.asin]) grouped[r.asin] = { name: r.asin, dates: {} };
      if (!grouped[r.asin].dates[r.date]) grouped[r.asin].dates[r.date] = { rating: r.rating, reviewCount: r.review_count, rank: r.rank, keywords: {} };
      grouped[r.asin].dates[r.date].keywords[r.keyword] = { naturalPos: r.natural_pos, adPos: r.ad_pos };
    }
    return new Response(JSON.stringify(grouped), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}
