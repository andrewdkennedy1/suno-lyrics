// ==UserScript==
// @name         Suno → AE JSX (final-ms-fix: image-bottom button, strategy picker, CORS-safe, bracket-filter, robust time normalization)
// @namespace    http://tampermonkey.net/
// @version      3.1
// @description  Clamp button under cover image; on click choose timing strategy (word regroup / API lines / word regroup+balanced wrap); ignore [bracketed] words; robust seconds/ms/sample normalization; export AE JSX with per-word highlight; CORS-safe via GM_xmlhttpRequest.
// @author       you
// @match        https://suno.com/*
// @match        https://www.suno.com/*
// @grant        GM_xmlhttpRequest
// @connect      studio-api.prod.suno.com
// @run-at       document-idle
// ==/UserScript==

(function(){
  'use strict';

  // ======= CONFIG =================================================================
  const CFG = {
    // Grouping heuristics for word→line (you can tweak)
    GAP_BREAK: 0.45,          // seconds: split if gap between words exceeds this
    MAX_LINE_DURATION: 4.5,   // seconds: max duration for a single line
    MAX_CHARS: 42,            // soft cap on characters
    MAX_WORDS: 14,            // hard cap on words per line

    // Balanced wrap (strategy 3)
    WRAP_MIN_CHARS: 26,       // only wrap if line length >= this
    WRAP_TARGET: 36,          // target chars per line for balancing

    // AE highlight
    DEFAULT_HIGHLIGHT_CHUNK: 1,     // default in dialog: 1=per word
    HIGHLIGHT_COLOR: [1, 1, 0.35],  // RGB 0..1

    // AE text look/placement
    FONT_SIZE: 82,
    JUSTIFY: "CENTER",        // "LEFT" | "CENTER" | "RIGHT"
    BOTTOM_MARGIN: 140,       // px from bottom of comp
    FILL_COLOR: [1, 1, 1],    // RGB 0..1

    // Optional background pill
    ADD_BG: false,
    BG_PAD: 28,
    BG_COLOR: [0, 0, 0],
    BG_OPACITY: 60,

    // Comp defaults (used if no active comp)
    COMP_NAME: "Suno Lyrics",
    COMP_W: 1920,
    COMP_H: 1080,
    COMP_FPS: 30
  };
  // ===============================================================================

  const API_BASE = 'https://studio-api.prod.suno.com';
  const cache = {}; // songId -> { data, wordsClean, linesWord, linesWordWrapped, linesApi }
  let debounceTimer = null;

  // ---------- utils ----------
  function getCookie(name) {
    const v = `; ${document.cookie}`;
    const parts = v.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  }
  function parseSongIdFromUrl() {
    const m = location.pathname.match(/\/song\/([^/?#]+)/);
    return m ? m[1] : null;
  }
  function sanitizeFilename(s) {
    return String(s || 'suno').replace(/[^\w.-]+/g, '_');
  }
  function toAEArray(arr){ return '[' + (arr||[]).map(n=>Math.max(0,Math.min(1,Number(n)||0))).join(',') + ']'; }
  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  // --- TIME NORMALIZATION HELPERS ---
  function pickNum() {
    for (let i=0;i<arguments.length;i++) {
      const v = arguments[i];
      if (v === undefined || v === null) continue;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }
  // Extract various time representations from a record, plus meta for sample_rate
  function extractRawTimes(x, apiMeta) {
    // Prefer seconds-labeled
    let s = pickNum(x.start_s, x.startS, x.s, x.begin_s);
    let e = pickNum(x.end_s,   x.endS,   x.e, x.finish_s);

    // Ambiguous generic fields
    if (s === null) s = pickNum(x.start, x.begin, x.t0);
    if (e === null) e = pickNum(x.end,   x.finish, x.t1);

    // Milliseconds variants
    let s_ms = pickNum(x.start_ms, x.startMs, x.ms_start);
    let e_ms = pickNum(x.end_ms,   x.endMs,   x.ms_end);

    // Sample variants
    const sr = pickNum(apiMeta?.sample_rate, apiMeta?.sampleRate, apiMeta?.audio_sample_rate);
    let s_samples = pickNum(x.start_sample, x.sample_start, x.startFrame);
    let e_samples = pickNum(x.end_sample,   x.sample_end,   x.endFrame);

    return { s, e, s_ms, e_ms, s_samples, e_samples, sr };
  }
  // Convert to seconds with heuristics (seconds > samples > ms; detect ms by magnitude)
  function toSeconds(raw) {
    if (raw.s !== null && raw.e !== null) { return { s: raw.s, e: raw.e }; }
    if (raw.s_samples !== null && raw.e_samples !== null && raw.sr) {
      return { s: raw.s_samples / raw.sr, e: raw.e_samples / raw.sr };
    }
    if (raw.s_ms !== null && raw.e_ms !== null) { return { s: raw.s_ms / 1000, e: raw.e_ms / 1000 }; }
    if (raw.s !== null && raw.e !== null) {
      const maxVal = Math.max(raw.s, raw.e);
      if (maxVal > 600) return { s: raw.s / 1000, e: raw.e / 1000 }; // treat as ms if absurdly large for a song
      return { s: raw.s, e: raw.e };
    }
    const sAny = pickNum(raw.s, raw.s_samples && raw.sr ? raw.s_samples/raw.sr : null, raw.s_ms!=null ? raw.s_ms/1000 : null);
    const eAny = pickNum(raw.e, raw.e_samples && raw.sr ? raw.e_samples/raw.sr : null, raw.e_ms!=null ? raw.e_ms/1000 : null);
    if (sAny != null && eAny != null) return { s: sAny, e: eAny };
    return null;
  }

  // ---------- CORS-safe fetch of aligned data ----------
  async function fetchJSON(url, headers) {
    // Try normal fetch WITHOUT credentials (avoid wildcard+credentials CORS failure)
    try {
      const res = await fetch(url, { method:'GET', headers: headers||{}, mode:'cors', credentials:'omit' });
      if (res.ok) return await res.json();
    } catch(e) {/* ignore */}
    // Fallback: GM_xmlhttpRequest to bypass page CORS
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        return reject(new Error('GM_xmlhttpRequest not available'));
      }
      GM_xmlhttpRequest({
        method:'GET', url, headers: headers||{},
        onload: r => { try { resolve(JSON.parse(r.responseText)); } catch(err){ reject(err); } },
        onerror: reject, ontimeout: () => reject(new Error('GM_xmlhttpRequest timeout'))
      });
    });
  }

  async function getAlignedData(songId){
    if (cache[songId]?.data) return cache[songId].data;

    const token = getCookie('__session');
    if (!token) throw new Error('Missing __session token');

    const url = `${API_BASE}/api/gen/${songId}/aligned_lyrics/v2/`;
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
    const data = await fetchJSON(url, headers);
    if (!data) throw new Error('No data returned');
    cache[songId] = cache[songId] || {};
    cache[songId].data = data;
    return data;
  }

  // ---------- cleaning & helpers ----------
  const BRACKET_RX = /\[[^\]]*]/g; // remove [Verse], [Chorus], etc.

  function cleanBracketedText(s){
    // Remove bracketed tags anywhere, collapse whitespace
    return String(s||'').replace(BRACKET_RX, '').replace(/\s+/g,' ').trim();
  }

  function prepareWordsClean(data){
    // Capture meta for sample-rate conversions if present
    const meta = {
      sample_rate: pickNum(data?.sample_rate, data?.sampleRate, data?.audio_sample_rate)
    };

    // Prefer aligned_words; gently fallback to aligned_lyrics mapped to word-like shape
    const src = Array.isArray(data?.aligned_words) ? data.aligned_words
              : Array.isArray(data?.aligned_lyrics) ? data.aligned_lyrics.map(x=>({start_s:x.start_s,end_s:x.end_s,word:x.text||''}))
              : [];

    const wordsRaw = [];
    for (const x of src) {
      const rawTimes = extractRawTimes(x, meta);
      const sec = toSeconds(rawTimes);
      if (!sec) continue;

      const tRaw = (typeof x.word === 'string' ? x.word : (x.text||''));
      const cleaned = cleanBracketedText(tRaw);
      if (!cleaned) continue;

      wordsRaw.push({ start: sec.s, end: sec.e, text: cleaned });
    }

    // Heuristic: if it still looks like ms, rescale
    const maxEnd = wordsRaw.length ? Math.max.apply(null, wordsRaw.map(w => w.end)) : 0;
    if (maxEnd > 600) { for (const w of wordsRaw){ w.start/=1000; w.end/=1000; } }

    wordsRaw.sort((a,b) => a.start - b.start);
    return wordsRaw;
  }

  // ---------- word→line grouping ----------
  function isPunctToken(tok){ return /^[\.\,\!\?\:\;\…\)\]\}]+$/.test(tok); }
  function needsSpace(prevTok, currTok){ return prevTok==null ? false : !isPunctToken(currTok); }

  function joinTextAndTiming(chunk){
    let text = '';
    const charEnds = [];
    const times = [];
    for (let i=0;i<chunk.length;i++){
      const tok = chunk[i].text;
      if (needsSpace(i>0? chunk[i-1].text : null, tok)) text += ' ';
      text += tok;
      charEnds.push(text.length);
      times.push(chunk[i].end); // highlight keys at each word end
    }
    return { text, charEnds, times };
  }

  function makeLine(chunk){
    const j = joinTextAndTiming(chunk);
    return {
      start: chunk[0].start,
      end:   chunk[chunk.length-1].end,
      text:  j.text,
      charEnds: j.charEnds,
      times: j.times
    };
  }

  function groupWordsToLines(words){
    const L = [];
    let cur = [];
    for (let i=0;i<words.length;i++){
      const w = words[i];
      if (!cur.length){ cur.push(w); continue; }

      const last = cur[cur.length-1];
      const gap = Math.max(0, w.start - last.end);
      const candidate = cur.concat([w]);
      const dur = w.end - cur[0].start;
      const txtLen = joinTextAndTiming(candidate).text.length;

      let cut = false;
      if (gap > CFG.GAP_BREAK) cut = true;
      if (dur > CFG.MAX_LINE_DURATION) cut = true;
      if (txtLen > CFG.MAX_CHARS) cut = true;
      if (cur.length >= CFG.MAX_WORDS) cut = true;

      const lastTok = cur[cur.length-1].text;
      if (/[\.!\?…]$/.test(lastTok) && gap > (CFG.GAP_BREAK*0.6)) cut = true;

      if (cut){ L.push(makeLine(cur)); cur = [w]; }
      else { cur.push(w); }
    }
    if (cur.length) L.push(makeLine(cur));
    return L;
  }

  // Optional: balanced 2-line wrap inside a line using \n
  function balancedWrapText(text, target){
    if (!text || text.length < CFG.WRAP_MIN_CHARS) return text;
    const mid = Math.min(text.length, Math.max(1, target|0));
    let best = -1, bestDist = 1e9;
    for (let i=0;i<text.length;i++){
      if (text[i] === ' '){
        const d = Math.abs(i - mid);
        if (d < bestDist){ bestDist = d; best = i; }
      }
    }
    if (best <= 0 || best >= text.length-1) return text;
    return text.slice(0,best) + '\n' + text.slice(best+1);
  }

  function wrapLinesBalanced(lines){
    return lines.map(line => {
      const t = balancedWrapText(line.text, CFG.WRAP_TARGET);
      if (t === line.text) return line;
      return Object.assign({}, line, { text: t }); // length unchanged (space→newline), so charEnds ok
    });
  }

  // API line-level (raw) -> cleaned and normalized
  function linesFromApiAlignedLyrics(data){
    if (!Array.isArray(data?.aligned_lyrics)) return [];
    const meta = {
      sample_rate: pickNum(data?.sample_rate, data?.sampleRate, data?.audio_sample_rate)
    };
    const out = [];
    for (const L of data.aligned_lyrics){
      const sec = toSeconds(extractRawTimes(L, meta));
      if (!sec) continue;
      const text = cleanBracketedText(L.text||'');
      if (!text) continue;

      out.push({
        start: sec.s,
        end:   sec.e,
        text,
        charEnds: [text.length],
        times: [sec.e]
      });
    }
    const maxEnd = out.length ? Math.max.apply(null, out.map(w => w.end)) : 0;
    if (maxEnd > 600) { for (const w of out){ w.start/=1000; w.end/=1000; w.times = w.times.map(t=>t/1000); } }
    return out.sort((a,b)=>a.start-b.start);
  }

  // ---------- cache prepare ----------
  async function prepareForSong(songId){
    cache[songId] = cache[songId] || {};
    const data = await getAlignedData(songId);
    cache[songId].data = data;

    const wordsClean = cache[songId].wordsClean || prepareWordsClean(data);
    cache[songId].wordsClean = wordsClean;

    cache[songId].linesWord = cache[songId].linesWord || groupWordsToLines(wordsClean);
    cache[songId].linesApi = cache[songId].linesApi || linesFromApiAlignedLyrics(data);
    cache[songId].linesWordWrapped = cache[songId].linesWordWrapped || wrapLinesBalanced(cache[songId].linesWord);

    return cache[songId];
  }

  // ---------- AE JSX generator (defensive, justification-safe) ----------
  function generateAEJSX(lines, songId, opts){
    const endTime = Math.max(lines.length ? (lines[lines.length-1].end + 3) : 10, 10);
    const wantJust = (opts.justify || CFG.JUSTIFY || "CENTER");
    const hiChunk = Math.max(1, (opts.highlightChunk|0) || CFG.DEFAULT_HIGHLIGHT_CHUNK);
    const hiColor = toAEArray(opts.highlightColor || CFG.HIGHLIGHT_COLOR);
    const fillCol = toAEArray(opts.fillColor || CFG.FILL_COLOR);
    const addBg   = !!opts.addBg;
    const bgColor = toAEArray(opts.bgColor || CFG.BG_COLOR);
    const bgPad   = opts.bgPad != null ? opts.bgPad : CFG.BG_PAD;
    const bgOp    = clamp(opts.bgOpacity != null ? opts.bgOpacity : CFG.BG_OPACITY, 0, 100);
    const fontSize= opts.fontSize || CFG.FONT_SIZE;
    const bottom  = opts.bottomMargin || CFG.BOTTOM_MARGIN;
    const compW   = opts.compW || CFG.COMP_W;
    const compH   = opts.compH || CFG.COMP_H;
    const compFps = opts.compFps || CFG.COMP_FPS;
    const compName= opts.compName || CFG.COMP_NAME;
    const offset  = Number(opts.offset||0); // seconds; can be negative

    // Apply offset to timings
    const LINES = lines.map(L => ({
      start: +(L.start + offset).toFixed(3),
      end:   +(L.end   + offset).toFixed(3),
      text:  L.text,
      charEnds: L.charEnds.slice(),
      times: L.times.map(t => +(t + offset).toFixed(3))
    }));

    return `/* Generated by Suno→AE (final-ms-fix) — ${sanitizeFilename(songId||'suno')}_import_to_AE.jsx
   Usage: After Effects → File → Scripts → Run Script File…
*/
(function(){
  function ensureComp(){
    var proj = app.project;
    if (!proj){ alert("Open or create a project first."); return null; }
    var comp = proj.activeItem;
    if (!(comp && typeof comp.width === 'number' && typeof comp.height === 'number')){
      comp = proj.items.addComp(${JSON.stringify(compName)}, ${compW}, ${compH}, 1, ${endTime.toFixed(3)}, ${compFps});
    } else if (comp.duration < ${endTime.toFixed(3)}){
      comp.duration = ${endTime.toFixed(3)};
    }
    return comp;
  }

  function safeSetJustification(td, want){
    try {
      if (typeof ParagraphJustification !== 'undefined') {
        var map = {LEFT:'LEFT_JUSTIFY', CENTER:'CENTER_JUSTIFY', RIGHT:'RIGHT_JUSTIFY'};
        var key = map[want] || 'CENTER_JUSTIFY';
        if (ParagraphJustification[key] !== undefined) {
          td.justification = ParagraphJustification[key];
          return true;
        }
      }
    } catch(e){}
    return false;
  }

  function visualAlignByAnchor(layer, want){
    var r = layer.sourceRectAtTime(layer.inPoint, false);
    var ax = (want==='LEFT') ? r.left : (want==='RIGHT') ? (r.left + r.width) : (r.left + r.width/2);
    var ay = r.top + r.height/2;
    var tr = layer.property("ADBE Transform Group");
    tr.property("ADBE Anchor Point").setValue([ax, ay]);
    tr.property("ADBE Position").setValue([layer.containingComp.width/2, layer.containingComp.height - ${bottom}]);
  }

  function addHighlightAnimator(textLayer, line){
    var animators = textLayer.property("ADBE Text Animators");
    if (!animators) return;
    var animator  = animators.addProperty("ADBE Text Animator");
    if (!animator) return;
    var props     = animator.property("ADBE Text Animator Properties");
    if (!props) return;
    var fill      = props.addProperty("ADBE Text Fill Color");
    if (fill) fill.setValue(${hiColor});
    var sels      = animator.property("ADBE Text Selectors");
    if (!sels) return;
    var range     = sels.addProperty("ADBE Text Selector");
    if (!range) return;

    var startProp = range.property("ADBE Text Percent Start");
    var endProp   = range.property("ADBE Text Percent End");
    if (!startProp || !endProp) return;

    var totalChars = (line.text||"").length;
    function pct(ci){ return totalChars>0 ? Math.max(0, Math.min(100, (ci/totalChars)*100)) : 0; }

    startProp.setValue(0);
    endProp.setValueAtTime(Math.max(0, line.start), 0);

    var chunk = ${hiChunk};
    for (var i=0;i<line.charEnds.length;i++){
      if ((i+1)%chunk!==0 && i!==line.charEnds.length-1) continue;
      endProp.setValueAtTime(Math.max(0, line.times[i]), pct(line.charEnds[i]));
    }
    try {
      for (var k=1;k<=endProp.numKeys;k++){
        endProp.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
      }
    } catch(e){}
  }

  function buildTextLayer(comp, line, idx){
    var layer = comp.layers.addText(line.text);
    layer.name = "Line " + (idx+1);
    var tdProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var td = tdProp.value;
    td.fontSize = ${fontSize};
    td.applyFill = true;
    td.fillColor = ${fillCol};
    td.applyStroke = false;
    var setOK = safeSetJustification(td, "${wantJust}");
    tdProp.setValue(td);

    layer.inPoint  = Math.max(0, line.start);
    layer.outPoint = Math.max(layer.inPoint + 0.01, line.end);
    layer.startTime = layer.inPoint;

    layer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width/2, comp.height - ${bottom}]);
    if (!setOK) visualAlignByAnchor(layer, "${wantJust}");

    if (${addBg ? 'true':'false'}){
      var bg = comp.layers.addShape();
      bg.name = layer.name + " BG";
      var grp = bg.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
      var rect = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
      var fill = grp.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
      if (fill) {
        fill.property("ADBE Vector Fill Color").setValue(${bgColor});
        fill.property("ADBE Vector Fill Opacity").setValue(${bgOp});
      }
      if (rect) {
        rect.property("ADBE Vector Rect Size").expression =
          'var t=thisComp.layer("' + layer.name.replace(/"/g,'\\"') + '");\\n' +
          'var r=t.sourceRectAtTime(time,false);\\n' +
          '[' + ${bgPad} + '+r.width+' + ${bgPad} + ', ' + ${bgPad} + '+r.height+' + ${bgPad} + ']';
        rect.property("ADBE Vector Rect Position").setValue([0,0]);
      }
      bg.property("ADBE Transform Group").property("ADBE Position").expression =
        'var t=thisComp.layer("' + layer.name.replace(/"/g,'\\"') + '");\\n' +
        't.toComp(t.sourceRectAtTime(time,false).anchorPoint)';
      bg.moveBefore(layer);
    }

    addHighlightAnimator(layer, line);
  }

  var LINES = ${JSON.stringify(LINES)};
  app.beginUndoGroup("Import Suno Lyrics");
  try {
    var comp = ensureComp();
    if (!comp) return;
    for (var i=0;i<LINES.length;i++){
      buildTextLayer(comp, LINES[i], i);
    }
  } catch(e){ alert("Error: " + e.toString()); }
  finally { app.endUndoGroup(); }
})();`;
  }

  // ---------- debug output functions ----------
  function downloadFile(content, filename, type = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function generateDebugFiles(songId, data, prepared) {
    const baseName = sanitizeFilename(songId || 'suno');
    
    // 1. Raw API response
    downloadFile(
      JSON.stringify(data, null, 2),
      `${baseName}_1_raw_api_response.json`
    );
    
    // 2. Cleaned words with timing analysis
    const timingAnalysis = {
      wordsClean: prepared.wordsClean,
      timingStats: {
        totalWords: prepared.wordsClean.length,
        maxStartTime: Math.max(...prepared.wordsClean.map(w => w.start)),
        maxEndTime: Math.max(...prepared.wordsClean.map(w => w.end)),
        avgDuration: prepared.wordsClean.reduce((sum, w) => sum + (w.end - w.start), 0) / prepared.wordsClean.length,
        suspectedUnit: Math.max(...prepared.wordsClean.map(w => w.end)) > 600 ? 'milliseconds' : 'seconds'
      }
    };
    downloadFile(
      JSON.stringify(timingAnalysis, null, 2),
      `${baseName}_2_cleaned_words_analysis.json`
    );
    
    // 3. All line strategies comparison
    const lineComparison = {
      wordGrouped: prepared.linesWord,
      apiLines: prepared.linesApi,
      wordWrapped: prepared.linesWordWrapped,
      stats: {
        wordGroupedCount: prepared.linesWord.length,
        apiLinesCount: prepared.linesApi.length,
        wordWrappedCount: prepared.linesWordWrapped.length
      }
    };
    downloadFile(
      JSON.stringify(lineComparison, null, 2),
      `${baseName}_3_line_strategies_comparison.json`
    );
    
    // 4. Raw timing data for first 10 items
    const rawSample = Array.isArray(data?.aligned_words) ? data.aligned_words.slice(0, 10) 
                    : Array.isArray(data?.aligned_lyrics) ? data.aligned_lyrics.slice(0, 10)
                    : [];
    const rawTimingData = {
      sampleData: rawSample,
      detectedFields: {
        hasAlignedWords: Array.isArray(data?.aligned_words),
        hasAlignedLyrics: Array.isArray(data?.aligned_lyrics),
        sampleRate: data?.sample_rate || data?.sampleRate || data?.audio_sample_rate || 'not_found',
        firstItemKeys: rawSample[0] ? Object.keys(rawSample[0]) : []
      }
    };
    downloadFile(
      JSON.stringify(rawTimingData, null, 2),
      `${baseName}_4_raw_timing_sample.json`
    );
  }

  // ---------- mini modal for strategy selection ----------
  function showStrategyDialog(defaults){
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 999999;
      background: rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center;`;
    const card = document.createElement('div');
    card.style.cssText = `
      min-width: 320px; max-width: 480px; background:#161616; color:#fff;
      border-radius: 10px; padding: 16px; font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;`;
    card.innerHTML = `
      <div style="font-size:16px; font-weight:600; margin-bottom:8px;">Export Settings</div>
      <div style="font-size:12px; opacity:0.8; margin-bottom:10px;">Choose timing strategy and options.</div>
      <label style="display:block; margin:6px 0;">
        <input type="radio" name="strategy" value="word" checked> Word-level regroup (recommended)
      </label>
      <label style="display:block; margin:6px 0;">
        <input type="radio" name="strategy" value="api"> API line-level (raw)
      </label>
      <label style="display:block; margin:6px 0 12px;">
        <input type="radio" name="strategy" value="wordwrap"> Word-level regroup + balanced 2-line wrap
      </label>

      <div style="display:flex; gap:10px; margin:8px 0;">
        <label style="flex:1; font-size:12px;">
          Highlight chunk
          <select id="hlchunk" style="width:100%; padding:4px; border-radius:6px;">
            <option value="1">Per word (1)</option>
            <option value="2">Pairs (2)</option>
            <option value="3">Triplets (3)</option>
            <option value="4">Quad (4)</option>
          </select>
        </label>
        <label style="flex:1; font-size:12px;">
          Global offset (s)
          <input id="offset" type="number" step="0.05" value="${defaults.offset!=null?defaults.offset:0}"
                 style="width:100%; padding:4px; border-radius:6px;">
        </label>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
        <button id="debug" style="padding:6px 10px; border-radius:8px; background:#FF9800; color:#fff; border:0; cursor:pointer;">Debug Files</button>
        <button id="cancel" style="padding:6px 10px; border-radius:8px; background:#444; color:#fff; border:0; cursor:pointer;">Cancel</button>
        <button id="ok" style="padding:6px 10px; border-radius:8px; background:#4CAF50; color:#fff; border:0; cursor:pointer;">Build JSX</button>
      </div>
    `;
    overlay.appendChild(card);

    card.querySelector('#hlchunk').value = String(defaults.highlightChunk || CFG.DEFAULT_HIGHLIGHT_CHUNK);
    if (defaults.strategy) {
      const el = card.querySelector(`input[name="strategy"][value="${defaults.strategy}"]`);
      if (el) el.checked = true;
    }

    return new Promise((resolve) => {
      card.querySelector('#cancel').onclick = () => { document.body.removeChild(overlay); resolve(null); };
      card.querySelector('#debug').onclick = () => {
        document.body.removeChild(overlay);
        resolve({ debugOnly: true });
      };
      card.querySelector('#ok').onclick = () => {
        const strategy = card.querySelector('input[name="strategy"]:checked')?.value || 'word';
        const highlightChunk = parseInt(card.querySelector('#hlchunk').value, 10) || 1;
        const offset = parseFloat(card.querySelector('#offset').value) || 0;
        document.body.removeChild(overlay);
        resolve({ strategy, highlightChunk, offset });
      };
    });
  }

  // ---------- button under image (lazy: no network until click) ----------
  function selectCoverImages() {
    // Keep to 'object-cover' which Suno still uses; height check avoids tiny thumbs
    return Array.from(document.querySelectorAll('img.object-cover'))
      .filter(img => img.getBoundingClientRect().height > 100);
  }

  function attachButtons(){
    const songId = parseSongIdFromUrl();
    if (!songId) return;

    const imgs = selectCoverImages();
    imgs.forEach(img => {
      const parent = img.parentElement || img;
      if (!parent) return;
      if (parent.querySelector('.my-suno-download-button')) return;

      // Ensure parent anchors absolute children
      const cs = getComputedStyle(parent);
      if (cs.position === 'static') parent.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'my-suno-download-button';
      btn.textContent = 'Download AE JSX';
      btn.style.position = 'absolute';
      btn.style.bottom = '0';
      btn.style.left = '0';
      btn.style.right = '0';
      btn.style.background = '#4CAF50';
      btn.style.color = '#fff';
      btn.style.border = 'none';
      btn.style.borderRadius = '5px';
      btn.style.padding = '10px 6px';
      btn.style.cursor = 'pointer';
      btn.style.zIndex = '99999';

      btn.addEventListener('click', async () => {
        if (btn.dataset.busy === '1') return;
        btn.dataset.busy = '1';
        const original = btn.textContent;
        btn.textContent = 'Loading…';
        btn.disabled = true;

        try {
          const pick = await showStrategyDialog({
            strategy: 'word',
            highlightChunk: CFG.DEFAULT_HIGHLIGHT_CHUNK,
            offset: 0
          });
          if (!pick){ btn.textContent = original; btn.disabled = false; btn.dataset.busy='0'; return; }

          // fetch & prep only now
          const prepared = await prepareForSong(songId);
          const data = cache[songId].data;

          // If debug only, generate debug files and exit
          if (pick.debugOnly) {
            generateDebugFiles(songId, data, prepared);
            btn.textContent = 'Debug files downloaded ✓';
            btn.disabled = false;
            btn.dataset.busy = '0';
            setTimeout(() => { btn.textContent = original; }, 2000);
            return;
          }

          let lines;
          if (pick.strategy === 'api') {
            lines = prepared.linesApi;
          } else if (pick.strategy === 'wordwrap') {
            lines = prepared.linesWordWrapped;
          } else {
            lines = prepared.linesWord;
          }

          if (!lines || !lines.length) throw new Error('No lines available for export');

          const jsx = generateAEJSX(lines, songId, {
            justify: CFG.JUSTIFY,
            highlightChunk: pick.highlightChunk,
            highlightColor: CFG.HIGHLIGHT_COLOR,
            fillColor: CFG.FILL_COLOR,
            addBg: CFG.ADD_BG,
            bgColor: CFG.BG_COLOR,
            bgOpacity: CFG.BG_OPACITY,
            bgPad: CFG.BG_PAD,
            fontSize: CFG.FONT_SIZE,
            bottomMargin: CFG.BOTTOM_MARGIN,
            compW: CFG.COMP_W, compH: CFG.COMP_H, compFps: CFG.COMP_FPS, compName: CFG.COMP_NAME,
            offset: pick.offset
          });

          downloadFile(jsx, `${sanitizeFilename(songId||'suno')}_import_to_AE.jsx`);

          btn.textContent = 'Done ✓  (click again to re-download)';
        } catch (err) {
          console.error('[Suno→AE] Export error:', err);
          btn.textContent = 'Error — Retry';
        } finally {
          btn.disabled = false;
          btn.dataset.busy = '0';
          setTimeout(() => { if (btn.textContent.startsWith('Done')) btn.textContent = 'Download AE JSX'; }, 2000);
        }
      });

      parent.appendChild(btn);
    });
  }

  // ---------- light observers / SPA hooks ----------
  function debouncedAttach(){
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(attachButtons, 300);
  }

  (function (history) {
    const push = history.pushState, rep = history.replaceState;
    function ping(){ window.dispatchEvent(new Event('urlchange')); }
    history.pushState = function(){ const r = push.apply(this, arguments); ping(); return r; };
    history.replaceState = function(){ const r = rep.apply(this, arguments); ping(); return r; };
    window.addEventListener('popstate', ping);
  })(window.history);

  window.addEventListener('urlchange', () => setTimeout(attachButtons, 400));
  const mo = new MutationObserver(debouncedAttach);
  mo.observe(document.body, { childList: true, subtree: true });

  // First pass
  setTimeout(attachButtons, 600);
})();
