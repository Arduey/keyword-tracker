// POST /api/import — Import JSON data with conflict detection
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await request.json();
    const conflicts = [];
    
    // Step 1: Check for conflicts (per product + per date)
    for (const [asin, productData] of Object.entries(body)) {
      const productName = productData.name || asin;
      
      for (const [date, dateData] of Object.entries(productData)) {
        if (date === 'name') continue;
        
        // Check if any data exists for this ASIN + date
        const existing = await db.prepare(
          'SELECT COUNT(*) as cnt FROM rankings WHERE asin = ? AND date = ?'
        ).bind(asin, date).first();
        
        if (existing && existing.cnt > 0) {
          conflicts.push({ asin, name: productName, date, count: existing.cnt });
        }
      }
    }
    
    // Check if force=true to skip conflict prompt
    const force = request.url.includes('force=true');
    
    // If conflicts found and not forcing, return them for user confirmation
    if (conflicts.length > 0 && !force) {
      return new Response(JSON.stringify({ 
        status: 'conflict',
        conflicts,
        message: `发现 ${conflicts.length} 个产品/日期已有数据，是否覆盖？`
      }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Step 3: Import data
    const result = await importData(db, body, conflicts.length > 0);
    
    return new Response(JSON.stringify(result), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function importData(db, body, overwrite) {
  let totalProducts = 0;
  let totalRankings = 0;
  
  // Use batch for performance
  const statements = [];
  
  for (const [asin, productData] of Object.entries(body)) {
    const productName = productData.name || asin;
    
    // Upsert product
    statements.push(db.prepare(
      'INSERT OR REPLACE INTO products (asin, name) VALUES (?, ?)'
    ).bind(asin, productName));
    totalProducts++;
    
    for (const [date, dateData] of Object.entries(productData)) {
      if (date === 'name') continue;
      
      const rating = dateData['评分'] !== undefined ? dateData['评分'] : (dateData['\u8BC4\u5206'] !== undefined ? dateData['\u8BC4\u5206'] : 0);
      const reviewCount = dateData['评论数'] !== undefined ? dateData['评论数'] : (dateData['\u8BC4\u8BBA\u6570'] !== undefined ? dateData['\u8BC4\u8BBA\u6570'] : 0);
      const rank = dateData.rank || '';
      
      // If overwriting, delete existing data first
      if (overwrite) {
        statements.push(db.prepare(
          'DELETE FROM rankings WHERE asin = ? AND date = ?'
        ).bind(asin, date));
      }
      
      // Process each keyword
      for (const [key, value] of Object.entries(dateData)) {
        if (key === '评分' || key === '\u8BC4\u5206' || 
            key === '评论数' || key === '\u8BC4\u8BBA\u6570' || 
            key === 'rank') continue;
        
        let naturalPos = '';
        let adPos = '';
        
        if (typeof value === 'object') {
          naturalPos = value['自然位含广告'] || value['\u81EA\u7136\u4F4D\u542B\u5E7F\u544A'] || '';
          adPos = value['广告位含自然'] || value['\u5E7F\u544A\u4F4D\u542B\u81EA\u7136'] || '';
        }
        
        // Rule: if contains "无排名", store as empty string
        if (naturalPos && naturalPos.includes('\u65E0\u6392\u540D')) {
          naturalPos = '';
        }
        if (adPos && adPos.includes('\u65E0\u6392\u540D')) {
          adPos = '';
        }
        
        statements.push(db.prepare(
          `INSERT OR REPLACE INTO rankings (asin, date, rating, review_count, rank, keyword, natural_pos, ad_pos) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(asin, date, rating, reviewCount, rank, key, naturalPos, adPos));
        totalRankings++;
      }
    }
  }
  
  // Execute all statements
  await db.batch(statements);
  
  return {
    status: 'success',
    products: totalProducts,
    rankings: totalRankings,
    overwrite
  };
}
