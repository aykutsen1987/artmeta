/**
 * ArtMeta Backend - Express sunucusu
 *
 * Uç noktalar:
 *   GET  /                      -> Karşılama sayfası (public/index.html)
 *   GET  /health                -> Render sağlık kontrolü
 *   POST /api/analyze-artwork   -> Görseli analiz eder (multipart "image" veya JSON "image_base64")
 *   GET  /api/history           -> Sunucuda kayıtlı son taramalar
 */
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const { analyzeWithFallback } = require('./services/ai');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 10000; // Render PORT değişkenini kendisi verir

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Görseller diske yazılmadan bellekte tutulur (maks. 10 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/analyze-artwork', upload.single('image'), async (req, res) => {
  try {
    let base64;
    let mime = 'image/jpeg';

    if (req.file) {
      // Multipart yükleme (Android uygulamasının kullandığı yol)
      base64 = req.file.buffer.toString('base64');
      mime = req.file.mimetype || mime;
    } else if (req.body && req.body.image_base64) {
      // Base64 yükleme; "data:image/png;base64,...." öneki varsa ayıklanır
      const match = /^data:(.+?);base64,(.*)$/.exec(req.body.image_base64);
      if (match) {
        mime = match[1];
        base64 = match[2];
      } else {
        base64 = req.body.image_base64;
      }
    } else {
      return res.status(400).json({ error: 'Görsel bulunamadı (image veya image_base64).' });
    }

    const provider = (req.body && req.body.provider) || 'groq';
    const language = (req.body && req.body.language) || 'tr';

    const result = await analyzeWithFallback({ base64, mime, provider, language });
    db.saveScan(result);
    res.json(result);
  } catch (err) {
    console.error('[analyze-artwork]', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/history', (_req, res) => res.json(db.recentScans(50)));

app.listen(PORT, () => console.log(`ArtMeta backend ${PORT} portunda çalışıyor`));
