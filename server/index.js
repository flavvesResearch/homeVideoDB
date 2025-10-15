const path = require('path');
const express = require('express');
const { LibraryManager } = require('./libraryManager');
const { TorrentManager, searchTorrents } = require('./torrentService');
const { StorageService } = require('./storageService');

const PORT = process.env.PORT || 3000;

async function createServer() {
  const app = express();
  const manager = new LibraryManager();
  await manager.load();
  await manager.scan();
  const torrentManager = new TorrentManager({
    mediaDir: path.join(__dirname, '..', 'media'),
    libraryManager: manager
  });
  await torrentManager.readyPromise;
  const storageService = new StorageService({
    rootDir: path.join(__dirname, '..'),
    trackedDirs: ['media', 'assets', 'data']
  });

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/library', async (req, res, next) => {
    try {
      const data = await manager.getLibrary();
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/rescan', async (req, res, next) => {
    try {
      const forceRefresh = Boolean(req.body?.force);
      const data = await manager.scan({ forceRefresh });
      res.json(data);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/manual', async (req, res, next) => {
    try {
      const { id, ...payload } = req.body || {};
      if (!id) {
        return res.status(400).json({ error: 'id alanı zorunludur' });
      }
      const video = await manager.updateManualMetadata(id, payload);
      const data = await manager.getLibrary();
      res.json({ video, library: data });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/torrents/search', async (req, res, next) => {
    try {
      const query = (req.query?.q || req.query?.query || '').toString().trim();
      if (query.length < 2) {
        return res.status(400).json({ error: 'En az 2 karakterden oluşan bir arama terimi gir' });
      }
      const results = await searchTorrents(query);
      res.json({ results, query });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/torrents/downloads', async (req, res, next) => {
    try {
      const downloads = await torrentManager.listDownloads();
      const status = torrentManager.getStatus();
      res.json({ downloads, status });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/torrents/download', async (req, res, next) => {
    try {
      const { magnet, name, provider, size } = req.body || {};
      if (!magnet) {
        return res.status(400).json({ error: 'Magnet link zorunludur' });
      }
      const download = await torrentManager.startDownload({ magnet, name, provider, size });
      res.status(201).json({ download });
    } catch (error) {
      if (error && /zaten indiriliyor/i.test(error.message || '')) {
        return res.status(409).json({ error: error.message });
      }
      if (error && /aria2c bulunamadı/i.test(error.message || '')) {
        return res.status(503).json({ error: error.message });
      }
      next(error);
    }
  });

  app.post('/api/torrents/:id/pause', async (req, res, next) => {
    try {
      const gid = req.params?.id;
      const download = await torrentManager.pauseDownload(gid);
      res.json({ download });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/torrents/:id/resume', async (req, res, next) => {
    try {
      const gid = req.params?.id;
      const download = await torrentManager.resumeDownload(gid);
      res.json({ download });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/torrents/:id/cancel', async (req, res, next) => {
    try {
      const gid = req.params?.id;
      const download = await torrentManager.cancelDownload(gid);
      res.json({ download });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/storage', async (req, res, next) => {
    try {
      const fresh = req.query?.fresh === '1';
      const summary = await storageService.getSummary({ fresh });
      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/subtitles/:videoId/:trackId', async (req, res, next) => {
    try {
      const { videoId, trackId } = req.params;
      const payload = await manager.getSubtitleContent(videoId, trackId);
      if (!payload) {
        return res.status(404).json({ error: 'Altyazı bulunamadı' });
      }
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(payload.body);
    } catch (error) {
      next(error);
    }
  });

  app.use('/media', express.static(path.join(__dirname, '..', 'media')));
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
  app.use('/css', express.static(path.join(__dirname, '..', 'css')));
  app.use('/js', express.static(path.join(__dirname, '..', 'js')));
  app.use('/data', express.static(path.join(__dirname, '..', 'data')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  });

  app.use((error, req, res, next) => {
    console.error('Sunucu hatası:', error);
    res.status(500).json({ error: error.message || 'Bilinmeyen sunucu hatası' });
  });

  return new Promise(resolve => {
    const server = app.listen(PORT, () => {
      console.log(`Sunucu http://localhost:${PORT} üzerinde çalışıyor`);
      resolve(server);
    });
  });
}

createServer().catch(error => {
  console.error('Sunucu başlatılamadı:', error);
  process.exit(1);
});
