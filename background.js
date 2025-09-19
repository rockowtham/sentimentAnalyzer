// Minimal service worker to fetch OHLC/close from Upstox

const STORAGE_KEYS = {
  accessToken: 'upstoxAccessToken',
  instrumentKeys: 'instrumentKeys',
  geminiApiKey: 'geminiApiKey'
};

async function getFromStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (items) => resolve(items));
  });
}

async function fetchOhlcForInstruments(instrumentKeys) {
  const { upstoxAccessToken } = await getFromStorage([STORAGE_KEYS.accessToken]);
  const accessToken = upstoxAccessToken;
  if (!accessToken) {
    throw new Error('Missing Upstox access token. Set it in the extension Options.');
  }

  const keysParam = instrumentKeys.join(',');
  console.log('Instrument keys being sent:', instrumentKeys);
  console.log('Keys param:', keysParam);

  // Upstox OHLC quote endpoint (daily). If this changes, update here.
  const url = `https://api.upstox.com/v2/market-quote/ohlc?instrument_key=${encodeURIComponent(keysParam)}&interval=1d`;
  console.log('API URL:', url);

  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Upstox API error ${resp.status}: ${text}`);
  }

  const data = await resp.json();
  console.log('Upstox API response:', JSON.stringify(data, null, 2));
  
  // Expected shape (example): { data: { [instrumentKey]: { ohlc: { open, high, low, close }, timestamp } } }, status: "success" }
  // Normalize to array of { instrumentKey, close, date }
  const results = [];
  if (data && data.data && typeof data.data === 'object') {
    for (const [key, value] of Object.entries(data.data)) {
      const close = value && value.ohlc ? value.ohlc.close : undefined;
      const timestamp = value && value.timestamp ? value.timestamp : undefined;
      const date = value && value.date ? value.date : timestamp;
      
      results.push({ 
        instrumentKey: key, 
        close, 
        date: date,
        timestamp: timestamp 
      });
    }
  } else {
    console.log('Unexpected API response structure:', data);
  }
  return results;
}

async function analyzeSentimentForSymbols(symbols) {
  const { geminiApiKey } = await getFromStorage([STORAGE_KEYS.geminiApiKey]);
  console.log('Gemini API key present:', Boolean(geminiApiKey));
  if (!geminiApiKey) {
    throw new Error('Missing Gemini API key. Add it in Options.');
  }

  // Normalize symbols to plain tickers (uppercased)
  const normSymbols = symbols.map(s => String(s || '').trim().toUpperCase());
  console.log('Analyzing symbols:', normSymbols);

  const prompt = `Return ONLY a JSON array. No prose.
Schema: { "symbol": string, "action": "Buy"|"Sell"|"Hold", "confidence": number (0..1), "rationale": string }.
Instructions:
- For each symbol below, analyze the last 21 trading days (daily bars). Use these indicators:
  • Price action & daily candlestick patterns
  • Trend: 21-day SMA slope, 50-day SMA vs 200-day SMA (if 50/200 available)
  • Momentum: RSI (14), MACD (12,26,9) histogram trend
  • Bollinger Bands (20,2): price position relative to upper/middle/lower bands, band width (volatility), recent squeezes or expansions
  • Volume: delivery volume % vs avg traded volume to detect accumulation/distribution
  • Fibonacci retracement from the most recent swing high to swing low within the last 90 days to identify key support/resistance
  • VWAP (for intraday bias if intraday available) — if not available, ignore
  • Recent support/resistance zones (recent two pivots)
- Decision rules (combine signals):
  • Strong Buy (action "Buy", confidence >=0.75): price above rising 21-SMA, RSI between 45–70 (rising), MACD histogram positive & expanding, price near/above middle Bollinger Band with bands expanding, delivery volume trending up (accumulation), price above a key Fibonacci support — majority of indicators agree bullish.
  • Buy (0.5–0.74): bullish majority indicators but with one moderate conflict (e.g., overbought RSI, price touching upper Bollinger Band, or flat volume).
  • Hold (0.3–0.5): mixed/flat signals, shallow trend, price oscillating between Bollinger Bands, or insufficient confluence; choose Hold with mid confidence if indicators are neutral.
  • Sell (<0.3): weak signals, poor technical setup, or insufficient data; if confidence below 30%, mark as Sell regardless of other factors.
  • Sell (>=0.5): price below falling 21-SMA, RSI below 45 (falling), MACD histogram negative or contracting, price near/touching lower Bollinger Band with bands contracting, delivery volume high on down-days (distribution), price breaking key Fibonacci support — majority agree bearish.
  • If data is insufficient (less than 15 daily bars or missing critical inputs), set action "Sell" and confidence 0.2 and state in rationale which data was missing.
- Confidence scoring guidance:
  • Start at 0.5. Add/subtract in 0.1–0.2 increments for each confirming/contradicting indicator. Cap at 1.0 and floor at 0.0.
  • If >4 indicators strongly align, confidence >=0.8. If 2–3 align, 0.5–0.75. If conflicted, 0.3–0.5.
- Rationale: one concise sentence (max 20 words) mentioning the primary drivers (e.g., "rising 21-SMA, positive MACD, increasing volume").
- CRITICAL: If confidence is below 0.3, you MUST set action to "Sell" regardless of other factors.
- Output: one JSON object per symbol in the order provided.
Symbols: ${normSymbols.join(', ')}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
  const body = {
    contents: [
      {
        role: 'user',
        parts: [ { text: prompt } ]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      response_mime_type: 'application/json'
    }
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  console.log('Gemini API response status:', resp.status);
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('Gemini API error response:', t);
    throw new Error(`Gemini API error ${resp.status}: ${t}`);
  }
  
  const json = await resp.json();
  console.log('Gemini API full response:', JSON.stringify(json, null, 2));
  
  const part = json?.candidates?.[0]?.content?.parts?.[0];
  const text = typeof part?.text === 'string' ? part.text : '';
  console.log('Gemini extracted text:', text);
  
  let parsed = [];
  try {
    if (text) {
      // Check if response was truncated (ends with incomplete JSON)
      let cleanText = text.trim();
      if (cleanText.endsWith('"') || cleanText.endsWith(',')) {
        console.warn('Response appears truncated, attempting to fix...');
        // Try to close the JSON array
        if (cleanText.includes('[') && !cleanText.endsWith(']')) {
          cleanText = cleanText + ']';
        }
      }
      parsed = JSON.parse(cleanText);
      console.log('Successfully parsed Gemini response:', parsed);
      
      // Post-process: enforce <30% confidence = Sell rule
      parsed = parsed.map(item => {
        if (typeof item.confidence === 'number' && item.confidence < 0.3) {
          console.log(`Forcing ${item.symbol} to Sell due to low confidence: ${item.confidence}`);
          return {
            ...item,
            action: 'Sell',
            rationale: `Low confidence (${(item.confidence * 100).toFixed(0)}%) - ${item.rationale || 'weak signals'}`
          };
        }
        return item;
      });
    } else if (part?.inlineData?.data) {
      const decoded = atob(part.inlineData.data);
      parsed = JSON.parse(decoded);
      console.log('Successfully parsed Gemini inlineData:', parsed);
    } else {
      throw new Error('Empty model response');
    }
  } catch (e) {
    console.warn('Gemini parse failed, falling back. Raw text:', text, 'Error:', e);
    parsed = normSymbols.map(s => ({ symbol: s, action: 'Hold', confidence: 0.2, rationale: 'API Parse Failed' }));
  }
  return parsed;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message && message.type === 'FETCH_CLOSES') {
      try {
        const { instrumentKeys } = await getFromStorage([STORAGE_KEYS.instrumentKeys]);
        const keys = Array.isArray(instrumentKeys) ? instrumentKeys.slice(0, 10) : [];
        if (!keys.length) {
          throw new Error('No instrument keys configured. Add them in Options.');
        }
        const data = await fetchOhlcForInstruments(keys);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (message && message.type === 'ANALYZE_SENTIMENT') {
      try {
        const symbols = message.symbols;
        if (!Array.isArray(symbols) || !symbols.length) {
          throw new Error('No symbols provided for sentiment analysis.');
        }
        const data = await analyzeSentimentForSymbols(symbols);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  })();
  // Keep message channel open for async response
  return true;
});


