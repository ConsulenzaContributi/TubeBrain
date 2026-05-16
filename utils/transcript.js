// utils/transcript.js — Estrazione trascrizione da YouTube
// Usato dal content-script tramite iniezione nel contesto pagina

const Transcript = {

  normalizeChapters(chapters = [], segments = []) {
    const clean = Array.isArray(chapters)
      ? chapters
          .map(ch => ({
            title: (ch?.title || '').trim(),
            startMs: Number(ch?.startMs || 0),
          }))
          .filter(ch => ch.title)
      : [];

    if (clean.length > 0) return clean;
    if (!segments.length) return [];

    const totalDurationMs = segments[segments.length - 1]?.startMs || 0;
    const chunkCount = totalDurationMs > 0 ? Math.min(6, Math.max(2, Math.ceil(totalDurationMs / 600000))) : 0;
    if (!chunkCount) return [];

    const chunkSize = Math.max(1, Math.floor(segments.length / chunkCount));
    const generated = [];
    for (let i = 0; i < segments.length; i += chunkSize) {
      const seg = segments[i];
      if (!seg) continue;
      generated.push({
        title: `Sezione ${generated.length + 1}`,
        startMs: seg.startMs || 0,
      });
    }
    return generated;
  },

  assessTranscriptQuality(segments = [], track = null) {
    const segmentCount = Array.isArray(segments) ? segments.length : 0;
    if (!track || !segmentCount) {
      return {
        level: 'missing',
        score: 0,
        reason: 'Nessuna caption affidabile disponibile',
      };
    }

    const totalChars = segments.reduce((sum, seg) => sum + (seg.text || '').length, 0);
    const avgChars = segmentCount ? Math.round(totalChars / segmentCount) : 0;
    const repetitionCount = segments.reduce((sum, seg, index) => {
      if (index === 0) return sum;
      return sum + (segments[index - 1].text === seg.text ? 1 : 0);
    }, 0);

    let score = track.kind === 'asr' ? 68 : 88;
    if (avgChars < 12) score -= 12;
    if (repetitionCount > Math.max(3, Math.floor(segmentCount * 0.08))) score -= 10;
    if (segmentCount < 20) score -= 8;

    const level = score >= 84 ? 'high' : score >= 62 ? 'medium' : 'low';
    const reason = track.kind === 'asr'
      ? 'Caption auto-generate: usare cautela su codice parlato e nomi tecnici'
      : 'Caption manuali o curate: buona base per studio e ricostruzione';

    return { level, score, reason, avgChars, segmentCount };
  },

  /**
   * Inietta uno script nel contesto della pagina per accedere a
   * ytInitialPlayerResponse (variabile globale di YouTube).
   * Ritorna i dati via postMessage.
   */
  extractFromPage() {
    return new Promise((resolve, reject) => {
      const CHANNEL = 'LH_YT_DATA_' + Date.now();

      const script = document.createElement('script');
      script.textContent = `
        (function() {
          try {
            const pr = window.ytInitialPlayerResponse;
            if (!pr) { window.postMessage({ type: '${CHANNEL}', error: 'no_player_response' }, '*'); return; }

            const vd = pr.videoDetails || {};
            const captions = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

            // Capitoli dalla descrizione (YouTube li espone in playerMicroformatRenderer)
            const chapters = (pr?.playerMicroformatRenderer?.chapters || []).map(ch => ({
              title: ch.chapterRenderer?.title?.simpleText || '',
              startMs: parseInt(ch.chapterRenderer?.timeRangeStartMillis || 0)
            }));

            window.postMessage({
              type: '${CHANNEL}',
              data: {
                videoId: vd.videoId,
                title: vd.title,
                channelId: vd.channelId,
                channelName: vd.author,
                duration: parseInt(vd.lengthSeconds || 0),
                description: vd.shortDescription || '',
                captionTracks: captions.map(c => ({
                  baseUrl: c.baseUrl,
                  languageCode: c.languageCode,
                  kind: c.kind || 'manual',
                  name: c.name?.simpleText || c.languageCode
                })),
                chapters
              }
            }, '*');
          } catch(e) {
            window.postMessage({ type: '${CHANNEL}', error: e.message }, '*');
          }
        })();
      `;
      document.documentElement.appendChild(script);
      script.remove();

      const timeout = setTimeout(() => reject(new Error('Timeout estrazione dati YouTube')), 8000);

      window.addEventListener('message', function handler(event) {
        if (event.data?.type !== CHANNEL) return;
        window.removeEventListener('message', handler);
        clearTimeout(timeout);
        if (event.data.error) return reject(new Error(event.data.error));
        resolve(event.data.data);
      });
    });
  },

  /**
   * Dato un URL base di una caption track YouTube, scarica e parsa
   * il formato JSON3 (più affidabile di VTT per il nostro uso).
   */
  async fetchCaptionText(baseUrl, preferredLang = 'it') {
    // Tenta prima la lingua preferita, poi auto-generato, poi qualsiasi
    const url = new URL(baseUrl);
    url.searchParams.set('fmt', 'json3');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Caption fetch failed: ${res.status}`);
    const data = await res.json();

    return this.parseCaptionJson3(data);
  },

  /**
   * Parsea il formato JSON3 di YouTube in array di {startMs, text}.
   */
  parseCaptionJson3(data) {
    if (!data.events) return [];
    const segments = [];

    for (const event of data.events) {
      if (!event.segs) continue;
      const text = event.segs
        .map(s => s.utf8 || '')
        .join('')
        .replace(/\n/g, ' ')
        .trim();
      if (text && text !== '\n') {
        segments.push({ startMs: event.tStartMs || 0, text });
      }
    }
    return segments;
  },

  /**
   * Sceglie la caption track migliore dall'array disponibile.
   * Priorità: manuale nella lingua preferita > auto nella lingua preferita > qualsiasi manuale > qualsiasi.
   */
  selectBestTrack(tracks, preferredLang = 'it') {
    if (!tracks || tracks.length === 0) return null;

    const manual = tracks.filter(t => t.kind !== 'asr');
    const auto   = tracks.filter(t => t.kind === 'asr');

    return (
      manual.find(t => t.languageCode.startsWith(preferredLang)) ||
      auto.find(t => t.languageCode.startsWith(preferredLang)) ||
      manual[0] ||
      auto[0] ||
      tracks[0]
    );
  },

  /**
   * Converte array di segmenti in testo formattato con timestamp.
   * Raggruppa in blocchi da ~30 secondi per leggibilità.
   */
  formatTranscript(segments, chapters = []) {
    if (!segments.length) return '';
    const normalizedChapters = this.normalizeChapters(chapters, segments);

    // Se ci sono capitoli, usa quelli come delimitatori
    if (normalizedChapters.length > 0) {
      return this.formatWithChapters(segments, normalizedChapters);
    }

    // Altrimenti raggruppa per blocchi da 30s
    let result = '';
    let currentBlock = [];
    let blockStart = 0;
    const BLOCK_MS = 30000;

    for (const seg of segments) {
      if (seg.startMs - blockStart > BLOCK_MS && currentBlock.length > 0) {
        result += `[${this.msToTimestamp(blockStart)}] ${currentBlock.join(' ')}\n`;
        currentBlock = [];
        blockStart = seg.startMs;
      }
      currentBlock.push(seg.text);
    }
    if (currentBlock.length > 0) {
      result += `[${this.msToTimestamp(blockStart)}] ${currentBlock.join(' ')}\n`;
    }
    return result;
  },

  formatWithChapters(segments, chapters) {
    let result = '';
    for (let i = 0; i < chapters.length; i++) {
      const chStart = chapters[i].startMs;
      const chEnd   = chapters[i + 1]?.startMs ?? Infinity;
      const chSegs  = segments.filter(s => s.startMs >= chStart && s.startMs < chEnd);

      result += `\n## ${chapters[i].title} [${this.msToTimestamp(chStart)}]\n`;
      result += chSegs.map(s => `[${this.msToTimestamp(s.startMs)}] ${s.text}`).join('\n') + '\n';
    }
    return result;
  },

  msToTimestamp(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  },

  formatSeconds(seconds) {
    return this.msToTimestamp(seconds * 1000);
  },

  /**
   * Punto di ingresso principale: estrae tutto da una pagina YouTube attiva.
   * Chiamato dal content-script in risposta a un messaggio del popup.
   */
  async extractAll(settings = {}) {
    const preferredLang = settings.language === 'auto' ? navigator.language.slice(0,2) : (settings.language || 'it');

    const pageData = await this.extractFromPage();
    const track = this.selectBestTrack(pageData.captionTracks, preferredLang);

    if (!track) {
      return { ...pageData, transcript: '', transcriptSegments: [], warning: 'no_captions' };
    }

    const segments = await this.fetchCaptionText(track.baseUrl, preferredLang);
    const normalizedChapters = this.normalizeChapters(pageData.chapters, segments);
    const transcript = this.formatTranscript(segments, normalizedChapters);
    const transcriptQuality = this.assessTranscriptQuality(segments, track);

    return {
      ...pageData,
      chapters: normalizedChapters,
      transcript,
      transcriptSegments: segments,
      captionLang: track.languageCode,
      captionType: track.kind,
      transcriptQuality,
    };
  },
};

if (typeof module !== 'undefined') module.exports = Transcript;
