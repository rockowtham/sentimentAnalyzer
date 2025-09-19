const listEl = document.getElementById('list');
const errorEl = document.getElementById('error');
const refreshBtn = document.getElementById('refreshBtn');
const openOptions = document.getElementById('openOptions');
const lastUpdatedEl = document.getElementById('lastUpdated');
const sentimentBtn = document.getElementById('sentimentBtn');
const reorderBtn = document.getElementById('reorderBtn');

// Keep last results to drive sentiment
let lastRows = [];
let isReorderMode = false;
let draggedElement = null;

openOptions.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

function formatDateTime(dateString) {
  if (!dateString) return '—';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('en-IN', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return dateString;
  }
}

function formatPrice(price) {
  if (price == null) return '—';
  return `₹${Number(price).toLocaleString('en-IN', { 
    minimumFractionDigits: 2, 
    maximumFractionDigits: 2 
  })}`;
}

function getSymbolFromInstrumentKey(instrumentKey) {
  console.log('Processing instrument key:', instrumentKey);
  
  // Handle different formats: "NSE_EQ|INE002A01018" or "NSE_EQ:LT" or just "LT"
  let symbol = instrumentKey;
  
  // If it contains a separator, extract the symbol part
  if (instrumentKey.includes('|')) {
    const parts = instrumentKey.split('|');
    if (parts.length === 2) {
      // Map numeric instrument keys to symbols
      const symbolMap = {
        'INE002A01018': 'RELIANCE',
        'INE467B01029': 'TCS', 
        'INE040A01034': 'HDFCBANK',
        'INE009A01021': 'INFY',
        'INE030A01027': 'HINDUNILVR',
        'INE090A01021': 'ICICIBANK',
        'INE237A01028': 'KOTAKBANK',
        'INE062A01020': 'SBIN',
        'INE296A01024': 'BAJFINANCE',
        'INE018A01030': 'LT'
      };
      symbol = symbolMap[parts[1]] || parts[1];
    }
  } else if (instrumentKey.includes(':')) {
    // Handle format like "NSE_EQ:LT"
    const parts = instrumentKey.split(':');
    symbol = parts[parts.length - 1]; // Take the last part
  } else if (instrumentKey.includes('_')) {
    // Handle format like "NSE_EQ_LT"
    const parts = instrumentKey.split('_');
    symbol = parts[parts.length - 1]; // Take the last part
  }
  
  console.log('Extracted symbol:', symbol);
  return symbol;
}

function render(rows) {
  lastRows = rows || [];
  listEl.innerHTML = '';
  if (!rows || rows.length === 0) {
    const div = document.createElement('div');
    div.className = 'no-data';
    div.innerHTML = '📊 No data received<br><small>Check your configuration in Options</small>';
    listEl.appendChild(div);
    return;
  }
  
  for (const row of rows) {
    const li = document.createElement('li');
    li.className = 'stock-item';
    li.draggable = isReorderMode;
    li.dataset.instrumentKey = row.instrumentKey;
    
    const symbol = document.createElement('div');
    symbol.className = 'stock-symbol';
    const sym = getSymbolFromInstrumentKey(row.instrumentKey);
    symbol.textContent = sym;
    
    const info = document.createElement('div');
    info.className = 'stock-info';
    
    const price = document.createElement('div');
    price.className = 'stock-price';
    price.textContent = formatPrice(row.close);
    
    const date = document.createElement('div');
    date.className = 'stock-date';
    date.textContent = formatDateTime(row.date || row.timestamp);

    const badge = document.createElement('div');
    badge.className = 'sentiment-badge sentiment-neu';
    badge.dataset.symbol = sym;
    badge.textContent = 'Hold';
    
    info.appendChild(price);
    info.appendChild(date);
    info.appendChild(badge);
    
    li.appendChild(symbol);
    li.appendChild(info);
    listEl.appendChild(li);
  }
  
  // Add drag event listeners if in reorder mode
  if (isReorderMode) {
    addDragListeners();
  }
}

function applySentimentToUI(items) {
  const bySymbol = new Map();
  for (const it of items) bySymbol.set((it.symbol || '').toUpperCase(), it);
  const badges = listEl.querySelectorAll('.sentiment-badge');
  badges.forEach(badge => {
    const sym = (badge.dataset.symbol || '').toUpperCase();
    const it = bySymbol.get(sym);
    if (!it) return;
    badge.classList.remove('sentiment-pos', 'sentiment-neu', 'sentiment-neg');
    let cls = 'sentiment-neu';
    if (/buy/i.test(it.action)) cls = 'sentiment-pos';
    else if (/sell/i.test(it.action)) cls = 'sentiment-neg';
    badge.classList.add(cls);
    const conf = typeof it.confidence === 'number' ? ` ${(it.confidence * 100).toFixed(0)}%` : '';
    badge.textContent = `${it.action}${conf}`;
    badge.title = it.rationale || '';
  });
}

async function runSentiment() {
  try {
    errorEl.hidden = true;
    if (sentimentBtn) {
      sentimentBtn.disabled = true;
      sentimentBtn.textContent = '🧠 Analyzing…';
    }
    const symbols = lastRows.map(r => getSymbolFromInstrumentKey(r.instrumentKey)).filter(Boolean);
    if (!symbols.length) throw new Error('No symbols available for sentiment.');
    const resp = await chrome.runtime.sendMessage({ type: 'ANALYZE_SENTIMENT', symbols });
    if (!resp || !resp.ok) throw new Error(resp && resp.error ? resp.error : 'Gemini call failed');
    applySentimentToUI(resp.data || []);
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.hidden = false;
  } finally {
    if (sentimentBtn) {
      sentimentBtn.disabled = false;
      sentimentBtn.textContent = '🧠 Analyze Sentiment';
    }
  }
}

async function refresh() {
  errorEl.hidden = true;
  listEl.innerHTML = '';
  
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'FETCH_CLOSES' });
    console.log('Popup received response:', resp);
    
    if (!resp || !resp.ok) {
      throw new Error(resp && resp.error ? resp.error : 'Unknown error');
    }
    
    console.log('Data to render:', resp.data);
    render(resp.data || []);
    
    const count = resp.data ? resp.data.length : 0;
    const timestamp = new Date().toLocaleTimeString('en-IN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    if (count > 0) {
      lastUpdatedEl.textContent = `Last updated: ${timestamp}`;
    } else {
      lastUpdatedEl.textContent = `Last attempt: ${timestamp}`;
    }
    
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.hidden = false;
  }
}

function toggleReorderMode() {
  isReorderMode = !isReorderMode;
  reorderBtn.classList.toggle('active', isReorderMode);
  reorderBtn.textContent = isReorderMode ? '✅ Done' : '📋 Reorder';
  
  // Update all stock items
  const items = listEl.querySelectorAll('.stock-item');
  items.forEach(item => {
    item.draggable = isReorderMode;
  });
  
  if (isReorderMode) {
    addDragListeners();
  } else {
    removeDragListeners();
  }
}

function addDragListeners() {
  const items = listEl.querySelectorAll('.stock-item');
  items.forEach(item => {
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragend', handleDragEnd);
  });
}

function removeDragListeners() {
  const items = listEl.querySelectorAll('.stock-item');
  items.forEach(item => {
    item.removeEventListener('dragstart', handleDragStart);
    item.removeEventListener('dragover', handleDragOver);
    item.removeEventListener('drop', handleDrop);
    item.removeEventListener('dragend', handleDragEnd);
  });
}

function handleDragStart(e) {
  draggedElement = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.target.outerHTML);
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const afterElement = getDragAfterElement(listEl, e.clientY);
  const dragging = document.querySelector('.dragging');
  
  if (afterElement == null) {
    listEl.appendChild(dragging);
  } else {
    listEl.insertBefore(dragging, afterElement);
  }
}

function handleDrop(e) {
  e.preventDefault();
  return false;
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedElement = null;
  
  // Update the order in lastRows based on new DOM order
  updateRowOrder();
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.stock-item:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateRowOrder() {
  const items = listEl.querySelectorAll('.stock-item');
  const newOrder = [];
  
  items.forEach(item => {
    const instrumentKey = item.dataset.instrumentKey;
    const originalRow = lastRows.find(row => row.instrumentKey === instrumentKey);
    if (originalRow) {
      newOrder.push(originalRow);
    }
  });
  
  lastRows = newOrder;
  console.log('Stock order updated:', newOrder.map(r => getSymbolFromInstrumentKey(r.instrumentKey)));
}

refreshBtn.addEventListener('click', refresh);
sentimentBtn?.addEventListener('click', runSentiment);
reorderBtn?.addEventListener('click', toggleReorderMode);

// Auto-load when popup opens
refresh();


