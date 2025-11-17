require('dotenv').config();
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { promisify } = require('util');
const { execFile } = require('child_process');
const iconv = require('iconv-lite');
const chardet = require('chardet');
const JSZip = require('jszip');

const DATA_FILE = path.join(__dirname, '..', 'data', 'videos.json');
const MEDIA_DIR = path.join(__dirname, '..', 'media');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const fetch = global.fetch ? global.fetch.bind(global) : ((...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args)));
const gunzip = promisify(zlib.gunzip);
const execFileAsync = promisify(execFile);
const OPENSUBTITLES_API_KEY = process.env.OPENSUBTITLES_API_KEY;
const OPENSUBTITLES_USER_AGENT = process.env.OPENSUBTITLES_USER_AGENT || 'homeVideoDB/1.0';
const SUBDL_API_KEY = process.env.SUBDL_API_KEY;
const DISABLE_SUBDL = String(process.env.DISABLE_SUBDL || '').toLowerCase() === 'true';
const DISABLE_OPENSUBTITLES = String(process.env.DISABLE_OPENSUBTITLES || '').toLowerCase() === 'true';
const ENABLE_SUBDL = !DISABLE_SUBDL && String(process.env.ENABLE_SUBDL || '').toLowerCase() !== 'false';
const ENABLE_OPENSUBTITLES = !DISABLE_OPENSUBTITLES && String(process.env.ENABLE_OPENSUBTITLES || '').toLowerCase() !== 'false';
const ENABLE_SCRIPT_SUBTITLES = String(process.env.ENABLE_SCRIPT_SUBTITLES || '').toLowerCase() === 'true';

// OpenSubtitles login token cache
let cachedToken = null;
let tokenExpiry = 0;

function getOpenSubtitlesCredentials() {
  return {
    username: process.env.OPENSUBTITLES_USERNAME,
    password: process.env.OPENSUBTITLES_PASSWORD,
    userToken: process.env.OPENSUBTITLES_USER_TOKEN
  };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getOpenSubtitlesToken() {
  // Mevcut token geçerliyse onu kullan
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }
  const { username, password, userToken } = getOpenSubtitlesCredentials();

  if (userToken) {
    cachedToken = userToken;
    tokenExpiry = Date.now() + (24 * 60 * 60 * 1000);
    return userToken;
  }

  if (!username || !password) {
    console.warn('OpenSubtitles kullanıcı bilgileri eksik (OPENSUBTITLES_USERNAME, OPENSUBTITLES_PASSWORD veya OPENSUBTITLES_USER_TOKEN)');
    return null;
  }

  try {
    const loginResponse = await fetch('https://api.opensubtitles.com/api/v1/login', {
      method: 'POST',
      headers: {
        'Api-Key': OPENSUBTITLES_API_KEY,
        'User-Agent': OPENSUBTITLES_USER_AGENT,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Accept-Language': 'en'
      },
      body: JSON.stringify({
        username,
        password
      })
    });

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text().catch(() => '');
      console.warn('OpenSubtitles login hatası:', loginResponse.status, errorText);
      return null;
    }

    const loginData = await loginResponse.json();
    const token = loginData.token;
    
    if (!token) {
      console.warn('OpenSubtitles login başarısız - token alınamadı');
      return null;
    }

    // Token'ı cache'le (24 saat geçerli)
    cachedToken = token;
    tokenExpiry = Date.now() + (23 * 60 * 60 * 1000); // 23 saat sonra expire et
    
    console.log('OpenSubtitles login başarılı');
    return token;
  } catch (error) {
    console.warn('OpenSubtitles login hatası:', error.message);
    return null;
  }
}

async function fetchWithRetry(url, options = {}, retryCount = 3, retryDelay = 2000, context = 'request') {
  let attempt = 0;
  while (attempt <= retryCount) {
    try {
      const response = await fetch(url, options);
      
      // 503 durumunda özel bekleme süresi
      if (response.status === 503 && attempt < retryCount) {
        const backoffDelay = retryDelay * Math.pow(2, attempt); // Exponential backoff
        console.warn(`OpenSubtitles ${context} ${response.status}, ${backoffDelay}ms bekleyip tekrar denenecek (${attempt + 1}/${retryCount})`);
        await wait(backoffDelay);
        attempt += 1;
        continue;
      }
      
      // Diğer 5xx hataları için normal retry
      if (response.status >= 500 && response.status < 600 && attempt < retryCount) {
        console.warn(`OpenSubtitles ${context} ${response.status}, tekrar denenecek (${attempt + 1}/${retryCount})`);
        await wait(retryDelay);
        attempt += 1;
        continue;
      }
      
      return response;
    } catch (error) {
      if (attempt >= retryCount) {
        throw error;
      }
      console.warn(`OpenSubtitles ${context} hatası, tekrar denenecek (${attempt + 1}/${retryCount})`, error.message);
      await wait(retryDelay);
      attempt += 1;
    }
  }
  return fetch(url, options);
}

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.mov',
  '.avi',
  '.wmv',
  '.m4v',
  '.webm'
]);

const SUBTITLE_EXTENSIONS = new Set(['.vtt', '.srt']);

const SUBTITLE_LANGUAGE_ALIASES = new Map([
  ['tr', { code: 'tr', label: 'Türkçe' }],
  ['tur', { code: 'tr', label: 'Türkçe' }],
  ['turkish', { code: 'tr', label: 'Türkçe' }],
  ['tr-tr', { code: 'tr', label: 'Türkçe' }],
  ['en', { code: 'en', label: 'İngilizce' }],
  ['eng', { code: 'en', label: 'İngilizce' }],
  ['english', { code: 'en', label: 'İngilizce' }],
  ['en-us', { code: 'en', label: 'İngilizce' }],
  ['en-gb', { code: 'en', label: 'İngilizce' }],
  ['es', { code: 'es', label: 'İspanyolca' }],
  ['spa', { code: 'es', label: 'İspanyolca' }],
  ['es-es', { code: 'es', label: 'İspanyolca' }],
  ['de', { code: 'de', label: 'Almanca' }],
  ['ger', { code: 'de', label: 'Almanca' }],
  ['de-de', { code: 'de', label: 'Almanca' }]
]);

function logInvalidSubtitle(reason, context, sample) {
  if (!context && !sample) return;
  const preview = sample ? sample.slice(0, 160).replace(/\s+/g, ' ').trim() : '';
  console.warn('Altyazı içeriği atlandı:', { reason, context, sample: preview });
}

function sanitizeSubtitlePayload(content, context = '') {
  if (!content) {
    logInvalidSubtitle('empty', context);
    return null;
  }
  const normalized = content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) {
    logInvalidSubtitle('blank', context);
    return null;
  }
  const withoutHeader = trimmed.replace(/^webvtt\s*/i, '').trim();
  const target = withoutHeader || trimmed;
  if (!target) {
    logInvalidSubtitle('no-text', context);
    return null;
  }
  const lower = target.toLowerCase();
  if (lower.startsWith('an error occured') || lower.startsWith('an error occurred') || lower.startsWith('error')) {
    logInvalidSubtitle('error-message', context, target);
    return null;
  }
  if (lower.startsWith('<html') || lower.startsWith('<!doctype')) {
    logInvalidSubtitle('html', context, target);
    return null;
  }
  if (lower.startsWith('{') || lower.startsWith('[')) {
    try {
      const parsed = JSON.parse(target);
      if (parsed && typeof parsed === 'object') {
        logInvalidSubtitle('json', context, target);
        return null;
      }
    } catch (error) {
      // JSON parse failed; treat as text subtitle.
    }
  }
  return normalized;
}

function normalizeSubtitleToVtt(content, formatHint, context = '') {
  const sanitized = sanitizeSubtitlePayload(content, context);
  if (!sanitized) {
    return null;
  }
  if (formatHint === 'vtt') {
    return ensureVttContent(sanitized);
  }
  return convertSrtToVtt(sanitized);
}

function slugify(input) {
  return input
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function encodeMediaPath(relativePath) {
  const safeSegments = relativePath.split(path.sep).map(segment => encodeURIComponent(segment));
  return `/media/${safeSegments.join('/')}`;
}

function formatRuntime(minutes) {
  if (!minutes || Number.isNaN(minutes)) {
    return '';
  }
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  const parts = [];
  if (hrs > 0) {
    parts.push(`${hrs} sa`);
  }
  if (mins > 0) {
    parts.push(`${mins} dk`);
  }
  return parts.join(' ') || `${minutes} dk`;
}

function resolveSubtitleLanguageFromHint(hint) {
  const normalized = (hint || '').toLowerCase();
  if (!normalized) {
    return { code: 'und', label: 'Altyazı' };
  }
  if (SUBTITLE_LANGUAGE_ALIASES.has(normalized)) {
    return SUBTITLE_LANGUAGE_ALIASES.get(normalized);
  }
  if (normalized.length === 2) {
    return { code: normalized, label: normalized.toUpperCase() };
  }
  if (normalized.length === 3) {
    return { code: normalized.slice(0, 2), label: normalized.toUpperCase() };
  }
  return { code: 'und', label: hint.toUpperCase() };
}

function convertSrtToVtt(content) {
  const cleaned = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = cleaned.split('\n').map(line => {
    return line.includes('-->') ? line.replace(/,/g, '.') : line;
  });
  return `WEBVTT\n\n${lines.join('\n')}`;
}

function ensureVttContent(content) {
  if (!content) {
    return 'WEBVTT\n\n';
  }
  const trimmed = content.replace(/^\uFEFF/, '').trimStart();
  if (trimmed.startsWith('WEBVTT')) {
    return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return `WEBVTT\n\n${normalized}`;
}

function decodeBufferToUtf8(buffer, fallbackEncoding = 'utf-8') {
  if (!buffer) {
    return '';
  }
  let encoding = chardet.detect(buffer) || fallbackEncoding || 'utf-8';
  if (encoding && typeof encoding === 'string') {
    encoding = encoding.toLowerCase();
  } else {
    encoding = 'utf-8';
  }
  if (encoding === 'ascii') {
    encoding = 'utf-8';
  }
  if (!iconv.encodingExists(encoding)) {
    encoding = 'utf-8';
  }
  return iconv.decode(buffer, encoding);
}

async function decodeSubtitlePayload(buffer, response, fileName) {
  const encoding = (response && typeof response.headers?.get === 'function') ? (response.headers.get('content-encoding') || '') : '';
  const contentType = (response && typeof response.headers?.get === 'function') ? (response.headers.get('content-type') || '') : '';
  const lowerName = (fileName || '').toLowerCase();
  const gzipMagic = buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b;
  const isGzip = encoding.includes('gzip') || contentType.includes('gzip') || lowerName.endsWith('.gz') || gzipMagic;
  if (isGzip) {
    try {
      const result = await gunzip(buffer);
      return decodeBufferToUtf8(result, 'utf-8');
    } catch (error) {
      console.warn('Altyazı sıkıştırması açılamadı', error);
    }
  }
  return decodeBufferToUtf8(buffer, 'utf-8');
}

function parseFileName(relativePath) {
  const baseName = path.parse(relativePath).name;
  const cleaned = baseName
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
  const sanitized = cleaned
    .replace(/\b(19|20)\d{2}\b/, ' ')
    .replace(/\b(480p|720p|1080p|2160p|4k|hdr|bluray|webrip|web-dl|remux|x264|x265|h264|h265)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const title = sanitized || cleaned || baseName;
  const year = yearMatch ? yearMatch[0] : '';
  const idBase = year ? `${title}-${year}` : title;
  return {
    id: slugify(idBase),
    title,
    year,
    rawTitle: cleaned
  };
}

function isMetadataComplete(video) {
  return Boolean(video.description && video.poster);
}

class LibraryManager {
  constructor() {
    this.data = {
      videos: [],
      unmatched: [],
      lastScan: null
    };
    this.scanning = false;
  }

  async load() {
    try {
      const raw = await fs.readFile(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      
      // Eski format uyumluluğu: Eğer dosya array ise yeni formata çevir
      if (Array.isArray(parsed)) {
        this.data = {
          videos: parsed,
          unmatched: [],
          lastScan: null
        };
      } else {
        this.data = parsed;
      }
      
      if (!this.data.videos) {
        this.data.videos = [];
      }
      if (!this.data.unmatched) {
        this.data.unmatched = [];
      }
      this.data.videos.forEach(video => {
        if (!Array.isArray(video.sources)) {
          video.sources = [];
        }
        if (!Array.isArray(video.subtitles)) {
          video.subtitles = [];
        }
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.save();
      } else {
        console.error('Veri dosyası okunamadı:', error);
      }
    }
  }

  async save() {
    // Ensure the data directory exists before attempting to write the file
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  async listMediaFiles(dir = MEDIA_DIR, prefix = '') {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      // .aria2 uzantılı dosyaları atla (halen indiriliyor)
      if (entry.name.endsWith('.aria2')) continue;
      
      // Sample/demo dosyalarını atla
      const lowerName = entry.name.toLowerCase();
      if (lowerName.includes('sample') || lowerName.includes('rarbg')) {
        console.log(`⏭ Sample/demo dosyası atlanıyor: ${entry.name}`);
        continue;
      }
      
      const absolute = path.join(dir, entry.name);
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        const nested = await this.listMediaFiles(absolute, relative);
        files.push(...nested);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        if (VIDEO_EXTENSIONS.has(ext)) {
          files.push(relative);
        }
      }
    }
    return files.sort();
  }

  ensureSource(video, relativePath) {
    const encoded = encodeMediaPath(relativePath);
    if (!Array.isArray(video.sources)) {
      video.sources = [];
    }
    const existing = video.sources.find(source => source.src === encoded);
    if (!existing) {
      const baseSource = {
        label: 'Yerel Dosya',
        resolution: 'Otomatik',
        src: encoded
      };
      if (video.sources.length === 0) {
        video.sources.push(baseSource);
      } else {
        video.sources[0] = baseSource;
      }
    } else {
      existing.label = existing.label || 'Yerel Dosya';
      existing.resolution = existing.resolution || 'Otomatik';
    }
  }

  async ensureSubtitles(video, relativePath) {
    if (!video) return;
    const relativeDirRaw = path.dirname(relativePath);
    const relativeDir = relativeDirRaw === '.' ? '' : relativeDirRaw;
    const absoluteDir = path.join(MEDIA_DIR, relativeDir);
    let entries = [];
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        video.subtitles = [];
        return;
      }
      throw error;
    }

    const baseName = path.parse(relativePath).name;
    const subtitles = [];
    const usedIds = new Set();

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.has(ext)) continue;

      const candidateBase = path.parse(entry.name).name;
      const baseMatches = candidateBase.toLowerCase().startsWith(baseName.toLowerCase());
      if (!baseMatches) continue;

      const remainder = candidateBase.slice(baseName.length).replace(/^[._-]+/, '');
      const hint = remainder.split(/[._-]/).filter(Boolean)[0] || remainder;
      const language = resolveSubtitleLanguageFromHint(hint);
      const format = ext === '.srt' ? 'srt' : 'vtt';
      const absoluteFile = path.join(absoluteDir, entry.name);
      let fileContent = null;
      try {
        const rawBuffer = await fs.readFile(absoluteFile);
        fileContent = decodeBufferToUtf8(rawBuffer);
      } catch (error) {
        console.warn('Altyazı okunamadı', absoluteFile, error.message);
        continue;
      }
      const sanitized = sanitizeSubtitlePayload(fileContent, `local:${absoluteFile}`);
      if (!sanitized) {
        try {
          await fs.unlink(absoluteFile);
        } catch (error) {
          // Yoksay
        }
        continue;
      }
      try {
        await fs.writeFile(absoluteFile, sanitized, 'utf-8');
      } catch (error) {
        console.warn('Altyazı UTF-8 olarak kaydedilemedi', absoluteFile, error.message);
      }
      const rawId = slugify(`${language.code || 'und'}-${candidateBase}`) || slugify(candidateBase) || `subtitle-${subtitles.length + 1}`;
      let id = rawId;
      while (usedIds.has(id)) {
        id = `${id}-${subtitles.length + 1}`;
      }
      usedIds.add(id);

      const relativeFile = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const normalizedRelative = relativeFile.split(path.sep).join('/');
      subtitles.push({
        id,
        lang: language.code,
        label: language.label,
        format,
        file: normalizedRelative,
        src: `/api/subtitles/${video.id}/${encodeURIComponent(id)}`,
        default: false
      });
    }

    subtitles.sort((a, b) => {
      if (a.lang === b.lang) {
        return a.label.localeCompare(b.label, 'tr');
      }
      if (a.lang === 'tr') return -1;
      if (b.lang === 'tr') return 1;
      return a.label.localeCompare(b.label, 'tr');
    });

    video.subtitles = subtitles;
  }

  async checkOpenSubtitlesStatus() {
    try {
      const testResponse = await fetch('https://api.opensubtitles.com/api/v1/infos/user', {
        headers: {
          'Api-Key': OPENSUBTITLES_API_KEY,
          'User-Agent': OPENSUBTITLES_USER_AGENT
        },
        timeout: 5000
      });
      
      if (testResponse.status === 429) {
        console.warn('OpenSubtitles rate limit aşıldı - 24 saat beklemeniz gerekebilir');
        return false;
      } else if (testResponse.status === 406) {
        console.warn('OpenSubtitles günlük indirme limiti aşıldı');
        return false;
      } else if (testResponse.status >= 500) {
        console.warn('OpenSubtitles sunucu hatası:', testResponse.status);
        return false;
      }
      
      // Kullanıcı bilgilerini göster
      if (testResponse.ok) {
        try {
          const userInfo = await testResponse.json();
          const downloads = userInfo?.data?.remaining_downloads;
          if (typeof downloads === 'number') {
            console.log(`OpenSubtitles kalan indirme: ${downloads}`);
          }
        } catch (e) {
          // JSON parse hatası önemli değil
        }
      }
      
      return testResponse.status < 500;
    } catch (error) {
      console.warn('OpenSubtitles durumu kontrol edilemedi:', error.message);
      return false;
    }
  }

  async tryFetchRemoteSubtitles(video, relativePath, parsedMeta) {
    if (!video) return;

    const relativeDirRaw = path.dirname(relativePath);
    const relativeDir = relativeDirRaw === '.' ? '' : relativeDirRaw;
    const baseName = path.parse(relativePath).name;
    const languages = ['tr', 'en'];
    const existingLangs = new Set(
      Array.isArray(video.subtitles)
        ? video.subtitles.map(item => item.lang).filter(Boolean)
        : []
    );
    let missingLangs = languages.filter(lang => !existingLangs.has(lang));
    
    // Altyazı siteleri genelde İngilizce orijinal adı kullanır
    // originalTitle TMDB'den geliyor ve genelde İngilizce
    // Önce originalTitle'ı dene, sonra diğerlerini
    const titleCandidates = [...new Set([
      video.originalTitle,  // TMDB'den gelen orijinal ad (genelde İngilizce)
      parsedMeta?.rawTitle, // Dosya adından parse edilen ham ad
      parsedMeta?.title,    // Dosya adından parse edilen temiz ad
      video.title          // TMDB'den gelen Türkçe ad (en son seçenek)
    ].filter(Boolean))];

    if (titleCandidates.length === 0 || missingLangs.length === 0) {
      return;
    }
    
    console.log(`📥 Altyazı aranacak: [${titleCandidates.map((t, i) => `${i + 1}:"${t}"`).join(', ')}] için diller: [${missingLangs.join(', ')}]`);

    let downloaded = false;
    const SCRIPT_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 saat
    const now = Date.now();

    if (
      ENABLE_SCRIPT_SUBTITLES &&
      missingLangs.length > 0 &&
      (!video.subtitleScriptLastAttempt || (now - new Date(video.subtitleScriptLastAttempt).getTime()) > SCRIPT_COOLDOWN_MS)
    ) {
      for (const query of titleCandidates) {
        try {
          const success = await this.downloadSubtitlesWithScript({ query, baseName, relativeDir });
          video.subtitleScriptLastAttempt = new Date().toISOString();
          if (success) {
            downloaded = true;
            await this.ensureSubtitles(video, relativePath);
            existingLangs.clear();
            for (const item of Array.isArray(video.subtitles) ? video.subtitles : []) {
              if (item?.lang) existingLangs.add(item.lang);
            }
            missingLangs = languages.filter(lang => !existingLangs.has(lang));
            video.subtitleScriptLastSuccess = new Date().toISOString();
            break;
          }
        } catch (error) {
          console.warn('Altyazı scripti başarısız:', error.message || error);
          video.subtitleScriptLastAttempt = new Date().toISOString();
        }
      }
    }

    if (!downloaded && ENABLE_SUBDL && SUBDL_API_KEY && missingLangs.length > 0) {
      for (const lang of missingLangs) {
        for (const query of titleCandidates) {
          try {
            const result = await this.downloadSubtitleFromSubdl({
              title: query,
              lang,
              year: video.year || parsedMeta?.year,
              type: video?.type
            });
            if (result?.content) {
              const stored = await this.storeSubtitleContent({
                rawContent: result.content,
                format: result.format,
                lang,
                baseName,
                relativeDir,
                origin: `subdl:${query}:${lang}`
              });
              if (stored) {
                downloaded = true;
                existingLangs.add(lang);
                break;
              }
            }
          } catch (error) {
            console.warn(`SubDL altyazı indirilemedi (${lang})`, error.message || error);
          }
        }
        if (downloaded) break;
      }
      missingLangs = languages.filter(lang => !existingLangs.has(lang));
    }

    if (!downloaded && ENABLE_OPENSUBTITLES && OPENSUBTITLES_API_KEY && missingLangs.length > 0) {
      const available = await this.checkOpenSubtitlesStatus();
      if (!available) {
        console.warn('OpenSubtitles servisi şu anda kullanılamıyor.');
      } else {
        for (const lang of missingLangs) {
          for (const query of titleCandidates) {
            try {
              const result = await this.downloadSubtitleFromOpenSubtitles({
                title: query,
                lang,
                year: video.year || parsedMeta?.year
              });
              if (result?.content) {
                const stored = await this.storeSubtitleContent({
                  rawContent: result.content,
                  format: result.format,
                  lang,
                  baseName,
                  relativeDir,
                  origin: `opensubtitles:${query}:${lang}`
                });
                if (stored) {
                  downloaded = true;
                  existingLangs.add(lang);
                  break;
                }
              }
            } catch (error) {
              console.warn(`OpenSubtitles altyazı indirilemedi (${lang})`, error.message || error);
            }
          }
          if (downloaded) break;
        }
      }
    }

    if (downloaded) {
      await this.ensureSubtitles(video, relativePath);
    }
  }

  markUnmatched(video, reason) {
    const existing = this.data.unmatched.find(item => item.id === video.id);
    const payload = {
      id: video.id,
      title: video.title,
      fileName: video.fileName,
      reason,
      lastAttempt: new Date().toISOString()
    };
    if (existing) {
      Object.assign(existing, payload);
    } else {
      this.data.unmatched.push(payload);
    }
  }

  clearUnmatched(videoId) {
    this.data.unmatched = this.data.unmatched.filter(item => item.id !== videoId);
  }

  async fetchMetadata(query) {
    if (!TMDB_API_KEY) {
      return { error: 'TMDB_API_KEY tanımlı değil' };
    }

    try {
      const searchParams = new URLSearchParams({
        api_key: TMDB_API_KEY,
        query: query.title,
        include_adult: 'true',
        language: 'tr-TR'
      });
      if (query.year) {
        searchParams.set('year', query.year);
      }
      const searchUrl = `https://api.themoviedb.org/3/search/movie?${searchParams.toString()}`;
      const searchResponse = await fetch(searchUrl);
      if (!searchResponse.ok) {
        return { error: `TMDB araması başarısız (${searchResponse.status})` };
      }
      const searchData = await searchResponse.json();
      if (!searchData.results || searchData.results.length === 0) {
        return { error: 'TMDB üzerinde sonuç bulunamadı' };
      }

      let candidate = searchData.results[0];
      if (query.year) {
        const exactYear = searchData.results.find(item => (item.release_date || '').startsWith(query.year));
        if (exactYear) {
          candidate = exactYear;
        }
      }

      const detailParams = new URLSearchParams({
        api_key: TMDB_API_KEY,
        language: 'tr-TR'
      });
      const detailUrl = `https://api.themoviedb.org/3/movie/${candidate.id}?${detailParams.toString()}`;
      const detailResponse = await fetch(detailUrl);
      if (!detailResponse.ok) {
        return { error: `TMDB detay isteği başarısız (${detailResponse.status})` };
      }
      let detailData = await detailResponse.json();

      if (!detailData.overview) {
        const fallbackUrl = `https://api.themoviedb.org/3/movie/${candidate.id}?api_key=${TMDB_API_KEY}&language=en-US`;
        const fallbackResponse = await fetch(fallbackUrl);
        if (fallbackResponse.ok) {
          const fallbackData = await fallbackResponse.json();
          detailData.overview = fallbackData.overview;
          detailData.tagline = detailData.tagline || fallbackData.tagline;
        }
      }

      const genres = Array.isArray(detailData.genres) ? detailData.genres.map(item => item.name) : [];
      const releaseYear = (detailData.release_date || candidate.release_date || query.year || '').slice(0, 4);
      const runtime = detailData.runtime ? formatRuntime(detailData.runtime) : '';
      const poster = detailData.poster_path ? `https://image.tmdb.org/t/p/w780${detailData.poster_path}` : '';
      const backdrop = detailData.backdrop_path ? `https://image.tmdb.org/t/p/original${detailData.backdrop_path}` : poster;

      return {
        title: detailData.title || candidate.title || query.title,
        originalTitle: detailData.original_title || candidate.original_title || query.title,
        year: releaseYear,
        duration: runtime,
        description: detailData.overview || '',
        poster,
        backdrop,
        tags: genres,
        collection: genres[0] || 'Filmler',
        source: 'tmdb'
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  applyMetadata(video, metadata) {
    Object.assign(video, {
      title: metadata.title || video.title,
      originalTitle: metadata.originalTitle || metadata.title || video.originalTitle || video.title,
      year: metadata.year || video.year,
      duration: metadata.duration || video.duration,
      description: metadata.description || video.description,
      poster: metadata.poster || video.poster,
      backdrop: metadata.backdrop || video.backdrop,
      tags: metadata.tags || video.tags || [],
      collection: metadata.collection || video.collection || 'Diğer Videolar',
      source: metadata.source || video.source || 'manual',
      status: 'ready'
    });
    this.clearUnmatched(video.id);
  }

  async scan(options = {}) {
    if (this.scanning) {
      return this.data;
    }
    this.scanning = true;
    const { forceRefresh = false } = options;
    try {
      await this.load();
      const relativeFiles = await this.listMediaFiles();
      const seenIds = new Set();

      for (const relativePath of relativeFiles) {
        const parsed = parseFileName(relativePath);
        seenIds.add(parsed.id);
        let video = this.data.videos.find(item => item.id === parsed.id);
        if (!video) {
          video = {
            id: parsed.id,
            title: parsed.title,
            originalTitle: parsed.title,
            year: parsed.year,
            duration: '',
            description: '',
            poster: '',
            backdrop: '',
            collection: 'Diğer Videolar',
            tags: [],
            sources: [],
            subtitles: [],
            fileName: relativePath,
            createdAt: new Date().toISOString(),
            status: 'pending',
            source: 'auto'
          };
          this.data.videos.push(video);
        }

        video.fileName = relativePath;
        this.ensureSource(video, relativePath);
        await this.ensureSubtitles(video, relativePath);

        const shouldFetch = forceRefresh || !isMetadataComplete(video) || video.status !== 'ready';
        if (shouldFetch) {
          const metadata = await this.fetchMetadata(parsed);
          if (metadata && !metadata.error) {
            this.applyMetadata(video, metadata);
            video.status = 'ready';
            video.lastSync = new Date().toISOString();
          } else {
            video.status = video.status === 'ready' ? 'ready' : 'pending';
            const reason = metadata?.error || 'Bilinmeyen hata';
            this.markUnmatched(video, reason);
          }
        }
        
        // TMDB'den metadata çekildikten SONRA altyazı ara
        // (originalTitle TMDB'den geliyor ve genelde İngilizce)
        await this.tryFetchRemoteSubtitles(video, relativePath, parsed);
      }

      this.data.videos = this.data.videos.filter(video => {
        const exists = seenIds.has(video.id);
        if (!exists) {
          this.clearUnmatched(video.id);
        }
        return exists;
      });

      this.data.unmatched = this.data.unmatched.filter(item => seenIds.has(item.id));
      this.data.lastScan = new Date().toISOString();
      await this.save();
      return this.data;
    } finally {
      this.scanning = false;
    }
  }

  async getLibrary() {
    await this.load();
    return this.data;
  }

  async downloadSubtitleFromOpenSubtitles({ title, lang, year }) {
    if (!OPENSUBTITLES_API_KEY || !title || !lang) {
      return null;
    }

    // Login yaparak token al
    const token = await getOpenSubtitlesToken();
    if (!token) {
      console.warn('OpenSubtitles token alınamadı, altyazı indirme atlanıyor:', title);
      return null;
    }

    try {
      // 1. Arama yap
      const searchParams = new URLSearchParams({
        query: title,
        languages: lang,
        ai_translated: 'exclude',
        hearing_impaired: 'exclude',
        order_by: 'download_count',
        order_direction: 'desc',
        page: 1
      });
      if (year) {
        searchParams.set('year', String(year));
      }

      const searchUrl = `https://api.opensubtitles.com/api/v1/subtitles?${searchParams.toString()}`;
      const baseHeaders = {
        'Api-Key': OPENSUBTITLES_API_KEY,
        'User-Agent': OPENSUBTITLES_USER_AGENT,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Accept-Language': 'en'
      };

      const searchResponse = await fetchWithRetry(searchUrl, { headers: baseHeaders }, 3, 2000, 'arama');
      if (!searchResponse.ok) {
        const text = await searchResponse.text().catch(() => '');
        console.warn('OpenSubtitles arama hatası', searchResponse.status, text);
        return null;
      }

      const searchData = await searchResponse.json();
      const candidates = Array.isArray(searchData?.data) ? searchData.data : [];
      if (candidates.length === 0) {
        console.log(`OpenSubtitles'da "${title}" için ${lang} altyazı bulunamadı`);
        return null;
      }

      // En iyi match'i bul
      const match = candidates.find(item => {
        const files = item?.attributes?.files;
        return Array.isArray(files) && files.length > 0;
      });

      if (!match) {
        console.warn('OpenSubtitles sonuçlarında geçerli dosya bulunamadı:', title);
        return null;
      }

      const fileId = match.attributes.files[0].file_id;
      const fileName = match.attributes.files[0].file_name;
      
      console.log(`OpenSubtitles "${title}" için altyazı indiriliyor: ${fileName} (ID: ${fileId})`);

      // 2. İndirme linki al (Bearer token gerekli!)
      const authHeaders = {
        ...baseHeaders,
        'Authorization': `Bearer ${token}`
      };

      const downloadResponse = await fetchWithRetry('https://api.opensubtitles.com/api/v1/download', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ file_id: fileId })
      }, 3, 2000, 'indirme');
      
      if (!downloadResponse.ok) {
        const text = await downloadResponse.text().catch(() => '');
        
        if (downloadResponse.status === 429) {
          console.warn(`OpenSubtitles rate limit aşıldı: ${title} - 24 saat beklemek gerekebilir`);
        } else if (downloadResponse.status === 406) {
          console.warn(`OpenSubtitles indirme limiti aşıldı: ${title} - günlük limit dolmuş olabilir`);
        } else if (downloadResponse.status === 401) {
          console.warn(`OpenSubtitles authentication hatası: ${title} - token geçersiz olabilir`);
          // Token'ı resetle
          cachedToken = null;
          tokenExpiry = 0;
        } else {
          console.warn('OpenSubtitles indirme hatası', downloadResponse.status, text);
        }
        return null;
      }
      
      const downloadData = await downloadResponse.json();
      const link = downloadData?.link;
      if (!link) {
        console.warn('OpenSubtitles indirme linki sağlayamadı', downloadData);
        return null;
      }

      console.log(`OpenSubtitles indirme linki alındı, dosya indiriliyor: ${fileName}`);

      // 3. Dosyayı indir
      const fileResponse = await fetchWithRetry(link, {
        headers: {
          'Accept': 'application/octet-stream',
          'User-Agent': OPENSUBTITLES_USER_AGENT
        }
      }, 3, 2000, 'dosya');

      if (!fileResponse.ok) {
        const text = await fileResponse.text().catch(() => '');
        console.warn('OpenSubtitles dosya indirme hatası', fileResponse.status, text);
        return null;
      }
      
      const buffer = Buffer.from(await fileResponse.arrayBuffer());
      
      // Dosya boyutu kontrolü
      if (buffer.length < 50) {
        console.warn(`OpenSubtitles dosya çok küçük (${buffer.length} bytes): ${fileName} - hata mesajı olabilir`);
        return null;
      }
      
      // Dosyayı decode et
      const decoded = await decodeSubtitlePayload(buffer, fileResponse, fileName);
      if (!decoded) {
        console.warn('OpenSubtitles dosya decode edilemedi:', fileName);
        return null;
      }
      
      // Hata içeriği kontrolü
      const previewText = decoded.slice(0, 200).toLowerCase();
      if (previewText.includes('error occurred') || previewText.includes('an error occured') || 
          previewText.includes('not found') || previewText.includes('service unavailable')) {
        console.warn(`OpenSubtitles hata içeriği tespit edildi: ${fileName}`);
        return null;
      }

      // VTT formatına çevir
      const ext = path.extname(fileName).toLowerCase();
      const content = normalizeSubtitleToVtt(decoded, ext === '.vtt' ? 'vtt' : 'srt', `remote:${title}:${lang}:${fileName}`);
      if (!content) {
        console.warn('OpenSubtitles altyazı VTT formatına çevrilemedi:', fileName);
        return null;
      }

      console.log(`OpenSubtitles altyazı başarıyla indirildi: ${fileName} (${buffer.length} bytes)`);
      return { content, format: 'vtt' };

    } catch (error) {
      console.warn('OpenSubtitles isteği başarısız', error.message);
      return null;
    }
  }

  async downloadSubtitleFromSubdl({ title, lang, year, type }) {
    if (!SUBDL_API_KEY || !title || !lang) {
      return null;
    }

    const params = new URLSearchParams({
      api_key: SUBDL_API_KEY,
      film_name: title,
      languages: lang.toUpperCase()
    });

    if (year) {
      params.set('year', String(year));
    }
    if (type) {
      params.set('type', type);
    }

    const url = `https://api.subdl.com/api/v1/subtitles?${params.toString()}`;

    try {
      const response = await fetchWithRetry(url, {
        headers: { Accept: 'application/json' }
      }, 2, 1500, 'subdl-arama');

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.warn('SubDL arama hatası', response.status, text);
        return null;
      }

      const payload = await response.json().catch(() => null);
      if (!payload || payload.status === false) {
        console.warn('SubDL beklenmeyen yanıt', payload?.error || payload);
        return null;
      }

      const subtitles = Array.isArray(payload.subtitles) ? payload.subtitles : [];
      if (subtitles.length === 0) {
        console.log(`SubDL üzerinde "${title}" için ${lang.toUpperCase()} altyazı bulunamadı`);
        return null;
      }

      const normalizedLang = lang.toLowerCase();
      const candidate = subtitles.find(item => normalizeSubdlLanguage(item.language_code || item.language || item.lang) === normalizedLang) || subtitles[0];

      const downloadLink = buildSubdlDownloadLink(candidate);
      if (!downloadLink) {
        console.warn('SubDL indirecek link bulunamadı', candidate);
        return null;
      }

      const fileResponse = await fetchWithRetry(downloadLink, {
        headers: { Accept: 'application/octet-stream' }
      }, 2, 2000, 'subdl-indirme');

      if (!fileResponse.ok) {
        const text = await fileResponse.text().catch(() => '');
        console.warn('SubDL indirme hatası', fileResponse.status, text);
        return null;
      }

      const buffer = Buffer.from(await fileResponse.arrayBuffer());
      if (!buffer || buffer.length === 0) {
        console.warn('SubDL boş dosya döndürdü');
        return null;
      }

      let zip;
      try {
        zip = await JSZip.loadAsync(buffer);
      } catch (error) {
        console.warn('SubDL zip dosyası açılamadı', error.message);
        return null;
      }

      const files = Object.values(zip.files || {}).filter(file => !file.dir);
      if (files.length === 0) {
        console.warn('SubDL zip içerisinde dosya bulunamadı');
        return null;
      }

      const preferred = files.find(file => /\.(srt|vtt)$/i.test(file.name)) || files[0];
      const fileBuffer = await preferred.async('nodebuffer');
      const decoded = decodeBufferToUtf8(fileBuffer);
      const ext = preferred.name.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
      const content = normalizeSubtitleToVtt(decoded, ext, `subdl:${title}:${lang}:${preferred.name}`);
      if (!content) {
        console.warn('SubDL altyazı dönüştürülemedi', preferred.name);
        return null;
      }

      return { content, format: 'vtt' };
    } catch (error) {
      console.warn('SubDL isteği başarısız', error.message);
      return null;
    }
  }

  async storeSubtitleContent({ rawContent, format, lang, baseName, relativeDir, origin }) {
    const normalized = normalizeSubtitleToVtt(rawContent, format === 'vtt' ? 'vtt' : 'srt', origin);
    if (!normalized) {
      return false;
    }

    const fileName = lang ? `${baseName}.${lang}.vtt` : `${baseName}.vtt`;
    const relativeFile = relativeDir ? path.join(relativeDir, fileName) : fileName;
    const absoluteFile = path.join(MEDIA_DIR, relativeFile);
    await fs.mkdir(path.dirname(absoluteFile), { recursive: true });
    await fs.writeFile(absoluteFile, normalized, 'utf-8');
    console.log(`Altyazı kaydedildi: ${relativeFile}`);
    return true;
  }

  async downloadSubtitlesWithScript({ query, baseName, relativeDir }) {
    const scriptPath = path.join(__dirname, '..', 'scripts', 'ta_downloader.py');
    try {
      await fs.access(scriptPath);
    } catch (error) {
      console.warn('Altyazı scripti bulunamadı:', scriptPath);
      return false;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hv-sub-'));
    let success = false;

    try {
      const args = ['-q', query, '-o', tempDir];
      const { stdout, stderr } = await execFileAsync('python3', [scriptPath, ...args], {
        env: process.env,
        maxBuffer: 10 * 1024 * 1024
      });

      if (stdout) {
        console.log(stdout.trim());
      }
      if (stderr) {
        console.warn(stderr.trim());
      }

      const languageDirs = [
        { dir: 'turkish_subtitles', lang: 'tr' },
        { dir: 'english_subtitles', lang: 'en' }
      ];

      for (const { dir, lang } of languageDirs) {
        const absoluteDir = path.join(tempDir, dir);
        let stat;
        try {
          stat = await fs.stat(absoluteDir);
        } catch (error) {
          continue;
        }
        if (!stat.isDirectory()) {
          continue;
        }
        const entries = await fs.readdir(absoluteDir).catch(() => []);
        for (const entry of entries) {
          const entryPath = path.join(absoluteDir, entry);
          const entryStat = await fs.stat(entryPath).catch(() => null);
          if (!entryStat || !entryStat.isFile()) {
            continue;
          }
          try {
            const buffer = await fs.readFile(entryPath);
            const decoded = decodeBufferToUtf8(buffer);
            const ext = entry.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
            const stored = await this.storeSubtitleContent({
              rawContent: decoded,
              format: ext,
              lang,
              baseName,
              relativeDir,
              origin: `script:${query}:${lang}:${entry}`
            });
            if (stored) {
              success = true;
            }
          } catch (error) {
            console.warn('Script altyazısı kaydedilemedi:', error.message || error);
          }
        }
      }
    } catch (error) {
      console.warn('Altyazı scripti çalıştırılamadı:', error.message || error);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    return success;
  }

  async getSubtitleEntry(videoId, trackId) {
    await this.load();
    const video = this.data.videos.find(item => item.id === videoId);
    if (!video || !Array.isArray(video.subtitles)) {
      return null;
    }
    const track = video.subtitles.find(item => item.id === trackId);
    if (!track || !track.file) {
      return null;
    }
    const absolute = path.join(MEDIA_DIR, track.file);
    return { video, track, absolute };
  }

  async getSubtitleContent(videoId, trackId) {
    const entry = await this.getSubtitleEntry(videoId, trackId);
    if (!entry) {
      return null;
    }
    let raw;
    try {
      const buffer = await fs.readFile(entry.absolute);
      raw = decodeBufferToUtf8(buffer);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    const body = normalizeSubtitleToVtt(raw, entry.track.format === 'srt' ? 'srt' : 'vtt', `stream:${entry.track.file}`);
    if (!body) {
      return null;
    }
    return { ...entry, body };
  }

  async renameVideo(id, newTitle) {
    await this.load();
    const video = this.data.videos.find(item => item.id === id);
    if (!video) {
      throw new Error('Video bulunamadı');
    }
    
    const oldFileName = video.fileName;
    if (!oldFileName) {
      throw new Error('Video dosya adı bulunamadı');
    }

    // Eski dosya yolu
    const oldPath = path.join(MEDIA_DIR, oldFileName);
    const oldDir = path.dirname(oldPath);
    const oldExt = path.extname(oldPath);
    
    // Yeni dosya adı oluştur (güvenli karakterler)
    const safeNewTitle = newTitle
      .replace(/[<>:"/\\|?*]/g, '') // Yasak karakterleri kaldır
      .replace(/\s+/g, ' ')
      .trim();
    
    // Yıl varsa koru
    const yearSuffix = video.year ? ` (${video.year})` : '';
    const newFileName = `${safeNewTitle}${yearSuffix}${oldExt}`;
    const newPath = path.join(oldDir, newFileName);
    
    // Dosyanın gerçekten var olup olmadığını kontrol et
    try {
      await fs.access(oldPath);
    } catch (error) {
      console.warn(`Dosya bulunamadı: ${oldPath}`);
      // Dosya yoksa sadece metadata güncelle
      video.title = newTitle;
      video.originalTitle = newTitle;
      video.lastManualUpdate = new Date().toISOString();
      
      // TMDB'den bilgi çekmeyi dene
      const parsed = parseFileName(newTitle);
      const metadata = await this.fetchMetadata(parsed);
      if (metadata && !metadata.error) {
        this.applyMetadata(video, metadata);
        video.status = 'ready';
        video.lastSync = new Date().toISOString();
      } else {
        if (video.status === 'pending') {
          video.status = 'ready';
        }
        this.clearUnmatched(video.id);
      }
      
      await this.save();
      return video;
    }
    
    // Dosyayı yeniden adlandır
    try {
      await fs.rename(oldPath, newPath);
      console.log(`✓ Dosya yeniden adlandırıldı: ${oldFileName} -> ${newFileName}`);
      
      // Altyazı dosyalarını da yeniden adlandır
      await this.renameSubtitleFiles(video, oldPath, newPath, safeNewTitle);
      
      // Video metadata güncelle
      const newRelativePath = path.relative(MEDIA_DIR, newPath);
      video.fileName = newRelativePath;
      video.title = newTitle;
      video.originalTitle = newTitle;
      video.lastManualUpdate = new Date().toISOString();
      
      // Kaynakları güncelle
      this.ensureSource(video, newRelativePath);
      
      // Altyazıları yeniden tara
      await this.ensureSubtitles(video, newRelativePath);
      
      // TMDB'den bilgi çekmeyi dene
      const parsed = parseFileName(newTitle + yearSuffix);
      const metadata = await this.fetchMetadata(parsed);
      if (metadata && !metadata.error) {
        this.applyMetadata(video, metadata);
        video.status = 'ready';
        video.lastSync = new Date().toISOString();
        console.log(`✓ TMDB'den bilgiler alındı: ${metadata.title}`);
      } else {
        console.log(`⚠ TMDB'de bulunamadı: ${newTitle}`);
        if (video.status === 'pending') {
          video.status = 'ready';
        }
        this.clearUnmatched(video.id);
      }
      
      await this.save();
      return video;
    } catch (error) {
      console.error(`Dosya yeniden adlandırılamadı: ${error.message}`);
      throw new Error(`Dosya yeniden adlandırılamadı: ${error.message}`);
    }
  }

  async renameSubtitleFiles(video, oldVideoPath, newVideoPath, newBaseName) {
    const oldDir = path.dirname(oldVideoPath);
    const newDir = path.dirname(newVideoPath);
    const oldBaseName = path.parse(oldVideoPath).name;
    const newVideoBaseName = path.parse(newVideoPath).name;
    
    // Dizindeki tüm altyazı dosyalarını bul
    let entries = [];
    try {
      entries = await fs.readdir(oldDir, { withFileTypes: true });
    } catch (error) {
      console.warn(`  ⚠ Dizin okunamadı: ${oldDir}`);
      return;
    }
    
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      
      const ext = path.extname(entry.name).toLowerCase();
      if (!SUBTITLE_EXTENSIONS.has(ext)) continue;
      
      const candidateBase = path.parse(entry.name).name;
      
      // Eski video adıyla başlayan altyazı dosyalarını bul
      if (!candidateBase.toLowerCase().startsWith(oldBaseName.toLowerCase())) {
        continue;
      }
      
      const oldSubPath = path.join(oldDir, entry.name);
      
      // Dil kodunu tespit et (örn: .tr veya .en)
      const remainder = candidateBase.slice(oldBaseName.length).replace(/^[._-]+/, '');
      const langMatch = remainder.match(/^([a-z]{2})\b/i);
      const langSuffix = langMatch ? `.${langMatch[1]}` : (remainder ? `.${remainder}` : '');
      
      // Yeni altyazı dosya adı
      const newSubFileName = `${newVideoBaseName}${langSuffix}${ext}`;
      const newSubPath = path.join(newDir, newSubFileName);
      
      try {
        await fs.rename(oldSubPath, newSubPath);
        console.log(`  ✓ Altyazı yeniden adlandırıldı: ${entry.name} -> ${newSubFileName}`);
      } catch (error) {
        console.warn(`  ⚠ Altyazı yeniden adlandırılamadı: ${entry.name} (${error.message})`);
      }
    }
  }

  async updateManualMetadata(id, payload) {
    await this.load();
    const video = this.data.videos.find(item => item.id === id);
    if (!video) {
      throw new Error('Video bulunamadı');
    }
    const metadata = {
      title: payload.title || video.title,
      originalTitle: payload.originalTitle || payload.title || video.originalTitle,
      year: payload.year || video.year,
      duration: payload.duration || video.duration,
      description: payload.description || video.description,
      poster: payload.poster || video.poster,
      backdrop: payload.backdrop || payload.poster || video.backdrop,
      tags: Array.isArray(payload.tags) ? payload.tags : (typeof payload.tags === 'string' ? payload.tags.split(',').map(tag => tag.trim()).filter(Boolean) : video.tags),
      collection: payload.collection || video.collection,
      source: 'manual'
    };
    this.applyMetadata(video, metadata);
    video.lastManualUpdate = new Date().toISOString();
    await this.save();
    return video;
  }
}

module.exports = {
  LibraryManager,
  parseFileName,
  formatRuntime
};
