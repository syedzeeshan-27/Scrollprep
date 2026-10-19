/*! scrollscrub.js from ScrollPrep. MIT license. No dependencies.
 *
 * Markup (video):
 *   <section data-scrollscrub style="--scrollscrub-length:300vh">
 *     <div class="scrollscrub__stage">
 *       <div class="scrollscrub__frame">
 *         <video class="scrollscrub__media" muted playsinline preload="auto" poster="poster.jpg"
 *                data-src-mobile="video-mobile.mp4">
 *           <source src="video.mp4" type="video/mp4">
 *         </video>
 *       </div>
 *     </div>
 *   </section>
 *
 * Markup (image frames): same, with a canvas as the media and the frames listed on the section:
 *   <section data-scrollscrub data-frames="frames/frame-{i}.webp" data-frame-count="120" data-frame-pad="4">
 *     ... <canvas class="scrollscrub__media"></canvas> ...
 *
 * The effect plays while the section scrolls past. Its height sets how long that takes.
 *
 * Optional extras:
 *   data-layout="card"   the video starts as a rounded card and grows to fill the screen
 *   data-layout="split"  text column beside the video on wide screens
 *   data-layout="reveal" the video opens out of a small circle
 *   data-layout="zoom"   the video starts zoomed in and pulls back
 *   data-layout="letterbox"  cinematic bars open to reveal the full frame
 *   data-layout="knockout"  the video plays through a giant word that grows until only the video
 *     is left. Put the word in the stage: <div class="scrollscrub__knockout" aria-hidden="true">Word</div>
 *   data-glow  the stage around the video glows in the colour of the current frame (shows with
 *     the layouts where the page is visible around the video). The section also gets
 *     --scrollscrub-glow (an rgb() colour) and --scrollscrub-glow-rgb (r g b) for your own styling.
 *   Text over the video, each shown from its data-at (0 to 1) until the next one starts:
 *     <div class="scrollscrub__captions">
 *       <div class="scrollscrub__caption" data-at="0.15" data-hold="0.1">Waterproof</div>
 *     </div>
 *   data-hold freezes the video on its frame for that share of the scroll (0.1 = 10%) while the
 *   line reads, then the video carries on. It still reaches its end at the end of the section.
 *   data-caption-style="words" | "blur" | "mask" | "type" on the section changes how text comes in
 *   (one word at a time, out of a blur, wiping up, or typed letter by letter). Fades up when left out.
 *   The section gets CSS variables --scrollscrub-progress and --scrollscrub-grow (0 to 1) for
 *   your own styling.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.ScrollScrub) return;

  var EASE = 0.22;
  var GROW_UNTIL = 0.4; // the card reaches full screen 40% of the way through
  var MOBILE_QUERY = '(max-width: 767px)';
  var STYLE_ID = 'scrollscrub-style';
  var CSS =
    ':where([data-scrollscrub]){position:relative;height:var(--scrollscrub-length,300vh)}' +
    ':where([data-scrollscrub]>.scrollscrub__stage){position:sticky;top:0;height:100vh;height:100svh;overflow:hidden}' +
    ':where(.scrollscrub__frame){position:absolute;inset:0;overflow:hidden}' +
    ':where(.scrollscrub__media){display:block;width:100%;height:100%;object-fit:cover}' +
    // Text over the video (full screen and card layouts).
    '.scrollscrub__captions{position:absolute;left:0;right:0;bottom:0;height:45%;pointer-events:none;' +
      'background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.55))}' +
    '.scrollscrub__caption{position:absolute;left:6vw;right:6vw;bottom:9vh;margin:0;max-width:16em;' +
      'font-size:clamp(26px,4.6vw,60px);font-weight:700;line-height:1.08;letter-spacing:-.02em;color:#fff;' +
      'text-shadow:0 2px 30px rgba(0,0,0,.45);opacity:0;transform:translateY(28px);' +
      'transition:opacity .5s ease,transform .6s cubic-bezier(.2,.7,.2,1)}' +
    '.scrollscrub__caption.is-active{opacity:1;transform:none}' +
    // Caption styles. Words: the runtime wraps each word so they can arrive one after another.
    '[data-caption-style=words] .scrollscrub__caption{opacity:1;transform:none}' +
    '.scrollscrub__word{display:inline-block;opacity:0;transform:translateY(.55em);filter:blur(6px);' +
      'transition:opacity .45s ease,transform .6s cubic-bezier(.2,.7,.2,1),filter .5s ease;' +
      'transition-delay:calc(var(--i,0) * 55ms)}' +
    '.is-active .scrollscrub__word{opacity:1;transform:none;filter:none}' +
    '.scrollscrub__caption:not(.is-active) .scrollscrub__word{transition-delay:0s;transition-duration:.25s}' +
    '[data-caption-style=blur] .scrollscrub__caption{filter:blur(16px);transform:scale(1.05);' +
      'transition:opacity .6s ease,filter .8s ease,transform .9s cubic-bezier(.2,.7,.2,1)}' +
    '[data-caption-style=blur] .scrollscrub__caption.is-active{filter:none;transform:none}' +
    '[data-caption-style=mask] .scrollscrub__caption{opacity:1;transform:translateY(.35em);' +
      'clip-path:inset(100% -10% 0 -10%);' +
      'transition:clip-path .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}' +
    '[data-caption-style=mask] .scrollscrub__caption.is-active{transform:none;clip-path:inset(-25% -10% -25% -10%)}' +
    // Typewriter: letters appear one after another, with a blinking cursor. Words stay whole when wrapping.
    '[data-caption-style=type] .scrollscrub__caption{opacity:1;transform:none}' +
    '[data-caption-style=type] .scrollscrub__word{opacity:1;transform:none;filter:none;transition:none}' +
    '.scrollscrub__char{opacity:0;transition:opacity 0s linear calc(var(--i,0) * 24ms)}' +
    '.is-active .scrollscrub__char{opacity:1}' +
    '.scrollscrub__caption:not(.is-active) .scrollscrub__char{transition-delay:0s}' +
    '[data-caption-style=type] .scrollscrub__caption.is-active::after{content:"";display:inline-block;width:.06em;height:.85em;' +
      'margin-left:.1em;vertical-align:-.08em;background:currentColor;animation:scrollscrub-blink 1s steps(2,start) infinite}' +
    '@keyframes scrollscrub-blink{to{visibility:hidden}}' +
    // Card: starts small with rounded corners and grows to fill the screen.
    '[data-layout=card] .scrollscrub__frame{transform:scale(calc(.6 + .4 * var(--scrollscrub-grow,0)));' +
      'border-radius:calc(36px * (1 - var(--scrollscrub-grow,0)));will-change:transform}' +
    // Reveal: opens out of a small circle. 72% of the circle reference covers the corners.
    '[data-layout=reveal] .scrollscrub__frame{clip-path:circle(calc(8% + 64% * var(--scrollscrub-grow,0)) at 50% 50%)}' +
    // Zoom out: starts close and pulls back to the full picture.
    '[data-layout=zoom] .scrollscrub__media{transform:scale(calc(1.45 - .45 * var(--scrollscrub-grow,0)));will-change:transform}' +
    // Letterbox: cinematic bars open from a thin strip to the full frame.
    '[data-layout=letterbox]>.scrollscrub__stage{background:#000}' +
    '[data-layout=letterbox] .scrollscrub__frame{clip-path:inset(calc(46% * (1 - var(--scrollscrub-grow,0))) 0)}' +
    '[data-layout=letterbox] .scrollscrub__media{transform:scale(calc(1.1 - .1 * var(--scrollscrub-grow,0)));will-change:transform}' +
    // Knockout: a black sheet with a white word multiplied over the video, so the video shows only
    // through the letters. The sheet scales up until the letters pass the edges, then fades away.
    '[data-layout=knockout]>.scrollscrub__stage{isolation:isolate;background:#000}' +
    '[data-layout=knockout] .scrollscrub__knockout{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;' +
      'background:#000;color:#fff;mix-blend-mode:multiply;pointer-events:none;' +
      'font-weight:800;font-size:clamp(48px,18vw,22vh);line-height:1;letter-spacing:-.04em;white-space:nowrap;text-transform:uppercase;' +
      'transform:scale(calc(1 + 16 * var(--scrollscrub-grow,0) * var(--scrollscrub-grow,0)));transform-origin:50% 50%;' +
      'opacity:clamp(0,(.88 - var(--scrollscrub-grow,0)) / .33,1);will-change:transform,opacity}' +
    '[data-layout=knockout] .scrollscrub__media{transform:scale(calc(1.15 - .15 * var(--scrollscrub-grow,0)));will-change:transform}' +
    // Glow: the stage and the frame's shadow take the colour of the current frame (set by the runtime).
    '[data-glow]>.scrollscrub__stage{background:radial-gradient(70% 60% at 50% 55%,rgb(var(--scrollscrub-glow-rgb,124 92 255) / .5),transparent 72%)}' +
    '[data-glow] .scrollscrub__frame{box-shadow:0 30px 140px -10px rgb(var(--scrollscrub-glow-rgb,124 92 255) / .85)}' +
    // Split: text column beside the video on wide screens. Phones fall back to text over the video.
    '@media (min-width:768px){' +
      '[data-layout=split]>.scrollscrub__stage{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);' +
        'align-items:center;gap:5vw;padding:0 6vw}' +
      // Keep the video's own shape (--scrollscrub-ratio = width / height), never taller than 78vh.
      '[data-layout=split] .scrollscrub__frame{position:relative;inset:auto;order:2;border-radius:24px;justify-self:center;' +
        'width:min(100%,calc(78vh * var(--scrollscrub-ratio,1.7778)));aspect-ratio:var(--scrollscrub-ratio,1.7778)}' +
      '[data-layout=split] .scrollscrub__captions{position:relative;height:auto;background:none;display:grid;gap:4vh;order:1}' +
      '[data-layout=split] .scrollscrub__caption{position:relative;left:auto;right:auto;bottom:auto;color:inherit;' +
        'text-shadow:none;font-size:clamp(22px,2.8vw,40px);opacity:.22;transform:none;filter:none;clip-path:none}' +
      '[data-layout=split] .scrollscrub__caption.is-active{opacity:1}' +
      '[data-layout=split] .scrollscrub__word,[data-layout=split] .scrollscrub__char{opacity:1;transform:none;filter:none}' +
      '[data-layout=split] .scrollscrub__caption.is-active::after{display:none}' +
    '}' +
    // Reduced motion: a still poster with the text listed underneath.
    ':where(.scrollscrub--static){height:auto}' +
    '.scrollscrub--static>.scrollscrub__stage{position:relative;height:auto}' +
    '.scrollscrub--static .scrollscrub__frame{position:relative;height:80vh;height:80svh;transform:none;border-radius:0;clip-path:none}' +
    '.scrollscrub--static .scrollscrub__media{transform:none}' +
    '.scrollscrub--static>.scrollscrub__stage{background:none}' +
    '.scrollscrub--static .scrollscrub__frame{box-shadow:none}' +
    '.scrollscrub--static .scrollscrub__knockout{display:none}' +
    '.scrollscrub--static .scrollscrub__captions{position:relative;height:auto;background:none;padding:24px 6vw;display:grid;gap:16px}' +
    '.scrollscrub--static .scrollscrub__caption{position:relative;left:auto;right:auto;bottom:auto;opacity:1;' +
      'transform:none;color:inherit;text-shadow:none;filter:none;clip-path:none}' +
    '.scrollscrub--static .scrollscrub__caption.is-active::after{display:none}';

  var instances = [];
  var running = false;

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.insertBefore(s, document.head.firstChild);
  }

  /** 0 when the section top reaches the viewport top, 1 when its bottom reaches the viewport bottom. */
  function progressOf(el) {
    var r = el.getBoundingClientRect();
    var travel = r.height - window.innerHeight;
    if (travel <= 0) return r.top <= 0 ? 1 : 0;
    var p = -r.top / travel;
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  function isNear(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > -window.innerHeight && r.top < window.innerHeight * 2;
  }

  /**
   * Maps scroll progress to video progress when captions hold the frame. Each hold freezes the
   * video for `hold` of the scroll from its `at`; the rest of the scroll runs the video faster so it
   * still ends at the end. Items must be sorted by `at` with holds already clamped to not overlap.
   */
  function holdMap(items) {
    var holds = [];
    var total = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].hold > 0) { holds.push(items[i]); total += items[i].hold; }
    }
    if (!holds.length) return function (p) { return p; };
    if (total > 0.9) total = 0.9;
    return function (p) {
      var held = 0;
      for (var k = 0; k < holds.length; k++) {
        var d = p - holds[k].at;
        if (d > 0) held += d < holds[k].hold ? d : holds[k].hold;
      }
      var v = (p - held) / (1 - total);
      return v < 0 ? 0 : v > 1 ? 1 : v;
    };
  }

  function VideoScrub(el, video, remap) {
    var mobileSrc = video.getAttribute('data-src-mobile');
    if (mobileSrc && window.matchMedia && window.matchMedia(MOBILE_QUERY).matches) {
      var sources = video.querySelectorAll('source');
      for (var i = 0; i < sources.length; i++) sources[i].parentNode.removeChild(sources[i]);
      video.src = mobileSrc;
    }
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.pause();
    try { video.load(); } catch (e) { /* ignore */ }

    // iOS only buffers after a user gesture, so nudge it on the first touch.
    var unlock = function () {
      var p = video.play();
      if (p && p.then) p.then(function () { video.pause(); }, function () {});
      else video.pause();
    };
    document.addEventListener('touchstart', unlock, { once: true, passive: true });

    var current = 0;
    this.update = function () {
      var d = video.duration;
      if (!(d > 0) || !isFinite(d) || video.readyState < 1) return;
      var target = remap(progressOf(el)) * d;
      current += (target - current) * EASE;
      if (Math.abs(target - current) < 0.002) current = target;
      // Never queue a seek while one is in flight, or the video falls behind the scroll.
      if (!video.seeking && Math.abs(video.currentTime - current) > 0.012) video.currentTime = current;
    };
    this.drawable = function () { return video.readyState >= 2 && !video.seeking ? video : null; };
  }

  function FrameScrub(el, canvas, isStatic, remap) {
    var urls = [];
    var list = el.getAttribute('data-frame-list');
    if (list) {
      try { urls = JSON.parse(list); } catch (e) { urls = []; }
    } else {
      var pattern = el.getAttribute('data-frames') || '';
      var count = parseInt(el.getAttribute('data-frame-count') || '0', 10);
      var pad = parseInt(el.getAttribute('data-frame-pad') || '4', 10);
      for (var i = 1; i <= count; i++) {
        var n = String(i);
        while (n.length < pad) n = '0' + n;
        urls.push(pattern.replace('{i}', n));
      }
    }
    var ctx = canvas.getContext('2d');
    var images = [];
    var loaded = [];
    var shown = -1;
    var dirty = true;

    function load(i) {
      var img = new Image();
      img.decoding = 'async';
      img.onload = function () { loaded[i] = true; dirty = true; };
      img.src = urls[i];
      images[i] = img;
    }
    if (urls.length) load(0);
    if (!isStatic) for (var j = 1; j < urls.length; j++) load(j);

    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.round(canvas.clientWidth * dpr);
      var h = Math.round(canvas.clientHeight * dpr);
      if (w && h && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        dirty = true;
      }
    }

    function nearestLoaded(i) {
      for (var k = 0; k < urls.length; k++) {
        if (loaded[i - k]) return i - k;
        if (loaded[i + k]) return i + k;
      }
      return -1;
    }

    function draw(i) {
      var img = images[i];
      var cw = canvas.width, ch = canvas.height;
      var scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
      var w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
    }

    this.update = function () {
      if (!urls.length) return;
      resize();
      var want = isStatic ? 0 : Math.min(urls.length - 1, Math.round(remap(progressOf(el)) * (urls.length - 1)));
      var i = nearestLoaded(want);
      if (i < 0 || (i === shown && !dirty)) return;
      draw(i);
      shown = i;
      dirty = false;
    };
    this.drawable = function () { return shown >= 0 ? images[shown] : null; };
  }

  /**
   * Text and layout state for a section. Sets --scrollscrub-progress (0 to 1) and
   * --scrollscrub-grow (eased 0 to 1 over the first 40%) for CSS, and marks the caption whose
   * moment has come with .is-active. A caption shows from its data-at until the next one starts.
   */
  /**
   * Wraps every word under `node` in a span numbered from `n`, for the word-by-word style. With
   * `chars` set, each letter gets its own numbered span inside the word (typewriter), so words still
   * wrap as a whole.
   */
  function splitWords(node, n, chars) {
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (kid.nodeType === 1) { n = splitWords(kid, n, chars); continue; }
      if (kid.nodeType !== 3 || !kid.nodeValue.trim()) continue;
      var frag = document.createDocumentFragment();
      var parts = kid.nodeValue.split(/(\s+)/);
      for (var j = 0; j < parts.length; j++) {
        if (!parts[j]) continue;
        if (/^\s+$/.test(parts[j])) { frag.appendChild(document.createTextNode(parts[j])); continue; }
        var w = document.createElement('span');
        w.className = 'scrollscrub__word';
        if (chars) {
          var letters = Array.from ? Array.from(parts[j]) : parts[j].split('');
          for (var k = 0; k < letters.length; k++) {
            var c = document.createElement('span');
            c.className = 'scrollscrub__char';
            c.style.setProperty('--i', String(n++));
            c.textContent = letters[k];
            w.appendChild(c);
          }
        } else {
          w.style.setProperty('--i', String(n++));
          w.textContent = parts[j];
        }
        frag.appendChild(w);
      }
      node.replaceChild(frag, kid);
    }
    return n;
  }

  /**
   * Samples the average colour of what the player is showing and eases the section's glow
   * variables towards it. Stops quietly if the pixels cannot be read (a video from another origin).
   */
  function Glow(el, player) {
    var size = 12;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    var have = false;
    var cur = [124, 92, 255];
    var target = cur.slice();
    var lastKey = null;
    var fresh = false; // the first colour is written straight away, later ones ease in
    var dead = !ctx;

    function sample() {
      var src = player.drawable();
      if (!src) return;
      var key = src.currentTime != null ? Math.round(src.currentTime * 20) : src.src;
      if (key === lastKey) return;
      lastKey = key;
      try {
        ctx.drawImage(src, 0, 0, size, size);
        var d = ctx.getImageData(0, 0, size, size).data;
      } catch (e) {
        dead = true;
        return;
      }
      var r = 0, g = 0, b = 0, n = size * size;
      for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      target = vivid(r / n, g / n, b / n);
      if (!have) { cur = target.slice(); have = true; fresh = true; }
    }

    /** Pushes a muddy average towards something that reads as a colour: more saturation, mid lightness. */
    function vivid(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var l = (max + min) / 2, h = 0, s = 0;
      if (max !== min) {
        var dlt = max - min;
        s = l > 0.5 ? dlt / (2 - max - min) : dlt / (max + min);
        if (max === r) h = (g - b) / dlt + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / dlt + 2;
        else h = (r - g) / dlt + 4;
        h /= 6;
      }
      s = Math.min(1, s * 1.6 + 0.1);
      l = Math.min(0.62, Math.max(0.4, l));
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
      function ch(t) {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      }
      return [ch(h + 1 / 3) * 255, ch(h) * 255, ch(h - 1 / 3) * 255];
    }

    this.update = function () {
      if (dead) return;
      sample();
      if (!have) return;
      var moved = false;
      for (var i = 0; i < 3; i++) {
        var step = (target[i] - cur[i]) * 0.08;
        if (Math.abs(step) > 0.05) { cur[i] += step; moved = true; }
      }
      if (!moved && !fresh) return;
      fresh = false;
      var rgb = Math.round(cur[0]) + ' ' + Math.round(cur[1]) + ' ' + Math.round(cur[2]);
      el.style.setProperty('--scrollscrub-glow-rgb', rgb);
      el.style.setProperty('--scrollscrub-glow', 'rgb(' + rgb + ')');
    };
  }

  function Scene(el, isStatic) {
    var nodes = el.querySelectorAll('.scrollscrub__caption');
    var style = el.getAttribute('data-caption-style');
    if (!isStatic && (style === 'words' || style === 'type')) {
      for (var w = 0; w < nodes.length; w++) {
        if (!nodes[w].querySelector('.scrollscrub__word')) splitWords(nodes[w], 0, style === 'type');
      }
    }
    var items = [];
    for (var i = 0; i < nodes.length; i++) {
      items.push({
        el: nodes[i],
        at: parseFloat(nodes[i].getAttribute('data-at')) || 0,
        hold: parseFloat(nodes[i].getAttribute('data-hold')) || 0,
      });
    }
    items.sort(function (a, b) { return a.at - b.at; });
    for (var j = 0; j < items.length; j++) {
      items[j].until = j + 1 < items.length ? items[j + 1].at : 2;
      // A hold may not run into the next line or past the end.
      var room = Math.min(1, items[j].until) - items[j].at;
      if (items[j].hold > room) items[j].hold = room > 0 ? room : 0;
    }
    this.remap = holdMap(items);
    var last = -1;

    this.update = function () {
      var p = isStatic ? 1 : progressOf(el);
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      var g = Math.min(1, p / GROW_UNTIL);
      g = g * g * (3 - 2 * g);
      el.style.setProperty('--scrollscrub-progress', p.toFixed(4));
      el.style.setProperty('--scrollscrub-grow', g.toFixed(4));
      for (var k = 0; k < items.length; k++) {
        var on = isStatic || (p >= items[k].at && p < items[k].until);
        if (on !== items[k].el.classList.contains('is-active')) items[k].el.classList.toggle('is-active', on);
      }
    };
  }

  function loop() {
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      if (inst.always || isNear(inst.el)) {
        inst.scene.update();
        if (inst.player) inst.player.update();
        if (inst.glow) inst.glow.update();
      }
    }
    window.requestAnimationFrame(loop);
  }

  function init(root) {
    injectStyle();
    var els = (root || document).querySelectorAll('[data-scrollscrub]');
    var isStatic = reducedMotion();
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.__scrollscrub) continue;
      var media = el.querySelector('.scrollscrub__media');
      if (!media) continue;
      var player = null;
      if (isStatic) el.classList.add('scrollscrub--static');
      var scene = new Scene(el, isStatic);
      if (media.tagName === 'VIDEO') {
        // Phone framing: a poster cut for small screens, if the export has one.
        var phonePoster = media.getAttribute('data-poster-mobile');
        if (phonePoster && window.matchMedia && window.matchMedia(MOBILE_QUERY).matches) media.poster = phonePoster;
        if (isStatic) {
          // Reduced motion: show the poster as a still image and skip the scroll effect.
          media.preload = 'none';
          media.removeAttribute('autoplay');
        } else {
          player = new VideoScrub(el, media, scene.remap);
        }
      } else if (media.tagName === 'CANVAS') {
        player = new FrameScrub(el, media, isStatic, scene.remap);
      } else {
        continue;
      }
      var glow = player && el.hasAttribute('data-glow') ? new Glow(el, player) : null;
      el.__scrollscrub = { player: player, scene: scene, glow: glow };
      instances.push({ el: el, player: player, scene: scene, glow: glow, always: isStatic });
    }
    if (!running && instances.length) {
      running = true;
      window.requestAnimationFrame(loop);
    }
  }

  window.ScrollScrub = { init: init, holdMap: holdMap };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})();
