const modal = document.getElementById('modal');
const modalClose = document.getElementById('modal-close');
const modalTitle = document.getElementById('modal-title');
const modalMeta = document.getElementById('modal-meta');
const modalDescription = document.getElementById('modal-description');
const modalTags = document.getElementById('modal-tags');
const modalPlay = document.getElementById('modal-play');
const modalResume = document.getElementById('modal-resume');
const modalPlayer = document.getElementById('modal-player');
const qualitySelect = document.getElementById('quality-select');
const subtitleSelect = document.getElementById('subtitle-select');
const hero = document.getElementById('hero');
const heroTitle = document.getElementById('hero-title');
const heroDescription = document.getElementById('hero-description');
const heroPlay = document.getElementById('hero-play');
const heroMore = document.getElementById('hero-more');
const continueSection = document.getElementById('continue');
const continueCarousel = document.getElementById('continue-carousel');
const collections = document.getElementById('collections');
const searchInput = document.getElementById('search-input');
const cardTemplate = document.getElementById('card-template');
const alertsSection = document.getElementById('alerts');
const alertList = document.getElementById('alert-list');
const rescanButton = document.getElementById('rescan-button');
const manualForm = document.getElementById('manual-form');
const manualIdInput = document.getElementById('manual-id');
const manualTitleInput = document.getElementById('manual-title');
const manualYearInput = document.getElementById('manual-year');
const manualDurationInput = document.getElementById('manual-duration');
const manualCollectionInput = document.getElementById('manual-collection');
const manualTagsInput = document.getElementById('manual-tags');
const manualPosterInput = document.getElementById('manual-poster');
const manualBackdropInput = document.getElementById('manual-backdrop');
const manualDescriptionInput = document.getElementById('manual-description');
const manualCancelButton = document.getElementById('manual-cancel');
const manualFeedback = document.getElementById('manual-feedback');
const lastScanLabel = document.getElementById('last-scan');
const searchFallback = document.getElementById('search-fallback');
const searchOnlineButton = document.getElementById('search-online-button');
const searchOnlinePanel = document.getElementById('search-online-panel');
const searchOnlineTitle = document.getElementById('search-online-title');
const searchOnlineStatus = document.getElementById('search-online-status');
const searchOnlineResults = document.getElementById('search-online-results');
const searchOnlineClose = document.getElementById('search-online-close');
const downloadPanel = document.getElementById('download-panel');
const downloadPanelClose = document.getElementById('download-panel-close');
const downloadPanelToggle = document.getElementById('download-panel-toggle');
const downloadList = document.getElementById('download-list');
const downloadActiveCount = document.getElementById('download-active-count');
const downloadStatusNote = document.getElementById('download-status-note');
const storageCard = document.getElementById('storage-card');
const storageCaption = document.getElementById('storage-caption');
const storageSegmentApp = document.getElementById('storage-segment-app');
const storageSegmentOther = document.getElementById('storage-segment-other');
const storageSegmentFree = document.getElementById('storage-segment-free');
const storageAppSize = document.getElementById('storage-app-size');
const storageOtherSize = document.getElementById('storage-other-size');
const storageFreeSize = document.getElementById('storage-free-size');
const settingsButton = document.getElementById('settings-button');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const torrentToggle = document.getElementById('toggle-torrent-search');
const subtitleToggle = document.getElementById('toggle-subtitles');
const subtitleControlGroup = document.getElementById('subtitle-control-group');
const searchFallbackMessage = searchFallback ? searchFallback.querySelector('span') : null;
const settingsBackdrop = settingsModal ? settingsModal.querySelector('.dialog-backdrop') : null;
const legalConsentOverlay = document.getElementById('legal-consent');
const legalAcceptButton = document.getElementById('legal-accept');
const legalRejectButton = document.getElementById('legal-reject');
const legalConsentMessage = document.getElementById('legal-consent-message');
const languageSelect = document.getElementById('language-select');

let translations = {};
let currentLang = '';

const STORAGE_KEY = 'homeVideoDB.progress';
const HERO_ROTATE_INTERVAL = 3000;
const HERO_TRANSITION_DURATION = 800;
const HERO_TRANSITION_HALF = HERO_TRANSITION_DURATION / 2;
const SUBTITLE_PREFERENCE_KEY = 'homeVideoDB.subtitlePreference';
const FEATURE_FLAGS_KEY = 'homeVideoDB.features';
const DEFAULT_FEATURE_FLAGS = {
    torrentSearch: false,
    subtitles: false
};
const LEGAL_CONSENT_KEY = 'homeVideoDB.legalConsent';
const PREVIEW_START_SECONDS = 180;
const PREVIEW_SHORT_FALLBACK = 10;
const PREVIEW_END_BUFFER = 5;
const LANGUAGE_KEY = 'homeVideoDB.language';

let allVideos = [];
let groupedVideos = new Map();
let heroVideo = null;
let heroIndex = 0;
let heroRotationTimer = null;
let heroTransitionTimeout = null;
let heroFadeTimeout = null;
let heroReady = false;
let subtitleTracks = new Map();
let subtitlePreference = loadSubtitlePreference();
let currentVideo = null;
let progress = loadProgress();
let libraryData = { videos: [], unmatched: [], lastScan: null };
let manualActiveId = null;
let isRescanning = false;
let timeUpdateHandler = null;
let pendingSeekHandler = null;
let currentSearchValue = '';
let lastSearchHasMatches = true;
let onlineSearchAbort = null;
let onlineSearchState = { query: '', loading: false, results: [], error: null };
let featureFlags = loadFeatureFlags();
let appInitialized = false;
const downloadState = {
    items: new Map(),
    polling: null,
    fetching: false,
    open: false,
    completedSeen: new Set(),
    disabled: false,
    statusMessage: null
};

async function init() {
    if (appInitialized) {
        return;
    }
    appInitialized = true;

    const savedLang = localStorage.getItem(LANGUAGE_KEY) || 'tr';
    await setLanguage(savedLang);

    applyFeatureFlags();
    attachEvents();
    updateDownloadToggleVisibility();
    await loadLibrary();
    await loadStorageInfo();
    if (isFeatureEnabled('torrentSearch')) {
        try {
            await refreshDownloadStatus(true);
        } catch (error) {
            console.warn('İndirme durumu alınamadı:', error.message);
        }
        if (!downloadState.disabled && downloadState.items.size > 0) {
            ensureDownloadPolling();
            updateDownloadToggleVisibility();
        }
    } else {
        closeSearchOnlinePanel(false);
        downloadState.items.clear();
        renderDownloadPanel();
    }
}

async function setLanguage(lang) {
    console.log(`%c🌍 Dil değiştiriliyor: ${currentLang} → ${lang}`, 'background: #222; color: #bada55; font-size: 14px; padding: 5px;');
    
    currentLang = lang;
    localStorage.setItem(LANGUAGE_KEY, lang);
    
    // languageSelect'i güncelle
    if (languageSelect && languageSelect.value !== lang) {
        languageSelect.value = lang;
    }
    
    // Çevirileri yükle
    await loadTranslations(lang);
    
    // UI'yi güncelle
    translateUI();
    
    console.log(`%c✅ Dil değiştirildi: ${lang} (${Object.keys(translations).length} çeviri)`, 'background: #222; color: #7FFF00; font-size: 14px; padding: 5px;');
}

async function loadTranslations(lang) {
    try {
        const response = await fetch(`locales/${lang}.json`);
        if (!response.ok) {
            throw new Error(`Could not load ${lang}.json`);
        }
        translations = await response.json();
    } catch (error) {
        console.error('❌ Çeviri yükleme hatası:', error);
    }
}

function t(key, replacements = {}) {
    let text = translations[key] || key;
    Object.keys(replacements).forEach(placeholder => {
        text = text.replace(`{${placeholder}}`, replacements[placeholder]);
    });
    return text;
}

function translateUI() {
    document.documentElement.lang = currentLang;
    
    // Sayfa başlığını güncelle
    document.title = translations.appTitle || 'Home Video DB';
    
    // Tüm data-translate elementlerini güncelle
    document.querySelectorAll('[data-translate]').forEach(el => {
        const key = el.getAttribute('data-translate');
        if (translations[key]) {
            el.innerHTML = translations[key];
        }
    });
    
    // Placeholder'ları güncelle
    document.querySelectorAll('[data-translate-placeholder]').forEach(el => {
        const key = el.getAttribute('data-translate-placeholder');
        if (translations[key]) {
            el.placeholder = translations[key];
        }
    });
    
    // Aria-label'ları güncelle
    document.querySelectorAll('[data-translate-aria-label]').forEach(el => {
        const key = el.getAttribute('data-translate-aria-label');
        if (translations[key]) {
            el.setAttribute('aria-label', translations[key]);
        }
    });

    // Dinamik içerikleri yeniden render et
    if (allVideos.length > 0) {
        if (heroVideo) {
            renderHero(heroVideo);
        }
        renderCollections(groupedVideos);
        renderContinueWatching();
    }
    
    if (libraryData.unmatched && libraryData.unmatched.length > 0) {
        renderAlerts(libraryData.unmatched);
    }
    
    renderDownloadPanel();
    
    if (currentVideo && !modal.classList.contains('hidden')) {
        const saved = progress[currentVideo.id];
        if (saved && saved.time > 0 && saved.time < saved.duration - 5) {
            modalResume.textContent = t('modalResumeButton').replace('{time}', formatTime(saved.time));
        }
    }
    
    if (onlineSearchState.results && onlineSearchState.results.length > 0) {
        renderSearchOnlineResults(onlineSearchState.results, onlineSearchState.query);
    }
}

async function loadLibrary() {
    try {
        const response = await fetch('/api/library');
        if (!response.ok) {
            throw new Error(translations.loadingLibraryError || 'Kütüphane yüklenemedi');
        }
        const data = await response.json();
        updateLibrary(data);
    } catch (error) {
        console.error('Veriler yüklenemedi', error);
        showAlertsMessage(translations.loadingDataError ||'Veriler yüklenirken bir hata oluştu. Sunucuyu kontrol et.');
    }
}

async function loadStorageInfo(options = {}) {
    if (!storageCard) return;
    try {
        const fresh = options.fresh ? '?fresh=1' : '';
        const response = await fetch(`/api/storage${fresh}`);
        if (!response.ok) {
            throw new Error('Disk bilgisi alınamadı');
        }
        const payload = await response.json();
        renderStorageInfo(payload);
    } catch (error) {
        console.warn('Disk kullanımı getirilemedi:', error.message);
        storageCard.classList.add('hidden');
    }
}

function updateLibrary(data) {
    stopHeroRotation();
    libraryData = data;
    const videos = Array.isArray(data.videos) ? data.videos : [];
    allVideos = videos.filter(video => video.status === 'ready' && Array.isArray(video.sources) && video.sources.length > 0);
    allVideos.forEach(video => {
        if (!Array.isArray(video.subtitles)) {
            video.subtitles = [];
        }
    });
    groupedVideos = groupByCollection(allVideos);
    heroVideo = [...groupedVideos.values()][0]?.[0] ?? allVideos[0] ?? null;
    heroIndex = 0;
    heroReady = false;
    renderHero(heroVideo);
    renderCollections(groupedVideos);
    renderContinueWatching();
    renderAlerts(Array.isArray(data.unmatched) ? data.unmatched : []);
    updateLastScan(data.lastScan);
    if (searchInput && currentSearchValue) {
        const hasMatches = filterCollections(currentSearchValue.toLowerCase());
        lastSearchHasMatches = hasMatches || false;
        updateSearchFallback(currentSearchValue, hasMatches);
    }
    startHeroRotation();
}

function renderStorageInfo(info) {
    if (!storageCard) return;
    if (!info || !Number.isFinite(info.totalBytes) || info.totalBytes <= 0) {
        storageCard.classList.add('hidden');
        return;
    }

    const { totalBytes, usedBytes, freeBytes, appBytes, otherBytes, mountpoint } = info;
    const safeTotal = totalBytes > 0 ? totalBytes : (usedBytes + freeBytes);
    const safeApp = Math.max(0, Math.min(appBytes || 0, safeTotal));
    const safeOther = Math.max(0, Math.min(otherBytes || 0, safeTotal));
    const safeFree = Math.max(0, Math.min(freeBytes || 0, safeTotal));
    const denominator = safeTotal || (safeApp + safeOther + safeFree) || 1;

    const percent = value => `${Math.max(0, Math.min(100, (value / denominator) * 100)).toFixed(2)}%`;
    const pretty = value => formatBytes(value) || '0 B';

    if (storageSegmentApp) {
        storageSegmentApp.style.width = percent(safeApp);
        storageSegmentApp.title = `homeVideoDB • ${pretty(safeApp)} (${percent(safeApp)})`;
    }
    if (storageSegmentOther) {
        storageSegmentOther.style.width = percent(safeOther);
        storageSegmentOther.title = `Diğer • ${pretty(safeOther)} (${percent(safeOther)})`;
    }
    if (storageSegmentFree) {
        storageSegmentFree.style.width = percent(safeFree);
        storageSegmentFree.title = `Boş • ${pretty(safeFree)} (${percent(safeFree)})`;
    }

    if (storageAppSize) {
        storageAppSize.textContent = `${pretty(safeApp)} (${percent(safeApp)})`;
    }
    if (storageOtherSize) {
        storageOtherSize.textContent = `${pretty(safeOther)} (${percent(safeOther)})`;
    }
    if (storageFreeSize) {
        storageFreeSize.textContent = `${pretty(safeFree)} (${percent(safeFree)})`;
    }

    if (storageCaption) {
        const usedPercent = percent(usedBytes || safeApp + safeOther);
        const totalText = t('storageCaptionTotal').replace('{total}', pretty(safeTotal));
        const usedText = t('storageCaptionUsed').replace('{percent}', usedPercent);
        const mountText = mountpoint ? ` ${t('storageCaptionMountpoint').replace('{mountpoint}', mountpoint)}` : '';
        storageCaption.textContent = `${totalText} • ${usedText}${mountText}`;
    }

    storageCard.classList.remove('hidden');
}

function updateLastScan(value) {
    if (!lastScanLabel) return;
    if (!value) {
        lastScanLabel.textContent = '-';
        return;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        lastScanLabel.textContent = value;
    } else {
        const locale = currentLang === 'en' ? 'en-US' : 'tr-TR';
        lastScanLabel.textContent = date.toLocaleString(locale);
    }
}

function showAlertsMessage(message) {
    if (!alertsSection) return;
    alertsSection.classList.remove('hidden');
    alertList.innerHTML = '';
    const li = document.createElement('li');
    li.className = 'alert-item';
    li.textContent = message;
    alertList.appendChild(li);
}

function groupByCollection(videos) {
    const map = new Map();
    videos.forEach(video => {
        const key = video.collection ?? t('otherVideos');
        if (!map.has(key)) {
            map.set(key, []);
        }
        map.get(key).push(video);
    });
    return map;
}

function renderHero(video) {
    heroVideo = video ?? null;
    if (!hero) return;

    const cancelTransitions = () => {
        if (heroTransitionTimeout) {
            clearTimeout(heroTransitionTimeout);
            heroTransitionTimeout = null;
        }
        if (heroFadeTimeout) {
            clearTimeout(heroFadeTimeout);
            heroFadeTimeout = null;
        }
    };

    cancelTransitions();

    if (!video) {
        heroReady = false;
        hero.classList.remove('is-transitioning', 'is-fading-out', 'is-fading-in');
        heroTitle.textContent = t('emptyArchive') || 'Arşivinde henüz video yok.';
        heroDescription.textContent = '';
        hero.style.backgroundImage = 'linear-gradient(135deg, #111118, #050507)';
        heroPlay.disabled = true;
        heroMore.disabled = true;
        heroPlay.setAttribute('aria-disabled', 'true');
        heroMore.setAttribute('aria-disabled', 'true');
        heroPlay.onclick = null;
        heroMore.onclick = null;
        return;
    }

    const applyVideo = () => {
        const index = allVideos.findIndex(item => item.id === video.id);
        if (index !== -1) {
            heroIndex = index;
        }

        heroPlay.disabled = false;
        heroMore.disabled = false;
        heroPlay.removeAttribute('aria-disabled');
        heroMore.removeAttribute('aria-disabled');
        heroTitle.textContent = video.title;
        heroDescription.textContent = video.description || t('emptyArchive');
        const background = video.backdrop || video.poster;
        hero.style.backgroundImage = background ? `url(${background})` : 'linear-gradient(135deg, #111118, #050507)';
        heroPlay.onclick = () => openModal(video, true);
        heroMore.onclick = () => openModal(video, false);
    };

    const startFadeIn = () => {
        hero.classList.remove('is-fading-out');
        void hero.offsetWidth;
        hero.classList.add('is-fading-in');
        heroFadeTimeout = setTimeout(() => {
            hero.classList.remove('is-fading-in');
            hero.classList.remove('is-transitioning');
            heroFadeTimeout = null;
        }, HERO_TRANSITION_HALF);
    };

    if (!heroReady) {
        hero.classList.remove('is-transitioning', 'is-fading-out', 'is-fading-in');
        heroReady = true;
        applyVideo();
        return;
    }

    hero.classList.remove('is-fading-in');
    hero.classList.add('is-transitioning');
    void hero.offsetWidth;
    hero.classList.add('is-fading-out');

    heroTransitionTimeout = setTimeout(() => {
        heroTransitionTimeout = null;
        applyVideo();
        startFadeIn();
    }, HERO_TRANSITION_HALF);
}

function advanceHero() {
    if (allVideos.length === 0) {
        return;
    }
    heroIndex = (heroIndex + 1) % allVideos.length;
    const next = allVideos[heroIndex];
    if (!next || next.id === heroVideo?.id) {
        return;
    }
    renderHero(next);
}

function startHeroRotation() {
    if (heroRotationTimer || allVideos.length <= 1) {
        return;
    }
    heroRotationTimer = setInterval(() => {
        advanceHero();
    }, HERO_ROTATE_INTERVAL);
}

function stopHeroRotation() {
    if (!heroRotationTimer) {
        return;
    }
    clearInterval(heroRotationTimer);
    heroRotationTimer = null;
}

function renderCollections(collectionsMap) {
    collections.innerHTML = '';
    if (!collectionsMap || collectionsMap.size === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = t('emptyArchive');
        collections.appendChild(empty);
        return;
    }
    collectionsMap.forEach((videos, title) => {
        if (!videos || videos.length === 0) return;
        const section = document.createElement('section');
        section.className = 'row';
        const heading = document.createElement('h2');
        heading.textContent = title;
        const carousel = document.createElement('div');
        carousel.className = 'carousel';
        videos.forEach(video => {
            const card = createCard(video);
            carousel.appendChild(card);
        });
        section.appendChild(heading);
        section.appendChild(carousel);
        collections.appendChild(section);
    });
}

function createCard(video) {
    const card = cardTemplate.content.firstElementChild.cloneNode(true);
    const poster = card.querySelector('.card-poster');
    const title = card.querySelector('.card-title');
    const meta = card.querySelector('.card-meta');
    const progressBar = card.querySelector('.card-progress');

    card.dataset.videoId = video.id;
    title.textContent = video.title;
    const metaParts = [video.year, video.duration].filter(Boolean);
    meta.textContent = metaParts.join(t('cardMetaSeparator') || ' • ');
    poster.style.backgroundImage = video.poster ? `url(${video.poster})` : 'linear-gradient(135deg, #222, #111)';

    const saved = progress[video.id];
    if (saved && saved.duration && saved.time < saved.duration) {
        const percent = Math.min(100, Math.round((saved.time / saved.duration) * 100));
        progressBar.style.width = `${percent}%`;
    }

    card.addEventListener('click', () => {
        stopCardPreview(card);
        openModal(video, false);
    });
    card.addEventListener('keyup', (event) => {
        if (event.key === 'Enter') {
            openModal(video, false);
        }
    });
    card.addEventListener('pointerenter', (event) => {
        if (event.pointerType && event.pointerType !== 'mouse') return;
        startCardPreview(card, video);
    });
    card.addEventListener('pointerleave', () => {
        stopCardPreview(card);
    });
    card.setAttribute('tabindex', '0');
    return card;
}

function ensureCardPreview(poster, video) {
    if (!poster || !Array.isArray(video.sources) || video.sources.length === 0) {
        return null;
    }
    let preview = poster.querySelector('.card-preview');
    if (preview) {
        return preview;
    }

    preview = document.createElement('video');
    preview.className = 'card-preview';
    preview.muted = true;
    preview.playsInline = true;
    preview.preload = 'metadata';
    preview.setAttribute('muted', '');
    preview.setAttribute('playsinline', '');
    preview.setAttribute('webkit-playsinline', '');
    preview.controls = false;

    video.sources.forEach(source => {
        if (!source?.src) return;
        const sourceEl = document.createElement('source');
        sourceEl.src = source.src;
        if (source.type) {
            sourceEl.type = source.type;
        }
        preview.appendChild(sourceEl);
    });

    poster.insertBefore(preview, poster.firstChild);
    return preview;
}

function getPreviewStartTime(duration) {
    if (!Number.isFinite(duration) || duration <= 0) {
        return PREVIEW_START_SECONDS;
    }
    if (duration <= PREVIEW_START_SECONDS) {
        return Math.max(duration - PREVIEW_SHORT_FALLBACK, 0);
    }
    const latestAllowed = Math.max(duration - PREVIEW_END_BUFFER, 0);
    return Math.min(PREVIEW_START_SECONDS, latestAllowed);
}

function startCardPreview(card, video) {
    const poster = card.querySelector('.card-poster');
    const preview = ensureCardPreview(poster, video);
    if (!poster || !preview) {
        return;
    }

    poster.classList.add('preview-active');

    const beginPlayback = () => {
        if (!poster.classList.contains('preview-active')) {
            return;
        }
        const startTime = getPreviewStartTime(preview.duration);
        if (startTime > 0 && Number.isFinite(preview.duration)) {
            try {
                const maxSeek = Math.max(preview.duration - 0.5, 0);
                preview.currentTime = Math.min(startTime, maxSeek);
            } catch (error) {
                console.warn('Önizleme için ileri sarılamadı', error);
            }
        }
        preview.play().catch(() => {
            // otomatik oynatma engellenirse sessiz kal
        });
    };

    if (preview.readyState >= 1 && Number.isFinite(preview.duration)) {
        beginPlayback();
    } else {
        preview.addEventListener('loadedmetadata', beginPlayback, { once: true });
        preview.load();
    }
}

function stopCardPreview(card) {
    const poster = card.querySelector('.card-poster');
    const preview = poster?.querySelector('.card-preview');
    if (!poster || !preview) {
        return;
    }
    poster.classList.remove('preview-active');
    preview.pause();
}

function renderContinueWatching() {
    const entries = Object.entries(progress)
        .map(([id, value]) => ({ id, ...value }))
        .filter(item => item.time > 0 && item.time < item.duration - 5);

    continueCarousel.innerHTML = '';

    if (entries.length === 0) {
        continueSection.classList.add('hidden');
        return;
    }

    entries.sort((a, b) => b.updatedAt - a.updatedAt);

    entries.forEach(entry => {
        const video = allVideos.find(item => item.id === entry.id);
        if (!video) return;
        const card = createCard(video);
        continueCarousel.appendChild(card);
    });

    continueSection.classList.remove('hidden');
}

function openModal(video, autoPlay) {
    currentVideo = video;
    modalTitle.textContent = video.title;
    const metaParts = [video.year, video.duration].filter(Boolean);
    modalMeta.textContent = metaParts.join(t('cardMetaSeparator') || ' • ');
    modalDescription.textContent = video.description || t('emptyArchive');
    modalTags.innerHTML = '';
    video.tags?.forEach(tag => {
        const chip = document.createElement('span');
        chip.textContent = tag;
        modalTags.appendChild(chip);
    });

    populateQualityOptions(video);
    populateSubtitleOptions(video);

    const saved = progress[video.id];
    if (saved && saved.time > 0 && saved.time < saved.duration - 5) {
        modalResume.classList.remove('hidden');
        modalResume.textContent = t('modalResumeButton').replace('{time}', formatTime(saved.time));
    } else {
        modalResume.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    if (autoPlay) {
        playVideo(video, saved?.time ?? 0);
    }
}

function closeModal() {
    modal.classList.add('hidden');
    document.body.style.overflow = '';
    modalPlayer.pause();
    modalPlayer.removeAttribute('src');
    modalPlayer.load();
    subtitleTracks.clear();
    if (timeUpdateHandler) {
        modalPlayer.removeEventListener('timeupdate', timeUpdateHandler);
        timeUpdateHandler = null;
    }
    if (pendingSeekHandler) {
        modalPlayer.removeEventListener('loadedmetadata', pendingSeekHandler);
        pendingSeekHandler = null;
    }
}

function populateQualityOptions(video) {
    qualitySelect.innerHTML = '';
    video.sources.forEach((source, index) => {
        const option = document.createElement('option');
        option.value = source.src;
        const label = source.label || 'Kaynak';
        const resolution = source.resolution ? ` (${source.resolution})` : '';
        option.textContent = `${label}${resolution}`;
        if (index === 0) {
            option.selected = true;
        }
        qualitySelect.appendChild(option);
    });
}

function populateSubtitleOptions(video) {
    if (!subtitleSelect) return;
    const subtitlesEnabled = isFeatureEnabled('subtitles');
    subtitleSelect.innerHTML = '';
    const offOption = document.createElement('option');
    offOption.value = 'off';
    offOption.textContent = t('subtitleOff');
    offOption.setAttribute('data-translate', 'subtitleOff');
    subtitleSelect.appendChild(offOption);
    subtitleSelect.value = 'off';

    if (!subtitlesEnabled) {
        subtitleSelect.disabled = true;
        if (subtitleControlGroup) {
            subtitleControlGroup.classList.add('hidden');
        }
        return;
    }

    if (subtitleControlGroup) {
        subtitleControlGroup.classList.remove('hidden');
    }

    const subtitles = Array.isArray(video.subtitles) ? video.subtitles : [];
    if (subtitles.length === 0) {
        subtitleSelect.disabled = true;
        return;
    }

    subtitles.forEach(subtitle => {
        const option = document.createElement('option');
        option.value = subtitle.id;
        option.textContent = subtitle.label || subtitle.lang?.toUpperCase() || t('subtitleLabel');
        if (subtitle.lang) {
            option.dataset.lang = subtitle.lang;
        }
        subtitleSelect.appendChild(option);
    });

    subtitleSelect.disabled = false;
    const preferred = getPreferredSubtitleForVideo(video);
    if (preferred !== 'off' && !subtitles.some(item => item.id === preferred)) {
        subtitleSelect.value = 'off';
    } else {
        subtitleSelect.value = preferred;
    }
}

function getPreferredSubtitleForVideo(video) {
    if (!isFeatureEnabled('subtitles')) {
        return 'off';
    }
    const subtitles = Array.isArray(video.subtitles) ? video.subtitles : [];
    if (subtitles.length === 0) {
        return 'off';
    }
    if (!subtitlePreference || subtitlePreference.mode !== 'on') {
        const defaultTrack = subtitles.find(item => item.default);
        return defaultTrack ? defaultTrack.id : 'off';
    }
    if (subtitlePreference.id) {
        const direct = subtitles.find(item => item.id === subtitlePreference.id);
        if (direct) {
            return direct.id;
        }
    }
    if (subtitlePreference.lang) {
        const byLang = subtitles.find(item => item.lang === subtitlePreference.lang);
        if (byLang) {
            return byLang.id;
        }
    }
    return 'off';
}

function prepareSubtitleTracks(video) {
    if (!Array.isArray(video.subtitles) || video.subtitles.length === 0) {
        subtitleTracks.clear();
        Array.from(modalPlayer.textTracks).forEach(track => {
            track.mode = 'disabled';
        });
        applySubtitleSelection('off');
        return;
    }

    const assignTracks = () => {
        subtitleTracks.clear();
        const trackElements = modalPlayer.querySelectorAll('track[data-track-id]');
        const textTracks = modalPlayer.textTracks;
        for (let index = 0; index < textTracks.length && index < trackElements.length; index += 1) {
            const element = trackElements[index];
            const trackId = element?.getAttribute('data-track-id');
            if (trackId) {
                subtitleTracks.set(trackId, textTracks[index]);
            }
        }
        const desired = subtitleSelect ? subtitleSelect.value : getPreferredSubtitleForVideo(video);
        applySubtitleSelection(desired);
    };

    if (modalPlayer.readyState >= 1) {
        assignTracks();
    } else {
        modalPlayer.addEventListener('loadedmetadata', assignTracks, { once: true });
    }
}

function applySubtitleSelection(value) {
    if (!isFeatureEnabled('subtitles')) {
        Array.from(modalPlayer.textTracks).forEach(track => {
            track.mode = 'disabled';
        });
        if (subtitleSelect && subtitleSelect.value !== 'off') {
            subtitleSelect.value = 'off';
        }
        return;
    }
    const selection = subtitleTracks.size > 0 && value && subtitleTracks.has(value) ? value : 'off';
    if (selection === 'off') {
        Array.from(modalPlayer.textTracks).forEach(track => {
            track.mode = 'disabled';
        });
    } else {
        subtitleTracks.forEach((track, id) => {
            track.mode = id === selection ? 'showing' : 'disabled';
        });
    }
    if (subtitleSelect && subtitleSelect.value !== selection) {
        subtitleSelect.value = selection;
    }
}

function loadSubtitlePreference() {
    try {
        const stored = localStorage.getItem(SUBTITLE_PREFERENCE_KEY);
        if (!stored) {
            return { mode: 'off' };
        }
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') {
            return {
                mode: parsed.mode === 'on' ? 'on' : 'off',
                id: typeof parsed.id === 'string' ? parsed.id : null,
                lang: typeof parsed.lang === 'string' ? parsed.lang : null
            };
        }
        return { mode: 'off' };
    } catch (error) {
        console.warn('Altyazı tercihi okunamadı', error);
        return { mode: 'off' };
    }
}

function saveSubtitlePreference(preference) {
    try {
        localStorage.setItem(SUBTITLE_PREFERENCE_KEY, JSON.stringify(preference));
    } catch (error) {
        console.warn('Altyazı tercihi kaydedilemedi', error);
    }
}

function playVideo(video, startTime = 0) {
    const selectedSource = qualitySelect.value || video.sources[0]?.src;
    if (!selectedSource) return;

    if (pendingSeekHandler) {
        modalPlayer.removeEventListener('loadedmetadata', pendingSeekHandler);
        pendingSeekHandler = null;
    }

    modalPlayer.pause();
    modalPlayer.innerHTML = '';
    subtitleTracks.clear();
    video.sources.forEach(source => {
        const sourceEl = document.createElement('source');
        sourceEl.src = source.src;
        sourceEl.label = source.label;
        sourceEl.dataset.resolution = source.resolution;
        modalPlayer.appendChild(sourceEl);
    });

    if (isFeatureEnabled('subtitles') && Array.isArray(video.subtitles) && video.subtitles.length > 0) {
        video.subtitles.forEach(subtitle => {
            if (!subtitle?.src) return;
            const trackEl = document.createElement('track');
            trackEl.kind = 'subtitles';
            trackEl.label = subtitle.label || subtitle.lang?.toUpperCase() || 'Altyazı';
            if (subtitle.lang) {
                trackEl.srclang = subtitle.lang;
            }
            trackEl.src = subtitle.src;
            if (subtitle.default) {
                trackEl.default = true;
            }
            trackEl.setAttribute('data-track-id', subtitle.id);
            if (subtitle.lang) {
                trackEl.setAttribute('data-track-lang', subtitle.lang);
            }
            modalPlayer.appendChild(trackEl);
        });
    }

    modalPlayer.poster = video.poster ?? '';
    modalPlayer.src = selectedSource;
    const shouldSeek = Number.isFinite(startTime) && startTime > 0;

    const applyStartTime = () => {
        pendingSeekHandler = null;
        if (!shouldSeek) return;
        const duration = modalPlayer.duration;
        const maxSeek = Number.isFinite(duration) && duration > 1 ? Math.max(duration - 0.5, 0) : undefined;
        const clamped = maxSeek !== undefined ? Math.min(startTime, maxSeek) : startTime;
        try {
            modalPlayer.currentTime = clamped;
        } catch (error) {
            console.warn('Kaydedilen konuma ilerlenemedi', error);
        }
    };

    if (shouldSeek) {
        if (modalPlayer.readyState >= 1 && Number.isFinite(modalPlayer.duration)) {
            applyStartTime();
        } else {
            pendingSeekHandler = () => {
                modalPlayer.removeEventListener('loadedmetadata', pendingSeekHandler);
                applyStartTime();
            };
            modalPlayer.addEventListener('loadedmetadata', pendingSeekHandler);
        }
    }

    modalPlayer.play()
        .then(() => {
            modalPlayer.muted = false;
        })
        .catch(() => {
            // autoplay engellenirse sessiz başlatmayı dene
            modalPlayer.muted = true;
            modalPlayer.play()
                .then(() => {
                    modalPlayer.muted = false;
                })
                .catch(() => {
                    // Kullanıcı etkileşimi bekleniyor
                });
        });

    prepareSubtitleTracks(video);
    trackProgress(video);
}

function trackProgress(video) {
    if (timeUpdateHandler) {
        modalPlayer.removeEventListener('timeupdate', timeUpdateHandler);
    }

    timeUpdateHandler = () => {
        if (!modalPlayer.duration) return;
        progress[video.id] = {
            time: modalPlayer.currentTime,
            duration: modalPlayer.duration,
            updatedAt: Date.now()
        };
        if (modalPlayer.ended || modalPlayer.currentTime >= modalPlayer.duration - 2) {
            delete progress[video.id];
        }
        saveProgress(progress);
        renderContinueWatching();
        refreshCollectionProgress(video.id);
    };

    modalPlayer.addEventListener('timeupdate', timeUpdateHandler);
}

function refreshCollectionProgress(videoId) {
    document.querySelectorAll('.card').forEach(card => {
        if (card.dataset.videoId !== videoId) return;
        const progressBar = card.querySelector('.card-progress');
        const saved = progress[videoId];
        if (saved && saved.duration) {
            const percent = Math.min(100, Math.round((saved.time / saved.duration) * 100));
            progressBar.style.width = `${percent}%`;
        } else {
            progressBar.style.width = '0';
        }
    });
}

function loadProgress() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch (error) {
        console.warn('İzleme geçmişi okunamadı', error);
        return {};
    }
}

function saveProgress(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.warn('İzleme geçmişi kaydedilemedi', error);
    }
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}


function renderAlerts(unmatched) {
    if (!alertsSection || !alertList) return;
    alertList.innerHTML = '';
    if (!unmatched || unmatched.length === 0) {
        alertsSection.classList.add('hidden');
        alertList.innerHTML = '';
        if (manualActiveId) {
            closeManualForm();
        }
        return;
    }

    alertsSection.classList.remove('hidden');
    unmatched.forEach(item => {
        const li = document.createElement('li');
        li.className = 'alert-item';
        li.dataset.videoId = item.id;

        const info = document.createElement('div');
        info.className = 'alert-info';

        const title = document.createElement('strong');
        title.textContent = item.title || item.fileName || t('unknownVideo');
        info.appendChild(title);

        const reason = document.createElement('span');
        reason.textContent = item.reason || t('noMatchFound');
        info.appendChild(reason);

        const actions = document.createElement('div');
        actions.className = 'alert-actions';
        
        const renameButton = document.createElement('button');
        renameButton.type = 'button';
        renameButton.className = 'btn btn-outline';
        renameButton.textContent = t('renameButton');
        renameButton.addEventListener('click', () => openRenameDialog(item.id, item.title || item.fileName));
        actions.appendChild(renameButton);
        
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'btn btn-outline';
        editButton.textContent = t('fillInfoButton');
        editButton.addEventListener('click', () => openManualForm(item.id));
        actions.appendChild(editButton);

        li.appendChild(info);
        li.appendChild(actions);
        if (manualActiveId === item.id) {
            li.classList.add('active');
        }
        alertList.appendChild(li);
    });
}

function openManualForm(id) {
    if (!manualForm) return;
    const video = libraryData?.videos?.find(item => item.id === id);
    if (!video) return;
    manualActiveId = id;
    manualIdInput.value = id;
    manualTitleInput.value = video.title || video.originalTitle || '';
    manualYearInput.value = video.year || '';
    manualDurationInput.value = video.duration || '';
    manualCollectionInput.value = video.collection || '';
    manualTagsInput.value = Array.isArray(video.tags) ? video.tags.join(', ') : '';
    manualPosterInput.value = video.poster || '';
    manualBackdropInput.value = video.backdrop || '';
    manualDescriptionInput.value = video.description || '';
    setManualFeedback('', '');
    manualForm.classList.remove('hidden');
    document.querySelectorAll('.alert-item').forEach(item => {
        item.classList.toggle('active', item.dataset.videoId === id);
    });
    manualForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function closeManualForm() {
    if (!manualForm) return;
    manualActiveId = null;
    manualIdInput.value = '';
    manualTitleInput.value = '';
    manualYearInput.value = '';
    manualDurationInput.value = '';
    manualCollectionInput.value = '';
    manualTagsInput.value = '';
    manualPosterInput.value = '';
    manualBackdropInput.value = '';
    manualDescriptionInput.value = '';
    setManualFeedback('', '');
    manualForm.classList.add('hidden');
    document.querySelectorAll('.alert-item').forEach(item => item.classList.remove('active'));
}

function setManualFeedback(message, status) {
    if (!manualFeedback) return;
    manualFeedback.textContent = message;
    manualFeedback.className = 'manual-feedback';
    if (status) {
        manualFeedback.classList.add(status);
    }
}

function setManualSubmitting(state) {
    if (!manualForm) return;
    const submitButton = manualForm.querySelector('button[type="submit"]');
    if (!submitButton) return;
    if (!submitButton.dataset.originalText) {
        submitButton.dataset.originalText = t('manualFormSaveButton');
    }
    submitButton.disabled = state;
    submitButton.textContent = state ? t('saving') : submitButton.dataset.originalText;
}

async function handleManualSubmit(event) {
    event.preventDefault();
    if (!manualActiveId) {
        setManualFeedback(t('selectVideoToEdit'), 'error');
        return;
    }
    const payload = {
        id: manualActiveId,
        title: manualTitleInput.value.trim(),
        year: manualYearInput.value.trim(),
        duration: manualDurationInput.value.trim(),
        collection: manualCollectionInput.value.trim(),
        tags: manualTagsInput.value.split(',').map(tag => tag.trim()).filter(Boolean),
        poster: manualPosterInput.value.trim(),
        backdrop: manualBackdropInput.value.trim(),
        description: manualDescriptionInput.value.trim()
    };
    if (!payload.title || !payload.description) {
        setManualFeedback(t('titleAndDescriptionRequired'), 'error');
        return;
    }
    setManualSubmitting(true);
    setManualFeedback(t('savingVideoInfo'), 'info');
    try {
        const response = await fetch('/api/manual', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Kayıt başarısız oldu');
        }
        const data = await response.json();
        if (data?.library) {
            updateLibrary(data.library);
        }
        setManualFeedback(t('videoInfoSaved'), 'success');
        setTimeout(() => {
            closeManualForm();
        }, 1200);
    } catch (error) {
        setManualFeedback(error.message, 'error');
    } finally {
        setManualSubmitting(false);
    }
}

function setRescanLoading(state) {
    if (!rescanButton) return;
    if (!rescanButton.dataset.originalText) {
        rescanButton.dataset.originalText = t('rescanButton');
    }
    rescanButton.disabled = state;
    rescanButton.textContent = state ? t('scanning') : rescanButton.dataset.originalText;
}

async function requestRescan(force = false) {
    if (isRescanning) return;
    isRescanning = true;
    setRescanLoading(true);
    setManualFeedback('', '');
    try {
        const response = await fetch('/api/rescan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ force })
        });
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Tarama başarısız oldu');
        }
        const data = await response.json();
        updateLibrary(data);
    } catch (error) {
        showAlertsMessage(error.message || t('scanFailed'));
    } finally {
        isRescanning = false;
        setRescanLoading(false);
    }
}

function attachEvents() {
    modalClose.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal || event.target.classList.contains('modal-backdrop')) {
            closeModal();
        }
    });
    modalPlay.addEventListener('click', () => {
        if (!currentVideo) return;
        playVideo(currentVideo, 0);
    });
    modalResume.addEventListener('click', () => {
        if (!currentVideo) return;
        const saved = progress[currentVideo.id];
        playVideo(currentVideo, saved?.time ?? 0);
    });
    qualitySelect.addEventListener('change', () => {
        if (!currentVideo) return;
        const saved = progress[currentVideo.id];
        playVideo(currentVideo, saved?.time ?? 0);
    });
    if (subtitleSelect) {
        subtitleSelect.addEventListener('change', () => {
            if (!isFeatureEnabled('subtitles')) {
                subtitleSelect.value = 'off';
                return;
            }
            if (!currentVideo) {
                applySubtitleSelection(subtitleSelect.value);
                return;
            }
            applySubtitleSelection(subtitleSelect.value);
            if (subtitleSelect.value === 'off') {
                subtitlePreference = { mode: 'off' };
            } else {
                const selectedOption = subtitleSelect.selectedOptions[0];
                const lang = selectedOption?.dataset.lang || null;
                subtitlePreference = { mode: 'on', id: subtitleSelect.value, lang };
            }
            saveSubtitlePreference(subtitlePreference);
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
            closeModal();
        } else if (event.key === 'Escape' && settingsModal && !settingsModal.classList.contains('hidden')) {
            closeSettingsModal();
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', handleSearchInput);
        searchInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                handleSearchEnter();
            }
        });
    }
    if (searchOnlineButton) {
        searchOnlineButton.addEventListener('click', () => {
            if (!isFeatureEnabled('torrentSearch')) {
                openSettingsModal();
                return;
            }
            if (currentSearchValue.length >= 2) {
                startOnlineSearch(currentSearchValue);
            }
        });
    }
    if (searchOnlineClose) {
        searchOnlineClose.addEventListener('click', () => closeSearchOnlinePanel());
    }
    if (downloadPanelClose) {
        downloadPanelClose.addEventListener('click', () => closeDownloadPanel());
    }
    if (downloadPanelToggle) {
        downloadPanelToggle.addEventListener('click', () => {
            if (!isFeatureEnabled('torrentSearch')) {
                return;
            }
            if (downloadState.open) {
                closeDownloadPanel();
            } else {
                openDownloadPanel();
            }
        });
    }
    if (rescanButton) {
        rescanButton.addEventListener('click', () => requestRescan(false));
    }
    if (manualForm) {
        manualForm.addEventListener('submit', handleManualSubmit);
    }
    if (manualCancelButton) {
        manualCancelButton.addEventListener('click', () => closeManualForm());
    }
    if (settingsButton) {
        settingsButton.addEventListener('click', () => openSettingsModal());
    }
    if (settingsClose) {
        settingsClose.addEventListener('click', () => closeSettingsModal());
    }
    if (settingsBackdrop) {
        settingsBackdrop.addEventListener('click', () => closeSettingsModal());
    }
    if (torrentToggle) {
        torrentToggle.addEventListener('change', () => {
            setFeatureFlag('torrentSearch', torrentToggle.checked);
        });
    }
    if (subtitleToggle) {
        subtitleToggle.addEventListener('change', () => {
            setFeatureFlag('subtitles', subtitleToggle.checked);
        });
    }
    if (languageSelect) {
        languageSelect.addEventListener('change', async (event) => {
            await setLanguage(event.target.value);
        });
    }
}

function filterCollections(query) {
    if (!query) {
        document.querySelectorAll('.row').forEach(section => {
            if (section.id === 'continue') return;
            section.style.display = '';
        });
        return true;
    }
    let matches = 0;
    document.querySelectorAll('.row').forEach(section => {
        if (section.id === 'continue') return;
        const cards = section.querySelectorAll('.card');
        const hasMatch = [...cards].some(card => {
            const title = card.querySelector('.card-title')?.textContent.toLowerCase() ?? '';
            return title.includes(query);
        });
        section.style.display = query && !hasMatch ? 'none' : '';
        if (hasMatch) {
            matches += 1;
        }
    });
    return matches > 0;
}

function handleSearchInput(event) {
    const rawValue = event.target.value || '';
    currentSearchValue = rawValue.trim();
    const normalized = rawValue.toLowerCase();
    const hasMatches = filterCollections(normalized);
    lastSearchHasMatches = hasMatches || !currentSearchValue;
    updateSearchFallback(currentSearchValue, hasMatches);
    if (!currentSearchValue || hasMatches) {
        closeSearchOnlinePanel(false);
    }
}

function handleSearchEnter() {
    if (!currentSearchValue) {
        return;
    }
    if (!lastSearchHasMatches && currentSearchValue.length >= 2) {
        if (!isFeatureEnabled('torrentSearch')) {
            openSettingsModal();
            return;
        }
        startOnlineSearch(currentSearchValue);
    }
}

function updateSearchFallback(query, hasMatches) {
    if (!searchFallback) return;
    applySearchFallbackState();
    if (!query) {
        searchFallback.classList.add('hidden');
        return;
    }
    if (hasMatches) {
        searchFallback.classList.add('hidden');
    } else {
        searchFallback.classList.remove('hidden');
    }
}

function openSearchOnlinePanel(query) {
    if (!searchOnlinePanel || !isFeatureEnabled('torrentSearch')) return;
    searchOnlinePanel.classList.remove('hidden');
    if (searchOnlineTitle) {
        searchOnlineTitle.textContent = t('onlineResultsFor').replace('{query}', query);
    }
    if (searchOnlineStatus) {
        searchOnlineStatus.textContent = t('searchingTorrents');
    }
    if (searchOnlineResults) {
        searchOnlineResults.innerHTML = '';
    }
}

function closeSearchOnlinePanel(forceAbort = true) {
    if (!searchOnlinePanel) return;
    searchOnlinePanel.classList.add('hidden');
    if (searchOnlineStatus) {
        searchOnlineStatus.textContent = '';
    }
    if (searchOnlineResults) {
        searchOnlineResults.innerHTML = '';
    }
    if (forceAbort && onlineSearchAbort && typeof onlineSearchAbort.abort === 'function') {
        onlineSearchAbort.abort();
    }
    if (forceAbort) {
        onlineSearchAbort = null;
        onlineSearchState = { query: '', loading: false, results: [], error: null };
    }
}

async function startOnlineSearch(query) {
    if (!isFeatureEnabled('torrentSearch')) {
        applySearchFallbackState();
        return;
    }
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) {
        return;
    }
    if (onlineSearchAbort && typeof onlineSearchAbort.abort === 'function') {
        onlineSearchAbort.abort();
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    onlineSearchAbort = controller;
    onlineSearchState = { query: trimmed, loading: true, results: [], error: null };
    openSearchOnlinePanel(trimmed);
    try {
        const response = await fetch(`/api/torrents/search?q=${encodeURIComponent(trimmed)}`, {
            signal: controller?.signal
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || 'Arama gerçekleştirilemedi');
        }
        const payload = await response.json();
        const results = Array.isArray(payload.results) ? payload.results : [];
        onlineSearchState.results = results;
        onlineSearchState.loading = false;
        onlineSearchState.error = null;
        renderSearchOnlineResults(results, trimmed);
    } catch (error) {
        if (controller?.signal?.aborted) {
            return;
        }
        onlineSearchState.loading = false;
        onlineSearchState.error = error;
        if (searchOnlineStatus) {
            searchOnlineStatus.textContent = error.message || 'Arama sırasında bir hata oluştu.';
        }
        if (searchOnlineResults) {
            searchOnlineResults.innerHTML = '';
        }
    } finally {
        if (onlineSearchAbort === controller) {
            onlineSearchAbort = null;
        }
    }
}

function renderSearchOnlineResults(results, query) {
    if (!searchOnlineResults) return;
    if (searchOnlineTitle) {
        searchOnlineTitle.textContent = t('onlineResultsFor').replace('{query}', query);
    }
    searchOnlineResults.innerHTML = '';
    if (!Array.isArray(results) || results.length === 0) {
        if (searchOnlineStatus) {
            searchOnlineStatus.textContent = t('noResultsFound');
        }
        return;
    }
    if (searchOnlineStatus) {
        searchOnlineStatus.textContent = t('resultsFound').replace('{count}', results.length);
    }
    results.forEach(result => {
        const item = document.createElement('li');
        item.className = 'search-online-result';

        const info = document.createElement('div');
        info.className = 'search-online-info';

        const title = document.createElement('strong');
        title.textContent = result?.name || result?.title || 'Torrent';
        info.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'search-online-meta';

        const providerLabel = formatProviderLabel(result?.provider);
        if (providerLabel) {
            meta.appendChild(createMetaSpan(providerLabel));
        }
        if (result?.quality) {
            meta.appendChild(createMetaSpan(result.quality));
        }
        if (Number.isFinite(result?.year)) {
            meta.appendChild(createMetaSpan(String(result.year)));
        }
        if (Number.isFinite(result?.size) && result.size > 0) {
            meta.appendChild(createMetaSpan(formatBytes(result.size)));
        }
        const seeders = normalizeCount(result?.seeders);
        if (Number.isFinite(seeders)) {
            meta.appendChild(createMetaSpan(`${seeders} seed`));
        }
        const leechers = normalizeCount(result?.leechers);
        if (Number.isFinite(leechers) && leechers > 0) {
            meta.appendChild(createMetaSpan(`${leechers} peer`));
        }

        info.appendChild(meta);
        item.appendChild(info);

        const actionButton = document.createElement('button');
        actionButton.className = 'btn btn-primary btn-small';
        actionButton.type = 'button';
        actionButton.textContent = t('downloadButton');
        actionButton.addEventListener('click', async () => {
            await startTorrentDownload(result, actionButton);
        });
        item.appendChild(actionButton);

        searchOnlineResults.appendChild(item);
    });
}

async function startTorrentDownload(result, button) {
    if (!isFeatureEnabled('torrentSearch')) {
        return;
    }
    if (!result?.magnet) {
        return;
    }
    const originalText = button?.textContent;
    if (button) {
        button.disabled = true;
        button.textContent = t('startingDownload');
    }
    try {
        const response = await fetch('/api/torrents/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                magnet: result.magnet,
                name: result.name,
                provider: result.provider,
                size: result.size
            })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || 'İndirme başlatılamadı');
        }
        handleDownloadStarted(payload.download);
        if (searchOnlineStatus) {
            searchOnlineStatus.textContent = t('downloadStarted');
        }
        openDownloadPanel(true);
        await refreshDownloadStatus(true);
    } catch (error) {
        if (searchOnlineStatus) {
            searchOnlineStatus.textContent = error.message || t('downloadFailed');
        }
        if (/aria2c bulunamadı/i.test(error.message || '')) {
            downloadState.disabled = true;
            downloadState.statusMessage = error.message;
            stopDownloadPolling();
            renderDownloadPanel();
            updateDownloadToggleVisibility();
        }
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function handleDownloadStarted(download) {
    if (!isFeatureEnabled('torrentSearch')) {
        return;
    }
    if (!download || !download.id) return;
    downloadState.disabled = false;
    downloadState.statusMessage = null;
    downloadState.items.set(download.id, download);
    renderDownloadPanel();
    updateDownloadToggleVisibility();
    ensureDownloadPolling();
}

function updateDownloadStatusNote(message, isError = false) {
    if (!downloadStatusNote) return;
    if (!message) {
        downloadStatusNote.textContent = '';
        downloadStatusNote.classList.add('hidden');
        downloadStatusNote.classList.remove('download-note-error');
        return;
    }
    downloadStatusNote.textContent = message;
    downloadStatusNote.classList.toggle('download-note-error', Boolean(isError));
    downloadStatusNote.classList.remove('hidden');
}

async function requestDownloadAction(gid, action) {
    if (!isFeatureEnabled('torrentSearch')) {
        throw new Error('Torrent indirme devre dışı.');
    }
    if (!gid) {
        throw new Error('İndirme kimliği bulunamadı');
    }
    const response = await fetch(`/api/torrents/${encodeURIComponent(gid)}/${action}`, {
        method: 'POST'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || 'İşlem gerçekleştirilemedi');
    }
    if (payload.download?.id) {
        downloadState.items.set(payload.download.id, payload.download);
    } else if (action === 'cancel') {
        downloadState.items.delete(gid);
    }
    await refreshDownloadStatus(true);
}

async function controlDownload(gid, action, button) {
    if (!gid) return;
    const labelMap = {
        pause: t('pause') + '...',
        resume: t('resume') + '...',
        cancel: t('cancel') + '...'
    };
    const originalText = button?.textContent;
    if (button) {
        button.disabled = true;
        if (labelMap[action]) {
            button.textContent = labelMap[action];
        }
    }
    try {
        await requestDownloadAction(gid, action);
        updateDownloadStatusNote('', false);
        await loadStorageInfo({ fresh: true });
    } catch (error) {
        console.warn('İndirme kontrol hatası:', error.message);
        updateDownloadStatusNote(error.message || 'İşlem gerçekleştirilemedi', true);
    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText;
        }
    }
}

function createDownloadControl(label, variant = 'default') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'download-action';
    if (variant === 'danger') {
        button.classList.add('download-action-danger');
    }
    button.textContent = label;
    return button;
}

function renderDownloadPanel() {
    if (!downloadList) return;
    if (!isFeatureEnabled('torrentSearch')) {
        downloadList.innerHTML = '';
        if (downloadPanel) {
            downloadPanel.classList.add('hidden');
        }
        updateDownloadStatusNote('', false);
        return;
    }
    updateDownloadStatusNote(downloadState.statusMessage, downloadState.disabled);
    downloadList.innerHTML = '';

    if (downloadState.disabled) {
        const info = document.createElement('p');
        info.className = 'download-empty';
        info.textContent = downloadState.statusMessage || 'Torrent indirme sistemi devre dışı.';
        downloadList.appendChild(info);
        updateDownloadToggleVisibility();
        return;
    }

    const downloads = [...downloadState.items.values()].sort((a, b) => {
        const aTime = Date.parse(a.addedAt || '') || 0;
        const bTime = Date.parse(b.addedAt || '') || 0;
        return bTime - aTime;
    });
    if (downloads.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'download-empty';
        empty.textContent = t('noActiveDownloads');
        downloadList.appendChild(empty);
        return;
    }

    downloads.forEach(download => {
        const item = document.createElement('div');
        item.className = 'download-item';

        const title = document.createElement('p');
        title.className = 'download-item-title';
        title.textContent = download.name || t('downloadsTitle');
        item.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'download-item-meta';
        const statusLabel = formatDownloadStatus(download.status);
        if (statusLabel) {
            meta.appendChild(createMetaSpan(statusLabel));
        }
        const sizeLabel = Number.isFinite(download.size) && download.size > 0 ? formatBytes(download.size) : '';
        if (sizeLabel) {
            meta.appendChild(createMetaSpan(sizeLabel));
        }
        const percent = Math.round((download.progress || 0) * 100);
        if (['starting', 'downloading', 'verifying'].includes(download.status)) {
            if (Number.isFinite(download.downloadSpeed) && download.downloadSpeed > 0) {
                meta.appendChild(createMetaSpan(formatSpeed(download.downloadSpeed)));
            }
            if (Number.isFinite(download.eta) && download.eta > 0) {
                meta.appendChild(createMetaSpan(t('etaAbbr').replace('{eta}', formatEta(download.eta))));
            }
            if (Number.isFinite(download.peers) && download.peers > 0) {
                meta.appendChild(createMetaSpan(t('peers').replace('{count}', download.peers)));
            }
            meta.appendChild(createMetaSpan(`${Math.max(0, Math.min(100, percent))}%`));
        } else if (download.status === 'completed') {
            meta.appendChild(createMetaSpan('100%'));
        }
        item.appendChild(meta);

        const progressTrack = document.createElement('div');
        progressTrack.className = 'download-progress-track';
        const progressBar = document.createElement('div');
        progressBar.className = 'download-progress-bar';
        const safePercent = Math.max(0, Math.min(100, percent));
        progressBar.style.width = `${safePercent}%`;
        progressTrack.appendChild(progressBar);
        item.appendChild(progressTrack);

        if (download.status === 'failed' && download.error) {
            const error = document.createElement('p');
            error.className = 'download-error';
            error.textContent = download.error;
            item.appendChild(error);
        } else if (download.status === 'cancelled') {
            const note = document.createElement('p');
            note.className = 'download-item-note';
            note.textContent = t('downloadCancelled');
            item.appendChild(note);
        } else if (download.status === 'completed' && Array.isArray(download.finalFiles) && download.finalFiles.length > 0) {
            const note = document.createElement('p');
            note.className = 'download-item-note';
            note.textContent = t('downloadedTo').replace('{path}', download.finalFiles[0].relative);
            item.appendChild(note);
        }

        const actions = document.createElement('div');
        actions.className = 'download-actions';
        const gid = download.id;

        if (['starting', 'downloading', 'verifying'].includes(download.status)) {
            const pauseBtn = createDownloadControl(t('pause'));
            pauseBtn.addEventListener('click', () => controlDownload(gid, 'pause', pauseBtn));
            actions.appendChild(pauseBtn);
        } else if (download.status === 'paused') {
            const resumeBtn = createDownloadControl(t('resume'));
            resumeBtn.addEventListener('click', () => controlDownload(gid, 'resume', resumeBtn));
            actions.appendChild(resumeBtn);
        }

        if (!['completed', 'cancelled'].includes(download.status)) {
            const cancelBtn = createDownloadControl(t('cancel'), 'danger');
            cancelBtn.addEventListener('click', () => controlDownload(gid, 'cancel', cancelBtn));
            actions.appendChild(cancelBtn);
        }

        if (actions.children.length > 0) {
            item.appendChild(actions);
        }

        downloadList.appendChild(item);
    });

    updateDownloadToggleVisibility();
}

function openDownloadPanel(forceOpen = false) {
    if (!downloadPanel || !isFeatureEnabled('torrentSearch')) return;
    downloadPanel.classList.remove('hidden');
    downloadState.open = true;
    if (forceOpen) {
        updateDownloadToggleVisibility();
    }
    ensureDownloadPolling();
    refreshDownloadStatus(true).catch(() => {});
}

function closeDownloadPanel() {
    if (!downloadPanel) return;
    downloadPanel.classList.add('hidden');
    downloadState.open = false;
    updateDownloadToggleVisibility();
    evaluateDownloadPolling();
}

function updateDownloadToggleVisibility() {
    if (!downloadPanelToggle) return;
    if (!isFeatureEnabled('torrentSearch')) {
        downloadPanelToggle.classList.add('hidden');
        if (downloadPanel) {
            downloadPanel.classList.add('hidden');
        }
        return;
    }
    if (downloadState.disabled) {
        downloadPanelToggle.classList.remove('hidden');
        if (downloadActiveCount) {
            downloadActiveCount.classList.add('hidden');
        }
        return;
    }
    if (downloadState.items.size === 0) {
        downloadPanelToggle.classList.add('hidden');
        if (downloadActiveCount) {
            downloadActiveCount.classList.add('hidden');
        }
        return;
    }
    downloadPanelToggle.classList.remove('hidden');
    const activeCount = [...downloadState.items.values()].filter(item => ['starting', 'downloading', 'verifying'].includes(item.status)).length;
    if (downloadActiveCount) {
        if (activeCount > 0) {
            downloadActiveCount.textContent = String(activeCount);
            downloadActiveCount.classList.remove('hidden');
        } else {
            downloadActiveCount.classList.add('hidden');
        }
    }
}

function ensureDownloadPolling() {
    if (!isFeatureEnabled('torrentSearch')) {
        return;
    }
    if (downloadState.disabled) {
        return;
    }
    if (downloadState.polling) {
        return;
    }
    downloadState.polling = setInterval(() => {
        refreshDownloadStatus().catch(() => {});
    }, 4000);
    refreshDownloadStatus(true).catch(() => {});
}

function stopDownloadPolling() {
    if (!downloadState.polling) {
        return;
    }
    clearInterval(downloadState.polling);
    downloadState.polling = null;
}

function evaluateDownloadPolling(downloads = null) {
    if (!isFeatureEnabled('torrentSearch')) {
        stopDownloadPolling();
        return;
    }
    if (downloadState.disabled) {
        stopDownloadPolling();
        return;
    }
    const entries = downloads ?? [...downloadState.items.values()];
    const hasActive = entries.some(item => ['starting', 'downloading', 'verifying'].includes(item.status));
    if (!hasActive) {
        stopDownloadPolling();
    }
}

async function refreshDownloadStatus(force = false) {
    if (!isFeatureEnabled('torrentSearch')) {
        stopDownloadPolling();
        downloadState.fetching = false;
        return;
    }
    if (downloadState.fetching) {
        return;
    }
    if (!force && !downloadState.disabled && downloadState.items.size === 0 && !downloadState.open) {
        return;
    }
    downloadState.fetching = true;
    try {
        const response = await fetch('/api/torrents/downloads');
        if (!response.ok) {
            throw new Error('Durum alınamadı');
        }
        const payload = await response.json();
        const downloads = Array.isArray(payload.downloads) ? payload.downloads : [];
        const status = payload?.status;
        downloadState.disabled = Boolean(status && status.available === false);
        downloadState.statusMessage = status?.message || null;
        if (downloadState.disabled) {
            downloadState.items.clear();
            downloadState.completedSeen.clear();
            stopDownloadPolling();
        } else {
            downloadState.items.clear();
            downloads.forEach(item => {
                if (item?.id) {
                    downloadState.items.set(item.id, item);
                }
            });
        }
        renderDownloadPanel();
        updateDownloadToggleVisibility();
        if (!downloadState.disabled && downloadState.items.size > 0) {
            ensureDownloadPolling();
        } else if (downloadState.disabled || downloadState.items.size === 0) {
            stopDownloadPolling();
        }
        if (!downloadState.disabled) {
            const newlyCompleted = downloads.filter(item => item.status === 'completed' && item.id && !downloadState.completedSeen.has(item.id));
            if (newlyCompleted.length > 0) {
                newlyCompleted.forEach(item => downloadState.completedSeen.add(item.id));
                await loadLibrary();
                await loadStorageInfo({ fresh: true });
            }
        }
        evaluateDownloadPolling(downloads);
    } catch (error) {
        console.warn('İndirme durumu alınamadı:', error.message);
    } finally {
        downloadState.fetching = false;
    }
}

function openSettingsModal() {
    if (!settingsModal) return;
    applyFeatureFlags();
    settingsModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
    if (!settingsModal) return;
    settingsModal.classList.add('hidden');
    if (modal.classList.contains('hidden')) {
        document.body.style.overflow = '';
    }
}

function applyFeatureFlags() {
    if (!featureFlags || typeof featureFlags !== 'object') {
        featureFlags = { ...DEFAULT_FEATURE_FLAGS };
    }
    applySearchFallbackState();
    applyTorrentFeatureState(isFeatureEnabled('torrentSearch'));
    applySubtitleFeatureState(isFeatureEnabled('subtitles'));
    if (torrentToggle) {
        torrentToggle.checked = isFeatureEnabled('torrentSearch');
    }
    if (subtitleToggle) {
        subtitleToggle.checked = isFeatureEnabled('subtitles');
    }
}

function applyTorrentFeatureState(enabled) {
    if (searchOnlineButton) {
        searchOnlineButton.classList.toggle('hidden', !enabled);
    }
    if (!enabled) {
        closeSearchOnlinePanel();
        stopDownloadPolling();
        downloadState.open = false;
        downloadState.items.clear();
        downloadState.completedSeen.clear();
        downloadState.statusMessage = null;
    }
    renderDownloadPanel();
    updateDownloadToggleVisibility();
}

function applySubtitleFeatureState(enabled) {
    if (subtitleControlGroup) {
        subtitleControlGroup.classList.toggle('hidden', !enabled);
    }
    if (!subtitleSelect) {
        return;
    }
    if (!enabled) {
        subtitleSelect.innerHTML = '';
        const offOption = document.createElement('option');
        offOption.value = 'off';
        offOption.textContent = t('subtitleOff');
        subtitleSelect.appendChild(offOption);
        subtitleSelect.value = 'off';
        subtitleSelect.disabled = true;
        subtitleTracks.clear();
        Array.from(modalPlayer.querySelectorAll('track')).forEach(track => track.remove());
        applySubtitleSelection('off');
        return;
    }

    subtitleSelect.disabled = false;
    if (currentVideo && !modal.classList.contains('hidden')) {
        populateSubtitleOptions(currentVideo);
        Array.from(modalPlayer.querySelectorAll('track')).forEach(track => track.remove());
        if (Array.isArray(currentVideo.subtitles)) {
            currentVideo.subtitles.forEach(subtitle => {
                if (!subtitle?.src) return;
                const trackEl = document.createElement('track');
                trackEl.kind = 'subtitles';
                trackEl.label = subtitle.label || subtitle.lang?.toUpperCase() || t('subtitleLabel');
                if (subtitle.lang) {
                    trackEl.srclang = subtitle.lang;
                }
                trackEl.src = subtitle.src;
                if (subtitle.default) {
                    trackEl.default = true;
                }
                trackEl.setAttribute('data-track-id', subtitle.id);
                if (subtitle.lang) {
                    trackEl.setAttribute('data-track-lang', subtitle.lang);
                }
                modalPlayer.appendChild(trackEl);
            });
            prepareSubtitleTracks(currentVideo);
        }
    }
}

function applySearchFallbackState() {
    if (!searchFallback) return;
    const enabled = isFeatureEnabled('torrentSearch');
    if (searchOnlineButton) {
        searchOnlineButton.classList.toggle('hidden', !enabled);
    }
    if (searchFallbackMessage) {
        searchFallbackMessage.textContent = t('searchNoLocalMatch');
    }
}

function setFeatureFlag(key, value) {
    if (!(key in DEFAULT_FEATURE_FLAGS)) {
        return;
    }
    const enabled = Boolean(value);
    if (featureFlags[key] === enabled) {
        return;
    }
    featureFlags = {
        ...featureFlags,
        [key]: enabled
    };
    saveFeatureFlags(featureFlags);
    applyFeatureFlags();
    if (key === 'torrentSearch' && enabled) {
        refreshDownloadStatus(true).catch(() => {});
    }
    if (key === 'subtitles' && !enabled) {
        applySubtitleSelection('off');
    }
}

function loadFeatureFlags() {
    try {
        const stored = localStorage.getItem(FEATURE_FLAGS_KEY);
        if (!stored) {
            return { ...DEFAULT_FEATURE_FLAGS };
        }
        const parsed = JSON.parse(stored);
        return {
            torrentSearch: Boolean(parsed?.torrentSearch),
            subtitles: Boolean(parsed?.subtitles)
        };
    } catch (error) {
        console.warn('Özellik tercihleri okunamadı', error);
        return { ...DEFAULT_FEATURE_FLAGS };
    }
}

function saveFeatureFlags(flags) {
    try {
        localStorage.setItem(FEATURE_FLAGS_KEY, JSON.stringify(flags));
    } catch (error) {
        console.warn('Özellik tercihleri kaydedilemedi', error);
    }
}

function isFeatureEnabled(key) {
    if (!featureFlags || typeof featureFlags !== 'object') {
        return Boolean(DEFAULT_FEATURE_FLAGS[key]);
    }
    return Boolean(featureFlags[key]);
}

function loadLegalConsent() {
    try {
        const stored = localStorage.getItem(LEGAL_CONSENT_KEY);
        if (!stored) {
            return null;
        }
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object' && parsed.accepted === true) {
            return parsed;
        }
        return null;
    } catch (error) {
        console.warn('Yasal onay bilgisi okunamadı', error);
        return null;
    }
}

function saveLegalConsent() {
    try {
        const payload = {
            accepted: true,
            timestamp: Date.now()
        };
        localStorage.setItem(LEGAL_CONSENT_KEY, JSON.stringify(payload));
    } catch (error) {
        console.warn('Yasal onay kaydedilemedi', error);
    }
}

function hasLegalConsent() {
    const consent = loadLegalConsent();
    return Boolean(consent && consent.accepted === true);
}

function showLegalConsentOverlay() {
    if (!legalConsentOverlay) return;
    legalConsentOverlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    if (legalConsentMessage) {
        legalConsentMessage.textContent = '';
        legalConsentMessage.classList.add('hidden');
    }
}

function hideLegalConsentOverlay() {
    if (!legalConsentOverlay) return;
    legalConsentOverlay.classList.add('hidden');
    if (modal.classList.contains('hidden') && (!settingsModal || settingsModal.classList.contains('hidden'))) {
        document.body.style.overflow = '';
    }
}

function handleLegalRejection() {
    if (!legalConsentMessage) return;
    const msg = currentLang === 'en'
        ? 'You can only use this application by accepting these terms. If you do not wish to continue, you can close the window.'
        : 'Uygulamayı yalnızca bu şartları kabul ederek kullanabilirsin. Devam etmek istemiyorsan pencereyi kapatabilirsin.';
    legalConsentMessage.textContent = msg;
    legalConsentMessage.classList.remove('hidden');
}

function openRenameDialog(videoId, currentName) {
    const promptText = currentLang === 'en' ? 'Enter new title:' : 'Yeni film adını girin:';
    const newName = prompt(promptText, currentName);
    if (!newName || newName.trim() === '' || newName.trim() === currentName) {
        return;
    }
    handleRename(videoId, newName.trim());
}

async function handleRename(videoId, newTitle) {
    if (!videoId || !newTitle) {
        return;
    }
    
    try {
        const response = await fetch('/api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: videoId, title: newTitle })
        });
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            throw new Error(error.error || 'Yeniden adlandırma başarısız oldu');
        }
        
        const data = await response.json();
        if (data?.library) {
            updateLibrary(data.library);
        }
        
        // Başarı mesajı (opsiyonel)
        if (alertsSection && !alertsSection.classList.contains('hidden')) {
            const tempMessage = document.createElement('div');
            tempMessage.className = 'alert-success';
            const successMsg = currentLang === 'en' 
                ? `Renamed to "${newTitle}"`
                : `"${newTitle}" olarak yeniden adlandırıldı`;
            tempMessage.textContent = successMsg;
            tempMessage.style.cssText = 'padding: 12px; margin-bottom: 16px; background: #10b981; color: white; border-radius: 8px;';
            alertsSection.insertBefore(tempMessage, alertsSection.firstChild.nextSibling);
            setTimeout(() => tempMessage.remove(), 3000);
        }
    } catch (error) {
        const errorPrefix = currentLang === 'en' ? 'Error: ' : 'Hata: ';
        alert(errorPrefix + error.message);
    }
}

function createMetaSpan(text) {
    const span = document.createElement('span');
    span.textContent = text;
    return span;
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index += 1;
    }
    const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(1);
    return `${formatted} ${units[index]}`;
}

function formatSpeed(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
        return '';
    }
    return `${formatBytes(bytesPerSecond)}/sn`;
}

function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '';
    }
    const totalSeconds = Math.max(0, Math.round(seconds));
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    if (hrs > 0) {
        return `${hrs} sa ${mins.toString().padStart(2, '0')} dk`;
    }
    if (mins > 0) {
        return `${mins} dk ${secs.toString().padStart(2, '0')} sn`;
    }
    return `${secs} sn`;
}

function formatProviderLabel(provider) {
    if (!provider) return '';
    const map = {
        apibay: 'Pirate Bay',
        yts: 'YTS'
    };
    return map[provider] || provider;
}

function formatDownloadStatus(status) {
    const statusMap = {
        'starting': 'downloadStatusStarting',
        'downloading': 'downloadStatusDownloading',
        'verifying': 'downloadStatusVerifying',
        'paused': 'downloadStatusPaused',
        'completed': 'downloadStatusCompleted',
        'failed': 'downloadStatusFailed',
        'cancelled': 'downloadStatusCancelled'
    };
    return statusMap[status] ? t(statusMap[status]) : t('downloadStatusUnknown');
}

function normalizeCount(value) {
    if (Number.isFinite(value)) {
        return value;
    }
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : NaN;
}

if (legalAcceptButton) {
    legalAcceptButton.addEventListener('click', () => {
        saveLegalConsent();
        hideLegalConsentOverlay();
        init();
    });
}

if (legalRejectButton) {
    legalRejectButton.addEventListener('click', () => {
        handleLegalRejection();
    });
}

if (hasLegalConsent()) {
    hideLegalConsentOverlay();
    init();
} else {
    showLegalConsentOverlay();
}
