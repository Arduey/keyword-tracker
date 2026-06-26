// GET /api/export — Excel XML Spreadsheet (native multi-sheet)
export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const asinFilter = url.searchParams.get('asin') || '';

  let products, rankings;
  if (asinFilter) {
    products = await db.prepare('SELECT * FROM products WHERE asin = ?').bind(asinFilter).all();
    rankings = await db.prepare('SELECT * FROM rankings WHERE asin = ? ORDER BY date, keyword').bind(asinFilter).all();
  } else {
    products = await db.prepare('SELECT * FROM products ORDER BY asin').all();
    rankings = await db.prepare('SELECT * FROM rankings ORDER BY asin, date, keyword').all();
  }

  const data = {};
  for (const p of products.results) data[p.asin] = { name: p.name, dates: {} };
  for (const r of rankings.results) {
    if (!data[r.asin]) continue;
    if (!data[r.asin].dates[r.date]) {
      data[r.asin].dates[r.date] = { rating: r.rating, reviewCount: r.review_count, rank: r.rank, keywords: {} };
    }
    data[r.asin].dates[r.date].keywords[r.keyword] = { n: r.natural_pos, a: r.ad_pos };
  }

  const orderParam = url.searchParams.get('order') || '{}';
  let kwOrder = {};
  try { kwOrder = JSON.parse(orderParam); } catch(e) {}

  const xml = generateXmlSpreadsheet(data, kwOrder);
  
  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.ms-excel; charset=UTF-8',
      'Content-Disposition': 'attachment; filename="keyword-rankings.xls"'
    }
  });
}

function dateToSerial(iso) {
  const d = new Date(iso + 'T00:00:00');
  const base = new Date('1899-12-30T00:00:00');
  return Math.round((d - base) / (1000 * 60 * 60 * 24));
}

function generateXmlSpreadsheet(data, kwOrder) {
  const asins = Object.keys(data).sort();
  const allDates = new Set();
  for (const asin of asins) {
    for (const d of Object.keys(data[asin].dates)) allDates.add(d);
  }
  const sortedDates = [...allDates].sort();
  const extraCols = 5;
  const totalCols = 1 + sortedDates.length + extraCols;

  let sheets = '';
  
  for (const asin of asins) {
    const product = data[asin];
    const safeName = (product.name || asin).replace(/[\\\/\*\?\[\]:]/g, '-').substring(0, 31);
    // Per-product keywords with custom order
    const pKwSet = new Set();
    for (const dd of Object.values(product.dates)) for (const kw of Object.keys(dd.keywords)) pKwSet.add(kw);
    const order = kwOrder[asin] || kwOrder || {};
    const orderedN = [], orderedA = [], remaining = new Set(pKwSet);
    for (const kw of (order.natural || [])) { if (remaining.has(kw)) { orderedN.push(kw); remaining.delete(kw); } }
    for (const kw of (order.ad || [])) { if (remaining.has(kw)) { orderedA.push(kw); remaining.delete(kw); } }
    // Note: orderedN and orderedA may share keywords; remaining only has unsorted ones
    // For simplicity, use the union for both sections:
    const fullOrdered = [...orderedN, ...orderedA, ...[...remaining].sort()];
    const pKwList = [...new Set(fullOrdered)];
    
    sheets += `<Worksheet ss:Name="${xmlEsc(safeName)}">
<Table>
${colDefs(totalCols)}
${headerRow(sortedDates, xmlEsc(product.name), extraCols)}
${rankRow(sortedDates, product, xmlEsc(asin), extraCols)}
${ratingRow(sortedDates, product, extraCols)}
${sectionRow('自然位-精准词', totalCols)}
${kwRows(pKwList, sortedDates, product, 'n', extraCols)}
${emptyRow(totalCols)}
${sectionRow('广告位-精准词', totalCols)}
${kwRows(pKwList, sortedDates, product, 'a', extraCols)}
</Table>
<WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
<FreezePanes/><FrozenNoSplit/>
<SplitHorizontal>3</SplitHorizontal><TopRowBottomPane>3</TopRowBottomPane>
<SplitVertical>1</SplitVertical><LeftColumnRightPane>1</LeftColumnRightPane>
</WorksheetOptions>
</Worksheet>
`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:x="urn:schemas-microsoft-com:office:excel">
<Styles>
<Style ss:ID="date"><Font ss:FontName="等线" ss:Size="11"/><NumberFormat ss:Format="M\月d\日"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="center"><Font ss:FontName="等线" ss:Size="11"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
<Style ss:ID="left"><Font ss:FontName="等线" ss:Size="11"/><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="rank"><Font ss:FontName="等线" ss:Size="10"/><Alignment ss:Horizontal="Left" ss:Vertical="Center" ss:WrapText="1"/></Style>
<Style ss:ID="section"><Font ss:FontName="等线" ss:Size="11" ss:Color="#FFFFFF" ss:Bold="1"/><Alignment ss:Horizontal="Left" ss:Vertical="Center"/><Interior ss:Color="#5B9BD5" ss:Pattern="Solid"/></Style>
</Styles>
${sheets}
</Workbook>`;
}

function colDefs(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += '<Column ss:Width="120"/>\n';
  return s;
}

function headerRow(dates, name, extra) {
  let s = '<Row ss:Height="20">';
  s += `<Cell ss:StyleID="center"><Data ss:Type="String">${xmlEsc(name)}</Data></Cell>`;
  for (const d of dates) {
    s += `<Cell ss:StyleID="date"><Data ss:Type="Number">${dateToSerial(d)}</Data></Cell>`;
  }
  for (let i = 0; i < extra; i++) s += '<Cell ss:StyleID="center"></Cell>';
  s += '</Row>\n';
  return s;
}

function rankRow(dates, product, asin, extra) {
  let s = '<Row ss:Height="29">';
  s += `<Cell ss:StyleID="left"><Data ss:Type="String">${xmlEsc(asin)}</Data></Cell>`;
  for (const d of dates) {
    const dd = product.dates[d];
    let rank = dd ? (dd.rank || '') : '';
    rank = xmlEsc(rank).replace(/(.)\s*#(\d)/g, '$1&#10;#$2').replace(/^&#10;/, '');
    s += `<Cell ss:StyleID="rank"><Data ss:Type="String">${rank}</Data></Cell>`;
  }
  for (let i = 0; i < extra; i++) s += '<Cell ss:StyleID="left"></Cell>';
  s += '</Row>\n';
  return s;
}

function ratingRow(dates, product, extra) {
  let s = '<Row ss:Height="20">';
  s += '<Cell ss:StyleID="center"></Cell>';
  for (const d of dates) {
    const dd = product.dates[d];
    s += `<Cell ss:StyleID="center"><Data ss:Type="String">${dd ? dd.rating + ' - ' + dd.reviewCount : ''}</Data></Cell>`;
  }
  for (let i = 0; i < extra; i++) s += '<Cell ss:StyleID="center"></Cell>';
  s += '</Row>\n';
  return s;
}

function sectionRow(title, cols) {
  let s = '<Row ss:Height="20">';
  s += `<Cell ss:StyleID="section"><Data ss:Type="String">${xmlEsc(title)}</Data></Cell>`;
  for (let i = 1; i < cols; i++) s += '<Cell ss:StyleID="section"></Cell>';
  s += '</Row>\n';
  return s;
}

function kwRows(kwList, dates, product, type, extra) {
  let s = '';
  for (const kw of kwList) {
    s += '<Row ss:Height="20">';
    s += `<Cell ss:StyleID="left"><Data ss:Type="String">${xmlEsc(kw)}</Data></Cell>`;
    for (const d of dates) {
      const dd = product.dates[d];
      const pos = (dd && dd.keywords[kw]) ? dd.keywords[kw][type] : '';
      s += `<Cell ss:StyleID="center"><Data ss:Type="String">${xmlEsc(pos)}</Data></Cell>`;
    }
    for (let i = 0; i < extra; i++) s += '<Cell ss:StyleID="center"></Cell>';
    s += '</Row>\n';
  }
  return s;
}

function emptyRow(cols) {
  let s = '<Row ss:Height="16">';
  for (let i = 0; i < cols; i++) s += '<Cell></Cell>';
  s += '</Row>\n';
  return s;
}

function xmlEsc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
