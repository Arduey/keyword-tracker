// keyword-tracker frontend app

let pendingData = null;
let allData = {};
let activeTab = null;
let authToken = localStorage.getItem('kw_auth') || '';
// Keyword order per ASIN: { asin: { natural: [kw1, kw2, ...], ad: [kw1, kw2, ...] } }
let kwOrder = JSON.parse(localStorage.getItem('kw_order') || '{}');

function saveKwOrder() { localStorage.setItem('kw_order', JSON.stringify(kwOrder)); }

// ========== Auth ==========
async function checkAuth() {
  if (authToken) {
    try { const resp = await fetch('/api/data', { headers: { 'X-Auth': authToken } }); if (resp.ok) { showMain(); return; } } catch(e) {}
  }
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('mainApp').style.display = 'none';
}
async function verifyPassword() {
  const pwd = document.getElementById('passwordInput').value.trim();
  if (!pwd) return;
  try {
    const resp = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pwd }) });
    const data = await resp.json();
    if (data.ok) { authToken = data.token; if (document.getElementById('rememberPwd').checked) localStorage.setItem('kw_auth', authToken); showMain(); document.getElementById('loginError').style.display = 'none'; }
    else document.getElementById('loginError').style.display = 'block';
  } catch(e) { document.getElementById('loginError').style.display = 'block'; }
}
function showMain() { document.getElementById('loginOverlay').style.display = 'none'; document.getElementById('mainApp').style.display = 'block'; refreshData(); }

// ========== Data Loading ==========
async function refreshData() {
  try {
    const resp = await fetch('/api/data', { headers: { 'X-Auth': authToken } });
    if (!resp.ok) { authToken = ''; localStorage.removeItem('kw_auth'); checkAuth(); return; }
    allData = await resp.json();
    renderTabs(); renderPreview();
    document.getElementById('statusBar').textContent = `共 ${Object.keys(allData).length} 个产品，最后更新: ${new Date().toLocaleString()}`;
  } catch (err) { document.getElementById('statusBar').textContent = '加载失败: ' + err.message; }
}

// ========== Import (always force overwrite) ==========
async function importData() {
  const input = document.getElementById('jsonInput').value.trim();
  if (!input) return alert('请粘贴 JSON 数据');
  let data;
  try { data = JSON.parse(input); } catch (e) {
    document.getElementById('importStatus').innerHTML = '<div class="alert alert-error">JSON 解析失败: ' + e.message + '</div>'; return;
  }
  const btn = document.querySelector('.btn-primary');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 提交中...';
  document.getElementById('importStatus').innerHTML = '';
  try {
    const resp = await fetch('/api/import?force=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await resp.json();
    if (result.status === 'success') {
      document.getElementById('importStatus').innerHTML = '<div class="alert alert-success">✅ 导入成功！' + result.products + ' 个产品，' + result.rankings + ' 条排名记录</div>';
      document.getElementById('jsonInput').value = ''; refreshData();
    } else throw new Error(result.error || 'Unknown error');
  } catch (err) { document.getElementById('importStatus').innerHTML = '<div class="alert alert-error">❌ 导入失败: ' + err.message + '</div>'; }
  btn.disabled = false; btn.innerHTML = '📤 提交数据';
}

// ========== Export ==========
function exportUrl(asin) { return asin ? '/api/export?asin=' + encodeURIComponent(asin) + '&order=' + encodeURIComponent(JSON.stringify(kwOrder[asin] || {})) : '/api/export?order=' + encodeURIComponent(JSON.stringify(kwOrder)); }
async function exportExcel() {
  try { const r = await fetch(exportUrl('')); if(!r.ok) throw new Error('fail'); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = '\u5173\u952E\u8BCD\u8BB0\u5F55.xls'; a.click(); URL.revokeObjectURL(a.href); } catch(e) { alert('导出失败: ' + e.message); }
}
async function exportSingle(asin) {
  try { const r = await fetch(exportUrl(asin)); if(!r.ok) throw new Error('fail'); const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = '\u5173\u952E\u8BCD\u8BB0\u5F55.xls'; a.click(); URL.revokeObjectURL(a.href); } catch(e) { alert('导出失败: ' + e.message); }
}

// ========== Multi-Delete ==========
let deleteDates = new Set();

function showDeleteModal(asin) {
  deleteDates = new Set();
  const product = allData[asin];
  if (!product) return;
  const dbDates = new Set(Object.keys(product.dates));
  const datesArr = [...dbDates].sort();
  let minD = datesArr[0] || '2025-11-01', maxD = datesArr[datesArr.length - 1] || '2026-06-30';
  
  document.getElementById('deleteMsg').innerHTML = `产品: <b>${product.name}</b> (${asin})<br><span style="font-size:12px;color:#666;">点击日期多选，蓝色=有数据 红色=已选</span>`;
  
  let html = '<div style="display:flex;flex-wrap:wrap;gap:16px;">';
  const s = new Date(minD), e = new Date(maxD); s.setDate(1); e.setMonth(e.getMonth() + 1, 0);
  let c = new Date(s);
  while (c <= e) { html += buildMonthCal(c.getFullYear(), c.getMonth(), dbDates); c.setMonth(c.getMonth() + 1); }
  html += '</div><p id="deleteInfo" style="margin-top:8px;font-size:12px;color:#666;">已选: <b>0</b> 个日期</p>';
  
  document.getElementById('deleteDateContainer').innerHTML = html;
  document.getElementById('deleteConfirmBtn').onclick = confirmDelete;
  document.getElementById('deleteConfirmBtn').disabled = true;
  document.getElementById('deleteModal').classList.add('show');
  // Store asin for delete
  document.getElementById('deleteModal').dataset.asin = asin;
}

function buildMonthCal(year, month, dbDates) {
  const mNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const fd = new Date(year, month, 1).getDay(), dim = new Date(year, month + 1, 0).getDate();
  let h = `<div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:8px;min-width:200px;">`;
  h += `<div style="text-align:center;font-weight:600;font-size:13px;margin-bottom:4px;">${year}年 ${mNames[month]}</div>`;
  h += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;font-size:10px;color:#999;">日 一 二 三 四 五 六`;
  for (let i = 0; i < fd; i++) h += `<span></span>`;
  for (let d = 1; d <= dim; d++) {
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const has = dbDates.has(ds), sel = deleteDates.has(ds);
    let st = 'background:#f0f0f0;color:#ccc;border-radius:4px;padding:2px;font-size:11px;cursor:default;';
    if (sel) st = 'background:#d93025;color:#fff;border-radius:4px;cursor:pointer;padding:2px;font-size:11px;';
    else if (has) st = 'background:#1a73e8;color:#fff;border-radius:4px;cursor:pointer;padding:2px;font-size:11px;';
    const oc = has ? `onclick="toggleDelDate('${ds}')"` : '';
    h += `<span style="${st}" ${oc}>${d}</span>`;
  }
  return h + `</div></div>`;
}

function toggleDelDate(ds) {
  if (deleteDates.has(ds)) deleteDates.delete(ds); else deleteDates.add(ds);
  document.getElementById('deleteInfo').innerHTML = '已选: <b>' + deleteDates.size + '</b> 个日期';
  document.getElementById('deleteConfirmBtn').disabled = deleteDates.size === 0;
  // Refresh calendar colors
  const asin = document.getElementById('deleteModal').dataset.asin;
  showDeleteModal(asin);
}

function closeDeleteModal() { document.getElementById('deleteModal').classList.remove('show'); deleteDates = new Set(); }

async function confirmDelete() {
  const asin = document.getElementById('deleteModal').dataset.asin;
  if (!asin || deleteDates.size === 0) return;
  let success = 0;
  for (const ds of deleteDates) {
    try {
      const r = await fetch(`/api/data?asin=${encodeURIComponent(asin)}&date=${encodeURIComponent(ds)}`, { method: 'DELETE' });
      if (r.ok) success++;
    } catch(e) {}
  }
  alert(`✅ 已删除 ${success}/${deleteDates.size} 个日期数据`);
  closeDeleteModal();
  refreshData();
}

// ========== Drag to reorder ==========
let dragSrcRow = null, dragSection = '';

function getKwOrder(asin) {
  if (!kwOrder[asin]) kwOrder[asin] = { natural: [], ad: [] };
  return kwOrder[asin];
}

function applyOrder(asin, kwList) {
  const order = getKwOrder(asin);
  // Build ordered list: first from saved order, then append new unknown keywords
  const resultNatural = [];
  const resultAd = [];
  const remainingN = new Set(kwList), remainingA = new Set(kwList);
  
  for (const kw of order.natural) { if (remainingN.has(kw)) { resultNatural.push(kw); remainingN.delete(kw); } }
  for (const kw of remainingN) resultNatural.push(kw);
  for (const kw of order.ad) { if (remainingA.has(kw)) { resultAd.push(kw); remainingA.delete(kw); } }
  for (const kw of remainingA) resultAd.push(kw);
  
  order.natural = resultNatural;
  order.ad = resultAd;
  saveKwOrder();
  return { natural: resultNatural, ad: resultAd };
}

function renderPreview() {
  const container = document.getElementById('previewTable');
  const asin = activeTab;
  if (!asin || !allData[asin]) { container.innerHTML = '<p style="color:#999;padding:20px;">请先导入数据</p>'; return; }
  
  const product = allData[asin];
  const dates = Object.keys(product.dates).sort();
  const kwSet = new Set();
  for (const dd of Object.values(product.dates)) for (const kw of Object.keys(dd.keywords)) kwSet.add(kw);
  const orderedKws = applyOrder(asin, [...kwSet]);
  
  if (dates.length === 0) { container.innerHTML = '<p style="color:#999;padding:20px;">该产品暂无数据</p>'; return; }
  
  let html = '<table class="preview"><thead>';
  html += '<tr class="row-normal"><td class="td-date" style="font-weight:bold;">' + product.name + '<br><small>' + asin + '</small></td>';
  for (const d of dates) html += '<td class="td-date">' + formatDateChinese(d) + '</td>';
  html += '</tr>';
  html += '<tr class="row-rank"><td class="td-rank" style="font-weight:bold;">Rank</td>';
  for (const d of dates) { const dd = product.dates[d]; html += '<td class="td-rank">' + (dd ? (dd.rank || '').replace(/(.)#(\d)/g, '$1<br>#$2') : '') + '</td>'; }
  html += '</tr>';
  html += '<tr class="row-normal"><td class="td-center">评分 / 评论</td>';
  for (const d of dates) { const dd = product.dates[d]; html += '<td class="td-center">' + (dd ? dd.rating + ' / ' + dd.reviewCount : '') + '</td>'; }
  html += '</tr>';
  
  // Natural section
  html += '<tr class="row-normal"><td class="td-section" colspan="' + (dates.length + 1) + '" style="background:#5B9BD5;color:#fff;">自然位-精准词</td></tr>';
  for (const kw of orderedKws.natural) {
    html += '<tr class="row-normal kw-drag" draggable="true" data-section="natural" data-kw="' + kw.replace(/"/g,'&quot;') + '" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondrop="dropKw(event)">';
    html += '<td style="text-align:left;cursor:grab;">⋮⋮ ' + kw + '</td>';
    for (const d of dates) { const dd = product.dates[d]; html += '<td class="td-center">' + ((dd && dd.keywords[kw]) ? dd.keywords[kw].naturalPos : '') + '</td>'; }
    html += '</tr>';
  }
  html += '<tr class="row-normal"><td colspan="' + (dates.length + 1) + '" style="background:#f0f0f0;"></td></tr>';
  
  // Ad section
  html += '<tr class="row-normal"><td class="td-section" colspan="' + (dates.length + 1) + '" style="background:#5B9BD5;color:#fff;">广告位-精准词</td></tr>';
  for (const kw of orderedKws.ad) {
    html += '<tr class="row-normal kw-drag" draggable="true" data-section="ad" data-kw="' + kw.replace(/"/g,'&quot;') + '" ondragstart="dragStart(event)" ondragover="dragOver(event)" ondrop="dropKw(event)">';
    html += '<td style="text-align:left;cursor:grab;">⋮⋮ ' + kw + '</td>';
    for (const d of dates) { const dd = product.dates[d]; html += '<td class="td-center">' + ((dd && dd.keywords[kw]) ? dd.keywords[kw].adPos : '') + '</td>'; }
    html += '</tr>';
  }
  html += '</table>';
  
  html += '<div class="row" style="margin-top:8px;">';
  html += '<button class="btn btn-danger btn-sm" onclick="showDeleteModal(\'' + asin + '\')">🗑 多选删除</button>';
  html += '<span style="flex:1;"></span>';
  html += '<button class="btn btn-outline btn-sm" onclick="exportSingle(\'' + asin + '\')">📥 导出此产品</button>';
  html += '</div>';
  container.innerHTML = html;
}

function dragStart(e) {
  dragSrcRow = e.target.closest('.kw-drag');
  if (!dragSrcRow) return;
  dragSection = dragSrcRow.dataset.section;
  e.dataTransfer.effectAllowed = 'move';
}

function dragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }

function dropKw(e) {
  e.preventDefault();
  const target = e.target.closest('.kw-drag');
  if (!target || !dragSrcRow || target === dragSrcRow) return;
  if (target.dataset.section !== dragSection) return; // Only same section
  
  const asin = activeTab;
  const order = getKwOrder(asin);
  const list = dragSection === 'natural' ? order.natural : order.ad;
  const srcKw = dragSrcRow.dataset.kw, tgtKw = target.dataset.kw;
  const srcIdx = list.indexOf(srcKw), tgtIdx = list.indexOf(tgtKw);
  if (srcIdx >= 0 && tgtIdx >= 0) {
    list.splice(srcIdx, 1);
    list.splice(tgtIdx, 0, srcKw);
    saveKwOrder();
    renderPreview();
  }
}

function renderTabs() {
  const tabs = document.getElementById('productTabs');
  const asins = Object.keys(allData).sort();
  if (asins.length === 0) { tabs.innerHTML = '<span style="color:#999;padding:8px;">暂无数据</span>'; return; }
  tabs.innerHTML = asins.map(a => `<div class="tab${a===activeTab?' active':''}" onclick="selectTab('${a}')">${allData[a].name||a}<br><small>${a}</small></div>`).join('');
  if (!activeTab || !asins.includes(activeTab)) { activeTab = asins[0]; tabs.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',asins[i]===activeTab)); }
}

function selectTab(asin) { activeTab = asin; renderTabs(); renderPreview(); }

function formatDateChinese(iso) {
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  return parseInt(p[1]) + '月' + parseInt(p[2]) + '日';
}

checkAuth();
