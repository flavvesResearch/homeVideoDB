const fs = require('fs/promises');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');

const execFileAsync = promisify(execFile);

const DEFAULT_TRACKED_DIRS = ['media', 'assets', 'data'];
const CACHE_TTL_MS = 60 * 1000; // 1 minute

async function safeStat(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function getDirectorySize(targetPath) {
  const stat = await safeStat(targetPath);
  if (!stat) {
    return 0;
  }
  if (!stat.isDirectory()) {
    return stat.size;
  }

  let total = 0;
  const queue = [targetPath];

  while (queue.length > 0) {
    const current = queue.pop();
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }
      const entryPath = path.join(current, entry.name);
      try {
        const entryStat = await fs.lstat(entryPath);
        if (entryStat.isSymbolicLink()) {
          continue;
        }
        if (entryStat.isDirectory()) {
          queue.push(entryPath);
        } else {
          total += entryStat.size;
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          continue;
        }
        throw error;
      }
    }
  }

  return total;
}

async function getDiskStats(targetPath) {
  try {
    const { stdout } = await execFileAsync('df', ['-kP', targetPath]);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('df çıktısı beklenen formatta değil');
    }
    const parts = lines[lines.length - 1].split(/\s+/);
    if (parts.length < 6) {
      throw new Error('df çıktısı eksik');
    }
    const total = Number(parts[1]) * 1024;
    const used = Number(parts[2]) * 1024;
    const available = Number(parts[3]) * 1024;
    const capacity = parts[4];
    const mount = parts[5];
    const filesystem = parts[0];
    return {
      total,
      used,
      available,
      capacity,
      mount,
      filesystem
    };
  } catch (error) {
    throw new Error(`Disk bilgisi alınamadı: ${error.message}`);
  }
}

class StorageService {
  constructor({ rootDir, trackedDirs = DEFAULT_TRACKED_DIRS } = {}) {
    this.rootDir = rootDir || path.join(__dirname, '..');
    this.trackedDirs = trackedDirs;
    this.cache = null;
    this.cacheTimestamp = 0;
  }

  async computeAppUsage() {
    let total = 0;
    for (const relativeDir of this.trackedDirs) {
      const absoluteDir = path.join(this.rootDir, relativeDir);
      const size = await getDirectorySize(absoluteDir).catch(() => 0);
      total += size;
    }
    return total;
  }

  async sample() {
    const disk = await getDiskStats(this.rootDir);
    const appBytes = await this.computeAppUsage();
    const used = Math.max(disk.used, 0);
    const free = Math.max(disk.available, 0);
    const total = Math.max(disk.total, used + free);
    const other = Math.max(used - appBytes, 0);

    return {
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      appBytes,
      otherBytes: other,
      filesystem: disk.filesystem,
      mountpoint: disk.mount
    };
  }

  async getSummary({ fresh = false } = {}) {
    const now = Date.now();
    if (!fresh && this.cache && now - this.cacheTimestamp < CACHE_TTL_MS) {
      return this.cache;
    }
    const summary = await this.sample();
    this.cache = summary;
    this.cacheTimestamp = now;
    return summary;
  }
}

module.exports = {
  StorageService
};

