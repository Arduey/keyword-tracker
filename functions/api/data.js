// GET /api/data — Query all data or filter by asin
// DELETE /api/data?asin=XXX&date=YYYY-MM-DD — Delete specific data
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);

  // CORS headers
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  // DELETE — Remove data for a specific product+date
  if (request.method === 'DELETE') {
    const asin = url.searchParams.get('asin');
    const date = url.searchParams.get('date');

    if (!asin || !date) {
      return new Response(JSON.stringify({ error: 'Missing asin or date parameter' }), {
        status: 400, headers
      });
    }

    const result = await db.prepare(
      'DELETE FROM rankings WHERE asin = ? AND date = ?'
    ).bind(asin, date).run();

    return new Response(JSON.stringify({ 
      status: 'deleted',
      asin,
      date,
      changes: result.changes || 0
    }), { status: 200, headers });
  }

  // GET — Query data
  if (request.method === 'GET') {
    const asin = url.searchParams.get('asin');
    
    let products;
    if (asin) {
      products = await db.prepare(
        'SELECT * FROM products WHERE asin = ?'
      ).bind(asin).all();
    } else {
      products = await db.prepare(
        'SELECT * FROM products ORDER BY asin'
      ).all();
    }

    // Get all rankings
    let rankings;
    if (asin) {
      rankings = await db.prepare(
        'SELECT * FROM rankings WHERE asin = ? ORDER BY date DESC, keyword ASC'
      ).bind(asin).all();
    } else {
      rankings = await db.prepare(
        'SELECT * FROM rankings ORDER BY asin, date DESC, keyword ASC'
      ).all();
    }

    // Group by ASIN -> date -> keyword
    const grouped = {};
    for (const p of products.results) {
      grouped[p.asin] = { name: p.name, dates: {} };
    }
    for (const r of rankings.results) {
      if (!grouped[r.asin]) {
        const prod = products.results.find(p => p.asin === r.asin);
        grouped[r.asin] = { name: prod ? prod.name : r.asin, dates: {} };
      }
      if (!grouped[r.asin].dates[r.date]) {
        grouped[r.asin].dates[r.date] = {
          rating: r.rating,
          reviewCount: r.review_count,
          rank: r.rank,
          keywords: {}
        };
      }
      grouped[r.asin].dates[r.date].keywords[r.keyword] = {
        naturalPos: r.natural_pos,
        adPos: r.ad_pos
      };
    }

    return new Response(JSON.stringify(grouped), { status: 200, headers });
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers
  });
}
