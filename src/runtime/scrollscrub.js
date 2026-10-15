/*! scrollscrub.js from ScrollPrep. MIT license. No dependencies.
 *
 * Markup (video):
 *   <section data-scrollscrub style="--scrollscrub-length:300vh">
 *     <div class="scrollscrub__stage">
 *       <video class="scrollscrub__media" muted playsinline preload="auto" poster="poster.jpg"
 *              data-src-mobile="video-mobile.mp4">
 *         <source src="video.mp4" type="video/mp4">
 *       </video>
 *     </div>
 *   </section>
 *
 * Markup (image frames):
 *   <section data-scrollscrub data-frames="frames/frame-{i}.webp" data-frame-count="120" data-frame-pad="4">
 *     <div class="scrollscrub__stage"><canvas class="scrollscrub__media"></canvas></div>
 *   </section>
 *
 * The effect plays while the section scrolls past. Its height sets how long that takes.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || window.ScrollScrub) return;

  var EASE = 0.22;
  var MOBILE_QUERY = '(max-width: 767px)';
  var STYLE_ID = 'scrollscrub-style';
  var CSS =
    ':where([data-scrollscrub]){position:relative;height:var(--scrollscrub-length,300vh)}' +
    ':where([data-scrollscrub]>.scrollscrub__stage){position:sticky;top:0;height:100vh;height:100svh;overflow:hidden}' +
    ':where(.scrollscrub__media){display:block;width:100%;height:100%;object-fit:cover}' +
    ':where(.scrollscrub--static){height:auto}' +
    ':where(.scrollscrub--static>.scrollscrub__stage){position:relative}';

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

  function loop() {
    for (var i = 0; i < instances.length; i++) {
      var inst = instances[i];
      if (inst.always || isNear(inst.el)) inst.player.update();
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
      var player;
      if (media.tagName === 'VIDEO') {
        if (isStatic) {
          // Reduced motion: show the poster as a still image and skip the scroll effect.
          el.classList.add('scrollscrub--static');
          media.preload = 'none';
          media.removeAttribute('autoplay');
          continue;
        }
        player = new VideoScrub(el, media);
      } else if (media.tagName === 'CANVAS') {
        if (isStatic) el.classList.add('scrollscrub--static');
        player = new FrameScrub(el, media, isStatic);
      } else {
        continue;
      }
      el.__scrollscrub = player;
      instances.push({ el: el, player: player, always: isStatic });
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
