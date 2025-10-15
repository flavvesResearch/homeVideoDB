#!/usr/bin/env node
require('dotenv').config();
const { LibraryManager } = require('../server/libraryManager');

async function main() {
  const force = process.argv.includes('--force');
  const manager = new LibraryManager();
  await manager.load();
  const data = await manager.scan({ forceRefresh: force });
  console.log(`Tarama tamamlandı. Toplam ${data.videos.length} video bulundu.`);
  if (data.unmatched.length > 0) {
    console.log(`\n${data.unmatched.length} video için otomatik bilgi bulunamadı:`);
    data.unmatched.forEach(item => {
      console.log(`- ${item.title} (${item.fileName}) -> ${item.reason}`);
    });
  } else {
    console.log('Tüm videolar için meta veriler hazır.');
  }
}

main().catch(error => {
  console.error('Tarama başarısız:', error);
  process.exit(1);
});
