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

async function callGeminiApi(apiKey, history) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: history,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      response_mime_type: 'application/json'
    }
  };

  console.log('Calling Gemini API with history:', JSON.stringify(history, null, 2));

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('Gemini API error response:', t);
    throw new Error(`Gemini API error ${resp.status}: ${t}`);
  }

  const json = await resp.json();
  const part = json?.candidates?.[0]?.content?.parts?.[0];
  const text = typeof part?.text === 'string' ? part.text : '';
  if (!text) {
    throw new Error('Empty model response');
  }
  return { text, fullResponse: json };
}

async function analyzeSentimentWithChain(symbols, geminiApiKey) {
  const finalResults = [];

  for (const symbol of symbols) {
    try {
      console.log(`Starting sentiment chain for ${symbol}`);
      let history = [];

      // Step 1: Get Raw Technical Data
      const prompt1 = `You are a financial data API. For the stock symbol "${symbol}", provide the following technical indicators based on the last 21 trading days. Return ONLY a single JSON object.
- RSI (14)
- MACD (12,26,9) histogram trend (e.g., "positive & expanding")
- Bollinger Bands (20,2) price position (e.g., "near upper band")
- 21-day SMA slope (e.g., "rising")
- Delivery volume trend (e.g., "increasing")
- Key Fibonacci support/resistance from last 90-day swing.
Schema: { "symbol": string, "rsi": number, "macd_trend": string, "bollinger": string, "sma21_slope": string, "volume_trend": string, "fibonacci_level": string }`;
      history.push({ role: 'user', parts: [{ text: prompt1 }] });
      const response1 = await callGeminiApi(geminiApiKey, history);
      const technicalData = JSON.parse(response1.text);
      history.push({ role: 'model', parts: [{ text: response1.text }] });
      console.log(`[${symbol}] Step 1 - Raw Data:`, technicalData);

      // Step 2: Interpret the Data
      const prompt2 = `You are a technical analyst. Based on the following technical data for ${symbol}, provide a brief, one-sentence interpretation of the signals.
Tool Result (Technical Data):
${JSON.stringify(technicalData, null, 2)}
Return ONLY a single JSON object with schema: { "symbol": string, "interpretation": string }`;
      history.push({ role: 'user', parts: [{ text: prompt2 }] });
      const response2 = await callGeminiApi(geminiApiKey, history);
      const interpretation = JSON.parse(response2.text);
      history.push({ role: 'model', parts: [{ text: response2.text }] });
      console.log(`[${symbol}] Step 2 - Interpretation:`, interpretation);

      // Step 3: Final Recommendation
      const prompt3 = `You are a financial advisor. Based on the analyst's interpretation for ${symbol}, provide a final recommendation.
Tool Result (Analyst Interpretation):
${JSON.stringify(interpretation, null, 2)}
Use the following decision rules:
- If interpretation is strongly bullish (e.g., multiple positive indicators), action is "Buy" with confidence > 0.7.
- If interpretation is moderately bullish, action is "Buy" with confidence 0.5-0.7.
- If interpretation is mixed or neutral, action is "Hold" with confidence 0.3-0.5.
- If interpretation is bearish, action is "Sell" with confidence > 0.5.
- CRITICAL: If confidence is below 0.3, you MUST set action to "Sell".
Return ONLY a single JSON object with schema: { "symbol": string, "action": "Buy"|"Sell"|"Hold", "confidence": number (0..1), "rationale": string }`;
      history.push({ role: 'user', parts: [{ text: prompt3 }] });
      const response3 = await callGeminiApi(geminiApiKey, history);
      const finalRec = JSON.parse(response3.text);
      console.log(`[${symbol}] Step 3 - Final Recommendation:`, finalRec);

      // Post-process and add to results
      if (typeof finalRec.confidence === 'number' && finalRec.confidence < 0.3) {
        finalRec.action = 'Sell';
        finalRec.rationale = `Low confidence (${(finalRec.confidence * 100).toFixed(0)}%) - ${finalRec.rationale || 'weak signals'}`;
      }
      finalResults.push(finalRec);

    } catch (e) {
      console.error(`Error in sentiment chain for ${symbol}:`, e);
      finalResults.push({ symbol: symbol, action: 'Hold', confidence: 0.2, rationale: 'Analysis chain failed.' });
    }
  }
  return finalResults;
}


async function analyzeSentimentForSymbols(symbols) {
  const { geminiApiKey } = await getFromStorage([STORAGE_KEYS.geminiApiKey]);
  console.log('Gemini API key present:', Boolean(geminiApiKey));
  if (!geminiApiKey) {
    throw new Error('Missing Gemini API key. Add it in Options.');
  }

  const normSymbols = symbols.map(s => String(s || '').trim().toUpperCase());
  console.log('Analyzing symbols with chained method:', normSymbols);

  try {
    const results = await analyzeSentimentWithChain(normSymbols, geminiApiKey);
    return results;
  } catch (e) {
    console.warn('Gemini chained call failed. Error:', e);
    return normSymbols.map(s => ({ symbol: s, action: 'Hold', confidence: 0.2, rationale: 'API Call Failed' }));
  }
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
