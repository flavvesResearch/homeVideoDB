const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const Aria2 = require('aria2');

const fetch = global.fetch
  ? global.fetch.bind(global)
  : ((...args) => import('node-fetch').then(({ default: nodeFetch }) => nodeFetch(...args)));

const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.opentrackr.org:1337',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.cyberia.is:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://open.demonii.com:1337/announce'
];

function buildMagnetLink({ infoHash, name }) {
  if (!infoHash) {
    return null;
  }
  const trackers = DEFAULT_TRACKERS.map(tracker => `&tr=${encodeURIComponent(tracker)}`).join('');
  const encodedName = name ? `&dn=${encodeURIComponent(name)}` : '';
  return `magnet:?xt=urn:btih:${infoHash}${encodedName}${trackers}`;
}

function extractInfoHash(magnet) {
  if (!magnet || typeof magnet !== 'string') {
    return null;
  }
  const match = magnet.match(/btih:([^&]+)/i);
  if (!match) {
    return null;
  }
  const value = match[1] || '';
  try {
    return decodeURIComponent(value).toLowerCase();
  } catch (error) {
    return value.toLowerCase();
  }
}

function normaliseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchApibay(query) {
  const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=207`;
  const start = Date.now();
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Torrent araması başarısız (apibay: ${response.status})`);
    }
    const text = await response.text();
    let payload = [];
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error('Torrent arama yanıtı çözümlenemedi');
    }
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload
      .filter(item => item && item.name && item.info_hash)
      .map(item => {
        const infoHash = (item.info_hash || '').toLowerCase();
        const name = item.name || infoHash;
        const magnet = buildMagnetLink({ infoHash, name });
        return {
          id: infoHash,
          name,
          magnet,
          infoHash,
          provider: 'apibay',
          seeders: normaliseNumber(item.seeders),
          leechers: normaliseNumber(item.leechers),
          size: normaliseNumber(item.size),
          verified: item.status === 'verified',
          responseTime: Date.now() - start
        };
      })
      .filter(item => item.magnet);
  } catch (error) {
    console.warn('Apibay araması başarısız:', error.message);
    return [];
  }
}

async function searchYts(query) {
  const url = `https://yts.mx/api/v2/list_movies.json?limit=20&query_term=${encodeURIComponent(query)}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`YTS araması başarısız (${response.status})`);
    }
    const payload = await response.json();
    const movies = payload?.data?.movies;
    if (!Array.isArray(movies)) {
      return [];
    }
    const results = [];
    movies.forEach(movie => {
      if (!Array.isArray(movie.torrents)) return;
      movie.torrents.forEach(torrent => {
        const infoHash = (torrent.hash || '').toLowerCase();
        if (!infoHash) return;
        const name = `${movie.title_long || movie.title} [${torrent.quality || ''}${torrent.type ? ` ${torrent.type}` : ''}]`.trim();
        const magnet = buildMagnetLink({ infoHash, name });
        if (!magnet) return;
        results.push({
          id: infoHash,
          name,
          magnet,
          infoHash,
          provider: 'yts',
          seeders: normaliseNumber(torrent.seeds),
          leechers: normaliseNumber(torrent.peers),
          size: normaliseNumber(torrent.size_bytes),
          quality: torrent.quality,
          type: torrent.type,
          year: movie.year,
          verified: true
        });
      });
    });
    return results;
  } catch (error) {
    console.warn('YTS araması başarısız:', error.message);
    return [];
  }
}

async function searchTorrents(query) {
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return [];
  }
  const trimmed = query.trim();
  const [apibayResults, ytsResults] = await Promise.all([searchApibay(trimmed), searchYts(trimmed)]);
  const merged = [...apibayResults, ...ytsResults];
  const seen = new Set();
  const deduped = [];
  for (const item of merged) {
    const key = item.infoHash || item.id || item.magnet;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(item);
  }
  deduped.sort((a, b) => {
    const seedDiff = (b.seeders || 0) - (a.seeders || 0);
    if (seedDiff !== 0) return seedDiff;
    return (b.size || 0) - (a.size || 0);
  });
  return deduped.slice(0, 30);
}

function mapAriaStatus(status) {
  switch (status) {
    case 'active':
    case 'seeding':
      return 'downloading';
    case 'waiting':
      return 'starting';
    case 'paused':
    case 'pausedDL':
    case 'pausedUP':
      return 'paused';
    case 'complete':
      return 'completed';
    case 'removed':
      return 'cancelled';
    case 'error':
      return 'failed';
    default:
      return 'starting';
  }
}

function formatAriaError(error) {
  if (!error) return null;
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  return null;
}

class TorrentManager {
  constructor({ mediaDir, libraryManager, aria2Binary } = {}) {
    if (!mediaDir) {
      throw new Error('mediaDir parametresi zorunludur');
    }
    this.mediaDir = mediaDir;
    this.libraryManager = libraryManager;
    this.downloadRoot = path.join(mediaDir, 'downloads');
    this.binary = aria2Binary || process.env.ARIA2_BINARY || 'aria2c';
    this.port = Number.parseInt(process.env.ARIA2_RPC_PORT || '6800', 10) || 6800;
    this.secret = process.env.ARIA2_RPC_SECRET || crypto.randomBytes(18).toString('hex');
    this.sessionFile = process.env.ARIA2_SESSION_FILE || path.join(this.mediaDir, 'aria2.session');
    this.process = null;
    this.aria2 = null;
    this.available = false;
    this.startupError = null;
    this.downloads = new Map();
    this.hooksRegistered = false;
    this.readyPromise = this.initialize();
  }

  async initialize() {
    try {
      await fs.mkdir(this.downloadRoot, { recursive: true });
      await fs.mkdir(path.dirname(this.sessionFile), { recursive: true });
    } catch (error) {
      console.warn('İndirme klasörü oluşturulamadı:', error.message);
    }

    try {
      await this.spawnAria2();
      await this.connectClient();
      this.available = true;
      this.registerShutdownHooks();
      await this.hydrateExistingDownloads();
    } catch (error) {
      this.startupError = error.message || 'aria2 başlatılamadı';
      this.available = false;
      console.warn('Torrent indirme devre dışı bırakıldı:', this.startupError);
    }
  }

  async spawnAria2() {
    const args = [
      '--enable-rpc=true',
      `--rpc-listen-port=${this.port}`,
      '--rpc-listen-all=false',
      `--rpc-secret=${this.secret}`,
      `--dir=${this.downloadRoot}`,
      `--stop-with-process=${process.pid}`,
      '--continue=true',
      '--allow-overwrite=true',
      '--auto-file-renaming=false',
      '--seed-time=0',
      '--bt-stop-timeout=0',
      '--max-overall-upload-limit=0',
      '--max-upload-limit=0',
      '--quiet=true',
      `--input-file=${this.sessionFile}`,
      `--save-session=${this.sessionFile}`,
      '--save-session-interval=30',
      '--force-save=true'
    ];

    try {
      const child = spawn(this.binary, args, {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', chunk => {
        const text = chunk.toString().trim();
        if (text) {
          console.log(`[aria2c] ${text}`);
        }
      });
      child.stderr.on('data', chunk => {
        const text = chunk.toString().trim();
        if (text) {
          console.warn(`[aria2c] ${text}`);
        }
      });
      child.on('exit', (code, signal) => {
        this.available = false;
        const reason = signal ? `sinyal ${signal}` : `kod ${code}`;
        console.warn(`aria2c işlemi sona erdi (${reason}).`);
      });
      child.on('error', error => {
        const message = error?.code === 'ENOENT'
          ? 'aria2c bulunamadı. Lütfen sistemine aria2 paketini kur ve PATH değişkenine ekle.'
          : `aria2c başlatılamadı: ${error?.message || error}`;
        this.startupError = message;
        this.available = false;
      });
      this.process = child;

      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('aria2c bulunamadı. Lütfen sistemine aria2 paketini kur ve PATH değişkenine ekle.');
      }
      throw error;
    }
  }

  async connectClient() {
    const client = new Aria2({
      host: '127.0.0.1',
      port: this.port,
      secret: this.secret,
      path: '/jsonrpc'
    });

    let connected = false;
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        await client.open();
        connected = true;
        break;
      } catch (error) {
        await wait(400);
      }
    }

    if (!connected) {
      this.aria2 = client; // HTTP fallback
      throw new Error('aria2 RPC arayüzüne bağlanılamadı. Aracı manuel olarak başlatmayı deneyin.');
    }

    client.on('onDownloadComplete', async params => {
      const gid = params?.[0]?.gid;
      if (!gid) return;
      await this.refreshDownloadStatuses([gid]);
    });

    client.on('onDownloadError', async params => {
      const gid = params?.[0]?.gid;
      if (!gid) return;
      await this.refreshDownloadStatuses([gid]);
    });

    client.on('error', error => {
      console.warn('aria2 istemci hatası:', error?.message || error);
    });

    this.aria2 = client;
  }

  async ensureReady() {
    if (this.readyPromise) {
      await this.readyPromise;
    }
    if (!this.available || !this.aria2) {
      const error = this.startupError || 'Torrent indirme sistemi şu anda kullanılamıyor.';
      throw new Error(error);
    }
  }

  async startDownload({ magnet, name, provider, size }) {
    if (!magnet) {
      throw new Error('Magnet link zorunludur');
    }
    await this.ensureReady();

    const infoHash = extractInfoHash(magnet);
    const duplicate = [...this.downloads.values()].find(item => {
      if (!item || ['failed', 'cancelled', 'completed'].includes(item.status)) {
        return false;
      }
      if (item.magnet && item.magnet === magnet) {
        return true;
      }
      if (infoHash && item.infoHash && item.infoHash === infoHash) {
        return true;
      }
      return false;
    });
    if (duplicate) {
      throw new Error('Bu torrent zaten indiriliyor');
    }

    [...this.downloads.entries()]
      .filter(([, item]) => {
        if (!item) return false;
        if (!['failed', 'cancelled', 'completed'].includes(item.status)) return false;
        if (item.magnet && item.magnet === magnet) return true;
        if (infoHash && item.infoHash && item.infoHash === infoHash) return true;
        return false;
      })
      .forEach(([gid]) => {
        this.downloads.delete(gid);
      });

    const safeName = (name || '').toString().trim() || 'Yeni İndirme';
    const addedAt = new Date().toISOString();

    let gid;
    try {
      gid = await this.aria2.call('addUri', [magnet], {
        dir: this.downloadRoot,
        'max-connection-per-server': '16',
        'split': '16',
        'bt-stop-timeout': '0',
        'seed-time': '0',
        'follow-torrent': 'mem'
      });
    } catch (error) {
      throw new Error(error?.message || 'İndirme başlatılamadı');
    }

    const record = {
      id: gid,
      gid,
      magnet,
      infoHash,
      name: safeName,
      provider: provider || 'unknown',
      size: Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : null,
      status: 'starting',
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      eta: null,
      peers: 0,
      bytesDownloaded: 0,
      addedAt,
      completedAt: null,
      error: null,
      finalFiles: [],
      finalPath: this.downloadRoot,
      libraryRefreshAt: null,
      rescanTriggered: false,
      finalized: false,
      isMetadataStub: false
    };

    this.downloads.set(gid, record);
    await this.refreshDownloadStatuses([gid]);
    const current = this.downloads.get(gid);
    if (current) {
      return this.summarize(current);
    }
    const child = [...this.downloads.values()].find(item => item.parentGid === gid);
    if (child) {
      return this.summarize(child);
    }
    return this.summarize(record);
  }

  summarize(record) {
    if (!record) return null;
    return {
      id: record.id,
      name: record.name,
      provider: record.provider,
      status: record.status,
      progress: Number.isFinite(record.progress) ? Number(record.progress.toFixed(4)) : 0,
      downloadSpeed: Math.max(0, Math.round(record.downloadSpeed || 0)),
      uploadSpeed: Math.max(0, Math.round(record.uploadSpeed || 0)),
      bytesDownloaded: Math.max(0, Math.round(record.bytesDownloaded || 0)),
      size: record.size ? Math.max(0, Math.round(record.size)) : null,
      eta: record.eta != null && Number.isFinite(record.eta) ? Math.max(0, Math.round(record.eta)) : null,
      peers: Math.max(0, Math.round(record.peers || 0)),
      addedAt: record.addedAt,
      completedAt: record.completedAt,
      error: record.error || null,
      finalFiles: Array.isArray(record.finalFiles) ? record.finalFiles : [],
      finalPath: record.finalPath || null,
      libraryRefreshAt: record.libraryRefreshAt || null
    };
  }

  async listDownloads() {
    await this.readyPromise;
    if (this.available && this.downloads.size > 0) {
      await this.refreshDownloadStatuses();
    }
    return [...this.downloads.values()]
      .filter(item => !item.isMetadataStub)
      .map(item => this.summarize(item))
      .filter(Boolean);
  }

  async refreshDownloadStatuses(gids = null) {
    if (!this.available || !this.aria2) {
      return;
    }
    const baseTargets = Array.isArray(gids) && gids.length > 0
      ? gids
      : [...this.downloads.entries()]
          .filter(([, item]) => !item?.finalized)
          .map(([gid]) => gid);
    const target = baseTargets.filter(Boolean);
    if (target.length === 0) {
      return;
    }

    const calls = target.map(gid => [
      'tellStatus',
      gid,
      [
        'gid',
        'status',
        'totalLength',
        'completedLength',
        'downloadSpeed',
        'uploadSpeed',
        'connections',
        'numSeeders',
        'errorMessage',
        'dir',
        'files',
        'followedBy',
        'bittorrent',
        'infoHash'
      ]
    ]);

    let results;
    try {
      const batchPromises = await this.aria2.batch(calls);
      results = await Promise.all(batchPromises);
    } catch (error) {
      console.warn('aria2 durum bilgisi alınamadı:', error?.message || error);
      return;
    }

    const metadataToRemove = new Set();
    const newChildGids = [];

    for (let index = 0; index < target.length; index += 1) {
      const status = results[index];
      const gid = target[index];
      if (!status || !gid) continue;
      let record = this.downloads.get(gid);
      if (!record) {
        const created = this.createRecordFromStatus(status, gid);
        if (!created) {
          continue;
        }
        record = created;
        this.downloads.set(gid, record);
      }

      const followedBy = Array.isArray(status.followedBy)
        ? status.followedBy.filter(Boolean)
        : status.followedBy
          ? [status.followedBy].filter(Boolean)
          : [];

      if (followedBy.length > 0) {
        followedBy.forEach(childGid => {
          if (!childGid || this.downloads.has(childGid)) {
            return;
          }
          const childRecord = {
            ...record,
            id: childGid,
            gid: childGid,
            status: 'starting',
            progress: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
            bytesDownloaded: 0,
            eta: null,
            peers: 0,
            completedAt: null,
            error: null,
            finalFiles: [],
            parentGid: record.id,
            infoHash: record.infoHash || null,
            magnet: record.magnet || null,
            isMetadataStub: false,
            rescanTriggered: false,
            finalized: false
          };
          this.downloads.set(childGid, childRecord);
          newChildGids.push(childGid);
        });
        metadataToRemove.add(record.id);
        continue;
      }

      const total = Number.parseInt(status.totalLength || '0', 10) || 0;
      const completed = Number.parseInt(status.completedLength || '0', 10) || 0;
      const downloadSpeed = Number.parseInt(status.downloadSpeed || '0', 10) || 0;
      const uploadSpeed = Number.parseInt(status.uploadSpeed || '0', 10) || 0;
      const connections = Number.parseInt(status.numSeeders || status.connections || '0', 10) || 0;
      const progress = total > 0 ? completed / total : status.status === 'complete' ? 1 : 0;

      record.status = mapAriaStatus(status.status);
      record.size = total || record.size || null;
      record.bytesDownloaded = completed;
      record.downloadSpeed = downloadSpeed;
      record.uploadSpeed = uploadSpeed;
      record.progress = Number.isFinite(progress) ? progress : 0;
      record.peers = connections;
      record.eta = downloadSpeed > 0 && total > 0 ? Math.max(0, Math.round((total - completed) / downloadSpeed)) : null;
      record.error = record.status === 'failed' ? formatAriaError(status.errorMessage) : null;

      if (!record.infoHash && status.infoHash) {
        record.infoHash = status.infoHash.toLowerCase();
      }

      if (!record.magnet && record.infoHash) {
        record.magnet = buildMagnetLink({ infoHash: record.infoHash, name: record.name });
      }

      const torrentName = status?.bittorrent?.info?.name;
      if (torrentName) {
        record.name = torrentName;
      }

      if (status.dir) {
        record.finalPath = status.dir;
      }

      if (Array.isArray(status.files)) {
        record.finalFiles = status.files.map(file => {
          const absolute = file.path || '';
          const relative = path.relative(this.mediaDir, absolute) || path.basename(absolute);
          const length = Number.parseInt(file.length || file.completedLength || '0', 10) || null;
          return { absolute, relative, size: length };
        });
      }

      if (record.status === 'completed' && !record.completedAt) {
        record.completedAt = new Date().toISOString();
        this.triggerRescan(record);
      }

      record.finalized = record.status === 'completed' || record.status === 'cancelled';
    }

    if (metadataToRemove.size > 0) {
      metadataToRemove.forEach(gid => {
        this.downloads.delete(gid);
      });
    }

    if (newChildGids.length > 0) {
      await this.refreshDownloadStatuses(newChildGids);
    }
  }

  triggerRescan(record) {
    if (!this.libraryManager || record.rescanTriggered) {
      return;
    }
    record.rescanTriggered = true;
    this.libraryManager
      .scan({ forceRefresh: true })
      .then(() => {
        record.libraryRefreshAt = new Date().toISOString();
      })
      .catch(error => {
        console.warn('Kütüphane güncelleme başarısız:', error?.message || error);
      });
  }

  registerShutdownHooks() {
    if (this.hooksRegistered) {
      return;
    }
    this.hooksRegistered = true;

    const saveSession = async () => {
      if (!this.aria2) {
        return;
      }
      try {
        await this.aria2.call('saveSession');
      } catch (error) {
        // Yoksay, kapanış devam etsin.
      }
    };

    process.once('exit', () => {
      saveSession().catch(() => {});
    });

    const handleSignal = () => {
      saveSession()
        .catch(() => {})
        .finally(() => {
          process.exit(0);
        });
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
  }

  createRecordFromStatus(status, gid) {
    if (!status || !gid) {
      return null;
    }
    const total = Number.parseInt(status.totalLength || '0', 10) || 0;
    const completed = Number.parseInt(status.completedLength || '0', 10) || 0;
    const mappedStatus = mapAriaStatus(status.status);
    const infoHash = status.infoHash ? status.infoHash.toLowerCase() : null;
    const name = status?.bittorrent?.info?.name
      || (Array.isArray(status.files) && status.files[0]?.path
        ? path.basename(status.files[0].path)
        : `İndirme ${gid}`);

    return {
      id: gid,
      gid,
      magnet: infoHash ? buildMagnetLink({ infoHash, name }) : null,
      infoHash,
      name,
      provider: 'unknown',
      size: total || null,
      status: mappedStatus,
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      eta: null,
      peers: 0,
      bytesDownloaded: completed,
      addedAt: new Date().toISOString(),
      completedAt: mappedStatus === 'completed' ? new Date().toISOString() : null,
      error: null,
      finalFiles: [],
      finalPath: status.dir || this.downloadRoot,
      libraryRefreshAt: null,
      rescanTriggered: false,
      finalized: mappedStatus === 'completed' || mappedStatus === 'cancelled',
      isMetadataStub: false,
      parentGid: null
    };
  }

  async hydrateExistingDownloads() {
    if (!this.aria2) {
      return;
    }
    try {
      const requests = [
        this.aria2.call('tellActive'),
        this.aria2.call('tellWaiting', 0, 1000)
      ];
      let stopped = [];
      try {
        const stoppedResult = await this.aria2.call('tellStopped', 0, 1000);
        stopped = Array.isArray(stoppedResult) ? stoppedResult : [];
      } catch (error) {
        stopped = [];
      }
      const [active, waiting] = await Promise.all(requests);
      const candidates = [
        ...(Array.isArray(active) ? active : []),
        ...(Array.isArray(waiting) ? waiting : []),
        ...stopped.filter(item => item?.status && ['paused', 'pausedDL', 'pausedUP', 'waiting'].includes(item.status))
      ];
      const gids = [];
      for (const task of candidates) {
        const gid = task?.gid;
        if (!gid || this.downloads.has(gid)) {
          continue;
        }
        const record = this.createRecordFromStatus(task, gid);
        if (!record) {
          continue;
        }
        this.downloads.set(gid, record);
        gids.push(gid);
      }
      if (gids.length > 0) {
        await this.refreshDownloadStatuses(gids);
      }
    } catch (error) {
      console.warn('Varolan indirmeler yüklenemedi:', error.message);
    }
  }

  async pauseDownload(gid) {
    if (!gid) {
      throw new Error('gid zorunludur');
    }
    await this.ensureReady();
    try {
      await this.aria2.call('pause', gid);
    } catch (error) {
      throw new Error(error?.message || 'İndirme duraklatılamadı');
    }
    const record = this.downloads.get(gid);
    if (record) {
      record.status = 'paused';
      record.finalized = false;
    }
    await this.refreshDownloadStatuses([gid]);
    return this.summarize(this.downloads.get(gid) || record);
  }

  async resumeDownload(gid) {
    if (!gid) {
      throw new Error('gid zorunludur');
    }
    await this.ensureReady();
    try {
      await this.aria2.call('unpause', gid);
    } catch (error) {
      throw new Error(error?.message || 'İndirme devam ettirilemedi');
    }
    const record = this.downloads.get(gid);
    if (record) {
      record.status = 'starting';
      record.finalized = false;
    }
    await this.refreshDownloadStatuses([gid]);
    return this.summarize(this.downloads.get(gid) || record);
  }

  async cancelDownload(gid) {
    if (!gid) {
      throw new Error('gid zorunludur');
    }
    await this.ensureReady();
    try {
      await this.aria2.call('forceRemove', gid);
    } catch (error) {
      try {
        await this.aria2.call('remove', gid);
      } catch (inner) {
        throw new Error(inner?.message || error?.message || 'İndirme iptal edilemedi');
      }
    }

    const record = this.downloads.get(gid);
    if (record) {
      record.status = 'cancelled';
      record.finalized = true;
      record.completedAt = new Date().toISOString();
      record.error = null;
      record.downloadSpeed = 0;
      record.uploadSpeed = 0;
      record.eta = null;
    }

    [...this.downloads.entries()]
      .filter(([, item]) => item && item.parentGid === gid)
      .forEach(([childGid]) => this.downloads.delete(childGid));

    return this.summarize(record) || null;
  }

  getStatus() {
    return {
      available: this.available && !!this.aria2,
      message: this.available ? null : this.startupError || 'aria2 çalışmadığı için torrent indirme devre dışı.'
    };
  }
}

module.exports = {
  searchTorrents,
  TorrentManager
};
