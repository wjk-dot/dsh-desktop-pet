/* 桌宠开关 v2：由插件注入 DSH 界面（随每次页面响应读取本文件）。
 * - 自动避让 DSH 原生按钮；此版本优先保证点击可靠，不支持拖动
 * - 点击先即时更新，服务端响应后再确认；轮询只负责外部切换兜底
 * - 点击立即切换 /api/pet/control；失败显示 ⚠ 提示
 */
(function () {
  'use strict';
  var KEY = 'dsh-desktop-pet-toggle';
  var POS_VERSION_KEY = 'dsh-desktop-pet-toggle-pos-version';
  var POS_VERSION = '4';
  var css = '#' + KEY + '{position:fixed;top:12px;right:12px;z-index:2147483000;' +
    'display:flex;align-items:center;gap:5px;padding:5px 10px;border:none;border-radius:999px;' +
    'font:600 11px/1 -apple-system,"PingFang SC",sans-serif;cursor:pointer;user-select:none;' +
    'color:#fff;background:linear-gradient(135deg,#4d6bfe,#4dacff);opacity:.85;' +
    'box-shadow:0 3px 10px rgba(30,80,180,.35);transition:opacity .15s,filter .15s;} ' +
    '#' + KEY + ':hover{opacity:1;} ' +
    '#' + KEY + '.off{background:#8a97ad;opacity:.7;filter:saturate(.4);}';
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  var btn = document.createElement('button');
  btn.id = KEY;
  btn.title = '开启 / 关闭桌宠';
  btn.type = 'button';
  document.body.appendChild(btn);

  var on = true;
  var errText = '';
  var pending = false;
  function paint() {
    btn.classList.toggle('off', !on);
    btn.textContent = errText ? ('⚠ ' + errText) : (on ? '🐋 开' : '🐋 关');
  }
  function fail(msg) {
    errText = msg;
    paint();
    setTimeout(function () { errText = ''; paint(); }, 4000);
  }
  function apply(d) {
    if (d && typeof d.enabled === 'boolean') { on = d.enabled; paint(); }
  }
  function refresh() {
    if (pending) return;
    fetch('/api/pet/control', { cache: 'no-store' })
      .then(function (r) { return r.json(); }).then(apply)
      .catch(function () {});
  }

  /* ---- 原生控件避让 ---- */
  function interactiveRects() {
    var nodes = document.querySelectorAll('button, input, select, textarea, [role="button"], [role="tab"], [contenteditable="true"]');
    var rects = [];
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node === btn || node.closest('#' + KEY)) continue;
      var style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') continue;
      var r = node.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push(r);
    }
    return rects;
  }
  function intersects(a, b, pad) {
    return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
  }
  function conflicts(left, top) {
    var r = { left: left, top: top, right: left + btn.offsetWidth, bottom: top + btn.offsetHeight };
    return interactiveRects().some(function (other) { return intersects(r, other, 8); });
  }
  function clamp(left, top) {
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - btn.offsetWidth - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - btn.offsetHeight - 8)),
    };
  }
  function place(left, top) {
    var p = clamp(left, top);
    btn.style.left = p.left + 'px';
    btn.style.top = p.top + 'px';
    btn.style.right = 'auto';
    btn.style.bottom = 'auto';
  }
  function autoPlace() {
    /* 先试窗口四角和右侧中部。避开就绪的真实可点击控件，而非猜 DSH 的 DOM。 */
    var gap = 12;
    var candidates = [
      [window.innerWidth - btn.offsetWidth - gap, window.innerHeight - btn.offsetHeight - gap],
      [window.innerWidth - btn.offsetWidth - gap, gap],
      [gap, window.innerHeight - btn.offsetHeight - gap],
      [gap, gap],
      [window.innerWidth - btn.offsetWidth - gap, Math.max(gap, Math.round((window.innerHeight - btn.offsetHeight) / 2))],
    ];
    for (var i = 0; i < candidates.length; i++) {
      var p = clamp(candidates[i][0], candidates[i][1]);
      if (!conflicts(p.left, p.top)) { place(p.left, p.top); return; }
    }
    /* 画面很拥挤时仍保证它在可见区，优先不盖住左侧栏。 */
    place(window.innerWidth - btn.offsetWidth - gap, Math.max(96, window.innerHeight - btn.offsetHeight - 96));
  }
  function restorePos() {
    try {
      if (localStorage.getItem(POS_VERSION_KEY) !== POS_VERSION) {
        localStorage.setItem(POS_VERSION_KEY, POS_VERSION);
      }
    } catch (e) {}
    autoPlace();
  }
  window.addEventListener('resize', function () {
    var p = clamp(btn.offsetLeft, btn.offsetTop);
    if (conflicts(p.left, p.top)) autoPlace();
    else place(p.left, p.top);
  });

  /* ---- 点击切换 ---- */
  var lastActivation = 0;
  function toggle(e) {
    if (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    var now = Date.now();
    if (now - lastActivation < 350) return;
    lastActivation = now;
    if (pending) return;
    var desired = !on;
    pending = true;
    on = desired;
    paint();
    fetch('/api/pet/control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: desired }),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (data) {
      pending = false;
      apply(data);
    }).catch(function () {
      pending = false;
      on = !desired;
      fail('失败');
    });
  }
  /* Electron/触控板优先走 pointerup；click 保留为键盘和旧环境兜底。 */
  btn.addEventListener('pointerup', toggle, true);
  btn.addEventListener('click', toggle, true);
  btn.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') toggle(e);
  });

  restorePos();
  paint();
  refresh();
  setInterval(refresh, 5000);
})();
