/**
 * Yapay zekâ katmanı: Groq Vision ve Gemini Vision, karşılıklı fallback.
 * Tercih edilen servis başarısız olursa (veya anahtarı yoksa) diğeri denenir.
 *
 * Ortam değişkenleri:
 *   GROQ_API_KEY, GEMINI_API_KEY
 *   GROQ_MODEL   (varsayılan: meta-llama/llama-4-scout-17b-16e-instruct)
 *   GEMINI_MODEL (varsayılan: gemini-2.0-flash)
 */
const LANGUAGES = { tr: 'Turkish', en: 'English', fr: 'French', it: 'Italian', de: 'German', es: 'Spanish' };

function buildPrompt(language) {
  const lang = LANGUAGES[language] || 'Turkish';
  return `You are an expert art historian. Identify the artwork in the image.
Write all text values in ${lang}.
Respond ONLY with a JSON object with exactly these keys:
{
  "artwork_name": string,
  "artist": string,
  "year": string,
  "movement": string,
  "history": string (3-5 paragraphs telling the full story of the work, including hidden details),
  "historical_context": string (1-2 paragraphs on its historical significance),
  "confidence_score": number between 0 and 1
}
If the image is not a known artwork, set artwork_name to "Unknown", keep confidence_score below 0.3 and describe what you see.`;
}

async function callGroq({ base64, mime, language }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY tanımlı değil');
  const model = process.env.GROQ_MODEL || 'meta-llama/llama-4-scout-17b-16e-instruct';

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      max_completion_tokens: 1800,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt(language) },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini({ base64, mime, language }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY tanımlı değil');
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(language) }, { inline_data: { mime_type: mime, data: base64 } }] }],
      generationConfig: { temperature: 0.4, responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
}

/** Model çıktısından JSON'u güvenle ayıklar. */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = /\{[\s\S]*\}/.exec(text);
    if (!m) throw new Error('Model geçerli JSON döndürmedi');
    return JSON.parse(m[0]);
  }
}

/** Çıktıyı sabit şemaya oturtur. */
function normalize(raw, provider) {
  let c = Number(raw.confidence_score);
  if (!Number.isFinite(c)) c = 0;
  if (c > 1) c = c / 100;
  return {
    artwork_name: String(raw.artwork_name || 'Unknown'),
    artist: String(raw.artist || 'Unknown'),
    year: String(raw.year || '-'),
    movement: String(raw.movement || '-'),
    history: String(raw.history || ''),
    historical_context: String(raw.historical_context || ''),
    confidence_score: Math.max(0, Math.min(1, c)),
    provider,
  };
}

const PROVIDERS = { groq: callGroq, gemini: callGemini };

async function analyzeWithFallback({ base64, mime, provider, language }) {
  const first = provider === 'gemini' ? 'gemini' : 'groq';
  const order = [first, first === 'groq' ? 'gemini' : 'groq'];
  const errors = [];

  for (const name of order) {
    try {
      const text = await PROVIDERS[name]({ base64, mime, language });
      return normalize(parseJson(text), name);
    } catch (err) {
      console.warn(`[ai] ${name} başarısız: ${err.message}`);
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error(`Tüm yapay zekâ servisleri başarısız oldu. ${errors.join(' | ')}`);
}

module.exports = { analyzeWithFallback };
