/* LCS first-party tracker. Public telemetry only; never put API_TOKEN here. */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script || navigator.doNotTrack === '1') return;
  var endpoint = script.dataset.endpoint || new URL('/api/track', script.src).href;
  var debug = script.dataset.debug === 'true';
  var enabled = script.dataset.consent !== 'required';
  var memory = {}, sent = {}, session, visitor;
  function get(k) { try { return localStorage.getItem(k); } catch (_) { return memory[k]; } }
  function put(k, v) { memory[k] = v; try { localStorage.setItem(k, v); } catch (_) {} }
  function uuid() { return crypto.randomUUID(); }
  function clean(url) { if (!url) return ''; try { var u = new URL(url, location.href); return u.origin + u.pathname; } catch (_) { return ''; } }
  function init() {
    var match = document.cookie.match(/(?:^|; )lcs_vid=([a-f0-9-]{36})(?:;|$)/i);
    visitor = match ? match[1] : uuid();
    document.cookie = 'lcs_vid=' + visitor + '; Path=/; Max-Age=31536000; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '');
  }
  function emit(type, extra) {
    if (!enabled) return;
    if (!visitor) init();
    var now = Date.now();
    if (!session || now - Number(get('lcs_last') || 0) > 1800000) session = get('lcs_sid');
    if (!session || now - Number(get('lcs_last') || 0) > 1800000) { session = uuid(); put('lcs_sid', session); sent = {}; }
    put('lcs_last', String(now));
    var event = Object.assign({eventId: uuid(), visitorId: visitor, sessionId: session, type: type, timestamp: new Date(now).toISOString(), path: location.pathname}, extra || {});
    fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(event), keepalive: true, credentials: 'omit'}).then(function (response) {
      if (debug && response && !response.ok) console.warn('LCS telemetry rejected: HTTP ' + response.status);
    }).catch(function () { if (debug) console.warn('LCS telemetry could not reach its endpoint'); });
  }
  function once(type, extra) { if (enabled && !sent[type]) { emit(type, extra); sent[type] = true; } }
  function page() {
    var path = location.pathname.toLowerCase(), tier = document.body.dataset.lcsPageTier || 'noise';
    var rules = [['site_visit', /site[-_]?visit/], ['quote', /quote|rfq/], ['careers', /career|jobs/], ['contact', /contact/], ['case_study', /case[-_]?stud/], ['pricing', /pricing|price/], ['specs', /specification|specs|certification/], ['systems', /systems/], ['dimensions', /dimensions/], ['blog', /blog|guide/], ['about', /about/], ['investor', /investor/]];
    if (tier === 'noise') for (var i = 0; i < rules.length; i++) if (rules[i][1].test(path)) { tier = rules[i][0]; break; }
    if (tier === 'noise' && /\/our-projects\/.+/.test(path)) tier = 'case_study';
    if (tier === 'noise' && /\/certificates(\/|$)/.test(path)) tier = 'specs';
    if (tier === 'noise' && /\/(our-projects|products|badminton|hockey|tennis|pickleball|basketball|volleyball|football|athletics|athletic-tracks|wooden-flooring|indoor-flooring|smartracks)(\/|$)/.test(path)) tier = 'systems';
    var params = new URLSearchParams(location.search), utm = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term'].forEach(function (k) { if (params.has(k)) utm[k] = params.get(k).slice(0, 300); });
    var extra = {pageTier: tier, landingPage: clean(location.href), referrer: clean(document.referrer)};
    if (Object.keys(utm).length) extra.utm = utm;
    emit('page_view', extra);
  }
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-lcs-event], a');
    if (!el) return;
    var type = el.dataset.lcsEvent, href = el.getAttribute('href') || '';
    if (!type && /wa\.me|api\.whatsapp\.com|whatsapp:/i.test(href)) type = 'whatsapp_click';
    if (!type && /\.pdf(?:[?#]|$)/i.test(href)) type = 'spec_download';
    if (type) emit(type, {resourceId: clean(href || location.href)});
  });
  document.addEventListener('input', function (e) {
    if (e.target.closest('[data-lcs-calculator]')) once('calculator_used');
    if (e.target.closest('[data-lcs-options]')) once('options_viewed');
  });
  document.addEventListener('submit', function (e) {
    var form = e.target, data = new FormData(form), identity = {};
    var email = data.get('email'), phone = data.get('phone') || data.get('mobile_no');
    if (typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) identity.email = email.trim();
    if (typeof phone === 'string' && phone.trim()) identity.phone = phone.trim().slice(0, 300);
    emit('identify', identity);
    if (form.dataset.lcsForm === 'site_visit') emit('site_visit_requested', identity);
    if (form.dataset.lcsForm === 'quote') emit('quote_requested', identity);
    if (form.querySelector('input[type=file][data-lcs-rfq]') && Array.from(form.querySelectorAll('input[type=file][data-lcs-rfq]')).some(function (input) { return input.files.length > 0; })) emit('rfq_shared', identity);
  }, true);
  document.addEventListener('timeupdate', function (e) {
    var video = e.target;
    if (video.tagName !== 'VIDEO' || !video.hasAttribute('data-lcs-video') || !isFinite(video.duration)) return;
    var watched = 0;
    for (var i = 0; i < video.played.length; i++) watched += video.played.end(i) - video.played.start(i);
    if (watched > video.duration / 2) once('video_watched');
  }, true);
  window.LCS = {
    track: emit, page: page,
    identify: function (identity) { emit('identify', identity); },
    consent: function (value) { enabled = !!value; if (enabled) page(); },
    visitorId: function () { return visitor || null; }
  };
  // A cross-origin CRM iframe owns its form DOM. Accept successful submissions
  // only from an actual embedded CRM form window and its exact configured origin.
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!enabled || !data || data.type !== 'crm:form-submitted' || data.documentType !== 'CRM Lead') return;
    var frames = document.querySelectorAll('iframe[src]'), trusted = false;
    for (var i = 0; i < frames.length; i++) {
      try {
        var url = new URL(frames[i].getAttribute('src'), location.href);
        if (event.source === frames[i].contentWindow && event.origin === url.origin && /^\/crm-form\//.test(url.pathname)) { trusted = true; break; }
      } catch (_) {}
    }
    if (!trusted || !data.identity) return;
    var identity = {}, email = data.identity.email, phone = data.identity.phone;
    if (typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().length <= 254) identity.email = email.trim();
    if (typeof phone === 'string' && phone.trim()) identity.phone = phone.trim().slice(0, 300);
    if (!identity.email && !identity.phone) return;
    emit('identify', identity);
    emit('page_view', Object.assign({pageTier: 'contact'}, identity));
  });
  window.addEventListener('popstate', page);
  if (window.history) ['pushState', 'replaceState'].forEach(function (method) {
    var original = window.history[method];
    window.history[method] = function () {
      var before = location.pathname;
      var result = original.apply(this, arguments);
      if (location.pathname !== before) page();
      return result;
    };
  });
  if (enabled) page();
}());
