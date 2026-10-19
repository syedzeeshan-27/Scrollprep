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
 *   Text over the video, each shown from its data-at (0 to 1) until the next one starts:
 *     <div class="scrollscrub__captions">
 *       <div class="scrollscrub__caption" data-at="0.15">Waterproof</div>
 *     </div>
 *   data-caption-style="words" | "blur" | "mask" on the section changes how text comes in
 *   (one word at a time, out of a blur, or wiping up). Fades up when left out.
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
    // Card: starts small with rounded corners and grows to fill the screen.
    '[data-layout=card] .scrollscrub__frame{transform:scale(calc(.6 + .4 * var(--scrollscrub-grow,0)));' +
      'border-radius:calc(36px * (1 - var(--scrollscrub-grow,0)));will-change:transform}' +
    // Reveal: opens out of a small circle. 72% of the circle reference covers the corners.
    '[data-layout=reveal] .scrollscrub__frame{clip-path:circle(calc(8% + 64% * var(--scrollscrub-grow,0)) at 50% 50%)}' +
    // Zoom out: starts close and pulls back to the full picture.
    '[data-layout=zoom] .scrollscrub__media{transform:scale(calc(1.45 - .45 * var(--scrollscrub-grow,0)));will-change:transform}' +
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
      '[data-layout=split] .scrollscrub__word{opacity:1;transform:none;filter:none}' +
    '}' +
    // Reduced motion: a still poster with the text listed underneath.
    ':where(.scrollscrub--static){height:auto}' +
    '.scrollscrub--static>.scrollscrub__stage{position:relative;height:auto}' +
    '.scrollscrub--static .scrollscrub__frame{position:relative;height:80vh;height:80svh;transform:none;border-radius:0;clip-path:none}' +
    '.scrollscrub--static .scrollscrub__media{transform:none}' +
    '.scrollscrub--static .scrollscrub__captions{position:relative;height:auto;background:none;padding:24px 6vw;display:grid;gap:16px}' +
    '.scrollscrub--static .scrollscrub__caption{position:relative;left:auto;right:auto;bottom:auto;opacity:1;' +
      'transform:none;color:inherit;text-shadow:none;filter:none;clip-path:none}';

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

  function VideoScrub(el, video) {
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
      var target = progressOf(el) * d;
      current += (target - current) * EASE;
      if (Math.abs(target - current) < 0.002) current = target;
      // Never queue a seek while one is in flight, or the video falls behind the scroll.
      if (!video.seeking && Math.abs(video.currentTime - current) > 0.012) video.currentTime = current;
    };
  }

  function FrameScrub(el, canvas, isStatic) {
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
      var want = isStatic ? 0 : Math.min(urls.length - 1, Math.round(progressOf(el) * (urls.length - 1)));
      var i = nearestLoaded(want);
      if (i < 0 || (i === shown && !dirty)) return;
      draw(i);
      shown = i;
      dirty = false;
    };
  }

  /**
   * Text and layout state for a section. Sets --scrollscrub-progress (0 to 1) and
   * --scrollscrub-grow (eased 0 to 1 over the first 40%) for CSS, and marks the caption whose
   * moment has come with .is-active. A caption shows from its data-at until the next one starts.
   */
  /** Wraps every word under `node` in a span numbered from `n`, for the word-by-word style. */
  function splitWords(node, n) {
    var kids = Array.prototype.slice.call(node.childNodes);
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (kid.nodeType === 1) { n = splitWords(kid, n); continue; }
      if (kid.nodeType !== 3 || !kid.nodeValue.trim()) continue;
      var frag = document.createDocumentFragment();
      var parts = kid.nodeValue.split(/(\s+)/);
      for (var j = 0; j < parts.length; j++) {
        if (!parts[j]) continue;
        if (/^\s+$/.test(parts[j])) { frag.appendChild(document.createTextNode(parts[j])); continue; }
        var w = document.createElement('span');
        w.className = 'scrollscrub__word';
        w.style.setProperty('--i', String(n++));
        w.textContent = parts[j];
        frag.appendChild(w);
      }
      node.replaceChild(frag, kid);
    }
    return n;
  }

  function Scene(el, isStatic) {
    var nodes = el.querySelectorAll('.scrollscrub__caption');
    if (!isStatic && el.getAttribute('data-caption-style') === 'words') {
      for (var w = 0; w < nodes.length; w++) {
        if (!nodes[w].querySelector('.scrollscrub__word')) splitWords(nodes[w], 0);
      }
    }
    var items = [];
    for (var i = 0; i < nodes.length; i++) {
      items.push({ el: nodes[i], at: parseFloat(nodes[i].getAttribute('data-at')) || 0 });
    }
    items.sort(function (a, b) { return a.at - b.at; });
    for (var j = 0; j < items.length; j++) items[j].until = j + 1 < items.length ? items[j + 1].at : 2;
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
      if (media.tagName === 'VIDEO') {
        // Phone framing: a poster cut for small screens, if the export has one.
        var phonePoster = media.getAttribute('data-poster-mobile');
        if (phonePoster && window.matchMedia && window.matchMedia(MOBILE_QUERY).matches) media.poster = phonePoster;
        if (isStatic) {
          // Reduced motion: show the poster as a still image and skip the scroll effect.
          media.preload = 'none';
          media.removeAttribute('autoplay');
        } else {
          player = new VideoScrub(el, media);
        }
      } else if (media.tagName === 'CANVAS') {
        player = new FrameScrub(el, media, isStatic);
      } else {
        continue;
      }
      var scene = new Scene(el, isStatic);
      el.__scrollscrub = { player: player, scene: scene };
      instances.push({ el: el, player: player, scene: scene, always: isStatic });
    }
    if (!running && instances.length) {
      running = true;
      window.requestAnimationFrame(loop);
    }
  }

  window.ScrollScrub = { init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
  else init();
})();
