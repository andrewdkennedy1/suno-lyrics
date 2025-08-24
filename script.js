// ==UserScript==
// @name         Suno → AE Lyric Slides (BoxText Fix)
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Non-overlapping lyric slides (2–4 lines) using BOX TEXT, timed highlights, tidy comps/folders
// @author       you
// @match        https://suno.com/*
// @match        https://www.suno.com/*
// @grant        GM_xmlhttpRequest
// @connect      studio-api.prod.suno.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  /*** -------------------------- CONFIG -------------------------- ***/
  const API_BASE = 'https://studio-api.prod.suno.com';

  const MIN_LINES_PER_SLIDE = 2;
  const MAX_LINES_PER_SLIDE = 4;

  const COMP_WIDTH = 1920;
  const COMP_HEIGHT = 1080;
  const FPS = 60;

  const SAFE_X = 160;
  const SAFE_W = COMP_WIDTH - SAFE_X * 2;
  const BLOCK_CENTER_Y = 860;

  const USE_BG = false;   // ← turn background plate off

  const FONT_FAMILY = "Roboto-Bold";
  const COLOR_BASE = [0.85, 0.85, 0.85];
  const COLOR_HI   = [1.00, 1.00, 1.00];
  const STROKE_COLOR = [0, 0, 0];
  const STROKE_WIDTH = 0;

  const BG_OPACITY = 55;
  const BG_PAD_X = 80;
  const BG_PAD_Y = 40;

  const SLIDE_TAIL_PAD = 0.25;
  const SLIDE_GAP      = 0.033;
  const FADE_IN  = 0.12;
  const FADE_OUT = 0.12;

  /*** ------------------------ UTILITIES ------------------------- ***/
  function getCookie(name) {
    const v = `; ${document.cookie}`;
    const parts = v.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
  }

  function parseSongIdFromUrl() {
    const m = location.pathname.match(/\/song\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function fetchData(songId) {
    const token = getCookie('__session');
    const url = `${API_BASE}/api/gen/${songId}/aligned_lyrics/v2/`;
    const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        onload: r => {
          try { resolve(JSON.parse(r.responseText)); }
          catch (err) { reject(err); }
        },
        onerror: reject
      });
    });
  }

  /*** ------------------ LYRICS → SLIDES (2–4) ------------------- ***/
  function normalizeLines(raw) {
    const lines = raw.aligned_lyrics || raw.lines || raw;
    const valid = (lines || [])
      .filter(l => typeof l.text === "string" && l.text.trim())
      .filter(l => !/^\s*\[[^\]]+\]\s*$/i.test(l.text.trim()))
      .map(l => ({ text: l.text.replace(/\s+/g, ' ').trim(), start: +l.start_s, end: +l.end_s }))
      .filter(l => Number.isFinite(l.start) && Number.isFinite(l.end) && l.end > l.start)
      .sort((a, b) => a.start - b.start);
    return valid;
  }

  function groupIntoSlides(lines) {
    const slides = [];
    let i = 0;
    const MAX_JOIN_GAP = 7.0;
    const MAX_CHARS_PER_SLIDE = 180;

    while (i < lines.length) {
      let slide = [];
      let chars = 0;
      while (slide.length < MIN_LINES_PER_SLIDE && i < lines.length) {
        slide.push(lines[i]); chars += lines[i].text.length; i++;
      }
      while (slide.length < MAX_LINES_PER_SLIDE && i < lines.length) {
        const next = lines[i];
        const gapOk = (next.start - slide[0].start) <= MAX_JOIN_GAP;
        const charOk = (chars + next.text.length) <= MAX_CHARS_PER_SLIDE;
        if (!(gapOk && charOk)) break;
        slide.push(next); chars += next.text.length; i++;
      }
      slides.push(slide);
    }

    if (slides.length >= 2) {
      const last = slides[slides.length - 1];
      const prev = slides[slides.length - 2];
      if (last.length === 1 && prev.length > MIN_LINES_PER_SLIDE) last.unshift(prev.pop());
    }

    return slides.map((block, idx, arr) => {
      const start = Math.min(...block.map(l => l.start));
      const naturalEnd = Math.max(...block.map(l => l.end));
      const nextStart = arr[idx + 1] ? Math.min(...arr[idx + 1].map(l => l.start)) : null;
      let end = naturalEnd + SLIDE_TAIL_PAD;
      if (nextStart != null) end = Math.min(end, Math.max(start + 0.1, nextStart - SLIDE_GAP));
      return { index: idx + 1, start, end, lines: block };
    });
  }

  function computeDuration(validLines) {
    const lastEnd = validLines.length ? validLines[validLines.length - 1].end : 0;
    return Math.max(240, (lastEnd || 0) + 10);
  }
  function firstLyricStart(validLines) { return validLines.length ? validLines[0].start : 0; }

  /*** ------------------------ JSX EMITTER ------------------------ ***/
  function generateJSX(songId, slides, totalDuration, firstStart) {
    const payload = {
      songId, slides, totalDuration, firstStart,
      layout: {
        compWidth: COMP_WIDTH, compHeight: COMP_HEIGHT, fps: FPS,
        safeX: SAFE_X, safeW: SAFE_W, baseY: BLOCK_CENTER_Y,
        fontFamily: FONT_FAMILY, colorBase: COLOR_BASE, colorHi: COLOR_HI,
        strokeColor: STROKE_COLOR, strokeWidth: STROKE_WIDTH,
        bgOpacity: BG_OPACITY, bgPadX: BG_PAD_X, bgPadY: BG_PAD_Y,
        fadeIn: FADE_IN, fadeOut: FADE_OUT,
        useBg: USE_BG                // ← add this
      }
    };

    return `// Suno → AE Lyric Slides (BOX TEXT)
// Song: ${songId}
(function(){
  app.beginUndoGroup("Import Suno Lyrics Slides - ${songId}");
  var proj = app.project || app.newProject();

  function pad(n, w){ n = String(n); return (n.length>=w)?n:new Array(w-n.length+1).join("0")+n; }

  var P = ${JSON.stringify(payload, null, 2)};

  // ---------- Project Structure ----------
  function ensureFolder(name, parent){
    var f = proj.items.addFolder(name);
    if(parent) f.parentFolder = parent;
    return f;
  }

  var rootFolder = ensureFolder("Suno_" + P.songId, null);
  var compsFolder = ensureFolder("Comps", rootFolder);
  var slidesFolder = ensureFolder("Slides", rootFolder);
  var assetsFolder = ensureFolder("Assets", rootFolder);

  // ---------- Comp Helpers ----------
  function addComp(name, dur){
    var c = proj.items.addComp(name, P.layout.compWidth, P.layout.compHeight, 1, dur, P.layout.fps);
    c.parentFolder = compsFolder;
    return c;
  }
  function addSlideComp(name, dur){
    var c = proj.items.addComp(name, P.layout.compWidth, P.layout.compHeight, 1, dur, P.layout.fps);
    c.parentFolder = slidesFolder;
    return c;
  }

  // ---------- Text / FX Helpers ----------
  function setTextDoc(layer, textString, fontSize, leading, boxW, boxH, posY, colorArray, withStroke){
    // layer MUST be created with addBoxText([w,h])
    var txtProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var td = txtProp.value;
    td.text = textString;
    td.font = P.layout.fontFamily;
    td.fontSize = fontSize;
    td.applyFill = true;
    td.fillColor = colorArray;
    td.applyStroke = !!withStroke;
    td.strokeColor = P.layout.strokeColor;
    td.strokeWidth = P.layout.strokeWidth;
    td.justification = ParagraphJustification.CENTER_JUSTIFY;
    td.leading = Math.round(leading);
    td.tracking = 0;
    td.boxTextSize = [boxW, boxH]; // valid for box text

    txtProp.setValue(td);
    layer.property("ADBE Transform Group").property("ADBE Position").setValue([P.layout.compWidth/2, posY]);
  }

  function addDropShadow(layer){
    try{
      var fx = layer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
      fx.property("ADBE Drop Shadow-0001").setValue([0,0,0]); // Shadow Color (black)
      fx.property("ADBE Drop Shadow-0002").setValue(40);      // Opacity (softer)
      fx.property("ADBE Drop Shadow-0003").setValue(4);       // Direction
      fx.property("ADBE Drop Shadow-0004").setValue(6);       // Distance (closer)
      fx.property("ADBE Drop Shadow-0005").setValue(12);      // Softness (more feathered)
    }catch(e){}
  }

  function addBackgroundPlate(c, boxW, boxH, posY){
    var shape = c.layers.addShape();
    var contents = shape.property("ADBE Root Vectors Group");
    var rect = contents.addProperty("ADBE Vector Shape - Rect");
    rect.property("ADBE Vector Rect Size").setValue([boxW + P.layout.bgPadX*2, boxH + P.layout.bgPadY*2]);
    rect.property("ADBE Vector Rect Position").setValue([0,0]);
    var fill = contents.addProperty("ADBE Vector Graphic - Fill");
    fill.property("ADBE Vector Fill Color").setValue([0,0,0]);
    fill.property("ADBE Vector Fill Opacity").setValue(P.layout.bgOpacity);
    shape.property("ADBE Transform Group").property("ADBE Position").setValue([P.layout.compWidth/2, posY]);
    shape.moveToEnd();
    return shape;
  }

  function fontForLines(count){
    if(count <= 2) return { size: 72, leading: 84 };
    if(count === 3) return { size: 64, leading: 76 };
    return { size: 58, leading: 70 };
  }

  function overlayText(lines, activeIndex){
    var out = [];
    for(var i=0;i<lines.length;i++){ out.push(i===activeIndex ? lines[i].text : " "); }
    return out.join("\\r");
  }

  // ---------- Build Comps ----------
  var mainComp = addComp("Main_" + P.songId, P.totalDuration);
  var masterComp = addComp(P.songId + "_Lyrics_Master", P.totalDuration);

  for(var s=0; s<P.slides.length; s++){
    var slide = P.slides[s];
    var nLines = slide.lines.length;
    var fonts = fontForLines(nLines);

    var boxW = P.layout.safeW;
    var boxH = Math.round(fonts.leading * nLines * 1.35);
    var slideDur = Math.max(0.5, slide.end - slide.start + 0.01);
    var slideComp = addSlideComp("Slide_" + (s+1 < 10 ? "0"+(s+1) : (s+1)), slideDur);

    if (P.layout.useBg) addBackgroundPlate(slideComp, boxW, boxH, P.layout.baseY);

    // BASE MULTILINE (dim) — BOX TEXT
    var baseText = slide.lines.map(function(l){ return l.text; }).join("\\r");
    var baseLayer = slideComp.layers.addBoxText([boxW, boxH]);
    setTextDoc(baseLayer, baseText, fonts.size, fonts.leading, boxW, boxH, P.layout.baseY, P.layout.colorBase, true);
    addDropShadow(baseLayer);

    try{
      var op = baseLayer.property("ADBE Transform Group").property("ADBE Opacity");
      op.setValueAtTime(0, 0);
      op.setValueAtTime(Math.min(P.layout.fadeIn, slideDur*0.5), 100);
      op.setValueAtTime(Math.max(0, slideDur - P.layout.fadeOut), 100);
      op.setValueAtTime(slideDur, 0);
    }catch(e){}

    // HIGHLIGHT OVERLAYS — BOX TEXT
    for(var li=0; li<nLines; li++){
      var overText = overlayText(slide.lines, li);
      var hl = slideComp.layers.addBoxText([boxW, boxH]);
      setTextDoc(hl, overText, fonts.size, fonts.leading, boxW, boxH, P.layout.baseY, P.layout.colorHi, true);
      addDropShadow(hl);

      var inT  = Math.max(0, slide.lines[li].start - slide.start);
      var outT = Math.max(inT + 0.05, slide.lines[li].end   - slide.start);

      hl.inPoint = inT;
      hl.outPoint = Math.min(slideDur, outT);

      try{
        var op2 = hl.property("ADBE Transform Group").property("ADBE Opacity");
        op2.setValueAtTime(inT, 0);
        op2.setValueAtTime(inT + 0.06, 100);
        op2.setValueAtTime(Math.max(inT, outT - 0.08), 100);
        op2.setValueAtTime(outT, 0);
      }catch(e){}
    }

    var slideLayer = masterComp.layers.add(slideComp);
    slideLayer.startTime = slide.start;
    slideLayer.inPoint = slide.start;
    slideLayer.outPoint = slide.end;
    slideLayer.name = "Slide_" + (s+1 < 10 ? "0"+(s+1) : (s+1)) + " (" + nLines + " lines)";
  }

  var masterLayer = mainComp.layers.add(masterComp);
  masterLayer.name = "LYRICS_MASTER";
  masterLayer.startTime = P.firstStart;

  app.endUndoGroup();
  alert("Lyrics imported: " + P.slides.length + " slides, " + P.songId);
})();`;
  }

  /*** ----------------------- PAGE INTEGRATION -------------------- ***/
  function createButton() {
    const songId = parseSongIdFromUrl();
    if (!songId) return;

    const targets = Array.from(document.querySelectorAll('img.object-cover'))
      .filter(img => img.getBoundingClientRect().height > 100);

    targets.forEach(img => {
      const parent = img.parentElement || img;
      if (parent.querySelector('.ae-slides-btn')) return;

      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';

      const btn = document.createElement('button');
      btn.className = 'ae-slides-btn';
      btn.textContent = 'AE: Build Lyric Slides';
      btn.style.cssText = `
        position: absolute; bottom: 0; left: 0; right: 0;
        background: linear-gradient(45deg, #6b5bff, #9a8cff);
        color: white; border: 0; padding: 12px 10px;
        font-weight: 800; font-size: 14px; cursor: pointer; z-index: 99999;
        text-shadow: 0 1px 2px rgba(0,0,0,.5); letter-spacing: .3px;
        transition: transform .2s ease, opacity .2s ease;
      `;
      btn.addEventListener('mouseenter', () => (btn.style.transform = 'translateY(-1px)'));
      btn.addEventListener('mouseleave', () => (btn.style.transform = 'translateY(0)'));

      btn.onclick = async () => {
        try {
          btn.textContent = 'Fetching lyrics…';
          const data = await fetchData(songId);

          btn.textContent = 'Preparing slides…';
          const valid = normalizeLines(data);
          const slides = groupIntoSlides(valid);
          const duration = computeDuration(valid);
          const firstStart = firstLyricStart(valid);

          btn.textContent = 'Rendering JSX…';
          const jsx = generateJSX(songId, slides, duration, firstStart);
          downloadFile(jsx, `${songId}_lyric_slides_boxtext.jsx`);
          downloadFile(JSON.stringify(data, null, 2), `${songId}_raw_data.json`);

          btn.textContent = '✓ Slides Ready';
          setTimeout(() => (btn.textContent = 'AE: Build Lyric Slides'), 1800);
        } catch (err) {
          console.error(err);
          btn.textContent = 'Error — open console';
          setTimeout(() => (btn.textContent = 'AE: Build Lyric Slides'), 3000);
        }
      };

      parent.appendChild(btn);
    });
  }

  const obs = new MutationObserver(() => setTimeout(createButton, 250));
  obs.observe(document.body, { childList: true, subtree: true });
  setTimeout(createButton, 500);
})();
