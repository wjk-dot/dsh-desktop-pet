/* DeepSeek 桌宠页面逻辑：状态机 + 会话记录面板 + 输入框 + 拖动判定。
 * 与原生壳的契约：
 *   JS → Swift: window.webkit.messageHandlers.pet.postMessage({type, ...})
 *     - {type:'chat', text}   发送一条对话
 *     - {type:'drag'}         进入拖动模式（原生壳接管窗口移动）
 *   Swift → JS: window.petBridge.* 注入方法（由原生壳 evaluateJavaScript 调用）
 *     - loadHistory(turns)    启动时载入 host 端持久化的会话记录
 *     - clearTranscript()     清空会话记录（托盘清记忆时调用）
 *     - renderDelta / renderDone / renderError / renderOffline / renderOnline
 */

(function () {
  'use strict'

  const stage = document.getElementById('stage')
  const bubble = document.getElementById('bubble')
  const transcript = document.getElementById('transcript')
  const bubbleClose = document.getElementById('bubbleClose')
  const inputBar = document.getElementById('inputBar')
  const inputText = document.getElementById('inputText')
  const sendBtn = document.getElementById('sendBtn')
  const offlineTag = document.getElementById('offlineTag')

  let state = 'idle'        // idle | listening | thinking | speaking | offline
  let streaming = false     // 正在等待/接收回复

  /* ---------- 状态 ---------- */
  function setState(next) {
    state = next
    stage.className = 'stage' + (next === 'idle' ? '' : ' pet-' + next)
  }

  function post(type, extra) {
    const msg = Object.assign({ type }, extra || {})
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pet) {
      window.webkit.messageHandlers.pet.postMessage(msg)
    }
  }

  /* ---------- 富文本渲染（对齐 DSH 桌面端：Markdown + KaTeX + highlight.js） ---------- */

  /** HTML 转义（兜底渲染）。 */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })
  }

  /** 默认兜底渲染：纯文本转义。 */
  let renderRich = function (text) {
    return '<p>' + escapeHtml(text || '') + '</p>'
  }

  /**
   * 初始化 marked + KaTeX + highlight.js + DOMPurify。
   * 数学公式由本文件自行提取（支持 $$..$$、$..$、\[..\]、\(..\) 四种分隔符，
   * 兼容中文紧贴场景），直接交给 KaTeX 渲染，再以占位符过 markdown 管线。
   * @returns {boolean} 是否初始化成功（失败时回落纯文本）。
   */
  function initMarked() {
    try {
      if (!window.marked || !window.katex || !window.DOMPurify) return false

      // 代码块高亮 renderer（marked v15：renderer 收单个 token 对象）
      const renderer = new window.marked.Renderer()
      renderer.code = function (token) {
        const code = typeof token === 'object' && token !== null ? token.text : String(token)
        const infostring = typeof token === 'object' && token !== null ? token.lang : arguments[1]
        const lang = (infostring || '').split(/\s+/)[0]
        let highlighted
        try {
          highlighted = lang && window.hljs.getLanguage(lang)
            ? window.hljs.highlight(code, { language: lang }).value
            : window.hljs.highlightAuto(code).value
        } catch (e) {
          highlighted = escapeHtml(code)
        }
        return '<pre><code class="hljs">' + highlighted + '</code></pre>'
      }

      window.marked.use({ gfm: true, breaks: true, renderer })

      renderRich = function (text) {
        const extracted = extractMath(text || '')
        let html = window.marked.parse(extracted.text)
        // 把公式占位符替换回 KaTeX HTML（先于 DOMPurify，让消毒一并处理）
        html = html.replace(/@PETM(\d+)@/g, function (_, i) {
          const p = extracted.parts[Number(i)]
          return p ? p.html : ''
        })
        return window.DOMPurify.sanitize(html, { ADD_ATTR: ['style'] })
      }
      return true
    } catch (e) {
      return false
    }
  }

  /**
   * 渲染一段公式为 KaTeX HTML。
   * @param {string} content 公式源码。
   * @param {boolean} display 是否块级（displayMode）。
   * @returns {string}
   */
  function renderMath(content, display) {
    try {
      return window.katex.renderToString(content, { throwOnError: false, displayMode: !!display })
    } catch (e) {
      return '<span style="color:#c62828">' + escapeHtml(content) + '</span>'
    }
  }

  /**
   * 保护代码块（``` ... ```），避免其中的 $ 或 \( 被当作公式。
   * @param {string} text
   * @returns {{text: string, blocks: string[]}}
   */
  function protectCodeBlocks(text) {
    const blocks = []
    const t = String(text).replace(/```[\s\S]*?(?:```|$)/g, function (m) {
      blocks.push(m)
      return '\u0001' + (blocks.length - 1) + '\u0001'
    })
    return { text: t, blocks: blocks }
  }

  /** 恢复代码块占位符。 */
  function restoreCodeBlocks(text, blocks) {
    return text.replace(/\u0001(\d+)\u0001/g, function (_, i) {
      return blocks[Number(i)]
    })
  }

  /**
   * 提取全部公式（$$..$$ → \[..\] → $..$ → \(..\)），换成占位符。
   * @param {string} text
   * @returns {{text: string, parts: Array<{html: string}>}}
   */
  function extractMath(text) {
    const parts = []
    const p = protectCodeBlocks(text)
    let t = p.text
    const step = function (source, re, display) {
      return source.replace(re, function (_, content) {
        parts.push({ html: renderMath(content, display) })
        return '@PETM' + (parts.length - 1) + '@'
      })
    }
    // 顺序：块级优先于行内，避免 $$ 被 $ 规则吃掉
    t = step(t, /\$\$([\s\S]*?)\$\$/g, true)
    t = step(t, /\\\[([\s\S]*?)\\\]/g, true)
    t = step(t, /\$([\s\S]*?)\$/g, false)
    t = step(t, /\\\(([\s\S]*?)\\\)/g, false)
    return { text: restoreCodeBlocks(t, p.blocks), parts: parts }
  }

  /* ---------- 会话记录（气泡内联面板） ---------- */

  /** 会话记录：与 host 端记忆保持一致（显示用）。 */
  let conversation = [] // [{role:'user'|'assistant', raw:string}]
  let lastEntryIndex = -1 // 当前流式回复在 conversation 中的下标
  const caretHtml = '<span class="caret"></span>'

  /** 气泡宽度上限/下限（与 pet.css 保持一致）。 */
  const BUBBLE_MAX_W = 344
  const BUBBLE_MIN_W = 120

  /**
   * 按内容自动适配气泡宽度：
   * - 短内容（单行即可放下）→ 收缩到内容自然宽度（≥ min）
   * - 长内容（需要换行/含代码表格）→ 展开到 max-width
   * 用隐藏探针量内容在 nowrap 下的自然宽度来判定。
   */
  function fitBubbleWidth() {
    if (bubble.hidden) return
    const probe = document.createElement('div')
    probe.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;' +
      'white-space:nowrap;left:-9999px;top:0;font-size:14px;' +
      'line-height:1.7;font-family:inherit;max-width:' + BUBBLE_MAX_W + 'px;' +
      'overflow:hidden;'
    probe.innerHTML = transcript.innerHTML
    document.body.appendChild(probe)
    const natural = probe.scrollWidth + 36 // + 左右 padding 18*2
    document.body.removeChild(probe)
    const w = natural <= BUBBLE_MAX_W
      ? Math.max(BUBBLE_MIN_W, natural)
      : BUBBLE_MAX_W
    if (Math.abs((bubble.offsetWidth || 0) - w) > 2) {
      bubble.style.width = w + 'px'
    }
  }

  /** 创建一条消息元素。 */
  function createMsgEl(entry) {
    const el = document.createElement('div')
    el.className = 'msg msg-' + entry.role
    if (entry.role === 'user') {
      el.textContent = entry.raw
    } else {
      const rich = document.createElement('div')
      rich.className = 'rich'
      rich.innerHTML = renderRich(entry.raw)
      el.appendChild(rich)
    }
    return el
  }

  /** 全量重建会话面板。 */
  function renderAll() {
    transcript.innerHTML = ''
    conversation.forEach(function (entry) {
      transcript.appendChild(createMsgEl(entry))
    })
  }

  /** 仅重渲染最后一条 assistant（流式增量用）。 */
  function renderLastWithCaret() {
    const richEl = transcript.querySelector('.msg-assistant:last-of-type .rich')
    if (!richEl) return
    const last = conversation[lastEntryIndex]
    if (!last) return
    richEl.innerHTML = renderRich(last.raw) + caretHtml
    scrollTranscriptBottom()
    fitBubbleWidthSoon()
  }

  /** 流式期间节流重适配气泡宽度（rAF 合并）。 */
  let widthFitPending = false
  function fitBubbleWidthSoon() {
    if (widthFitPending) return
    widthFitPending = true
    requestAnimationFrame(function () {
      widthFitPending = false
      fitBubbleWidth()
    })
  }

  function scrollTranscriptBottom() {
    transcript.scrollTop = transcript.scrollHeight
  }

  /** 显示会话面板（气泡）。 */
  function showTranscript() {
    bubble.hidden = false
    renderAll()
    fitBubbleWidth()
    scrollTranscriptBottom()
    refreshCloseButton()
  }

  /**
   * ✕ 按钮可见性：流式中隐藏，非流式且气泡可见时显示。
   * 必须在 streaming 状态翻转后调用（如 renderDone），否则 ✕ 会停留在隐藏态。
   */
  function refreshCloseButton() {
    bubbleClose.style.display = (!streaming && !bubble.hidden) ? '' : 'none'
  }

  /** 隐藏会话面板（对话记录保留，重新打开时还在）。 */
  function hideBubble() {
    bubble.hidden = true
    refreshCloseButton()
  }

  /* ---------- 输入框 ---------- */
  function openInput() {
    if (streaming) return
    inputBar.hidden = false
    setState('listening')
    // 有历史会话时让面板重新可见，方便边看边聊
    if (conversation.length > 0 && bubble.hidden) showTranscript()
    inputText.focus()
  }

  function closeInput() {
    inputBar.hidden = true
    inputText.value = ''
    if (!streaming && state !== 'offline') setState('idle')
  }

  function send() {
    const text = inputText.value.trim()
    if (!text || streaming) return
    inputBar.hidden = true
    inputText.value = ''
    streaming = true
    setState('thinking')
    // 追加本轮：用户消息 + 空回复（流式填充）
    conversation.push({ role: 'user', raw: text })
    conversation.push({ role: 'assistant', raw: '' })
    lastEntryIndex = conversation.length - 1
    showTranscript()
    post('chat', { text })
  }

  /* ---------- 点击 vs 拖动 ---------- */
  const petEl = document.getElementById('pet')
  let downX = 0, downY = 0, moved = false, dragging = false

  petEl.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return
    downX = e.screenX
    downY = e.screenY
    moved = false
    dragging = false
  })

  window.addEventListener('mousemove', function (e) {
    if (streaming) return
    if (dragging) return
    if (downX === 0 && downY === 0) return
    const dx = e.screenX - downX
    const dy = e.screenY - downY
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
      moved = true
      dragging = true
      downX = 0
      downY = 0
      post('drag')
      closeInput()
    }
  })

  window.addEventListener('mouseup', function () {
    if (!dragging && !moved && downX !== 0) {
      // 单击：切换输入框（会话面板保持可见，方便接着聊）
      if (inputBar.hidden) openInput()
      else closeInput()
    }
    downX = 0
    downY = 0
    moved = false
    dragging = false
  })

  // 气泡右上角 ✕：显式关闭面板（记录保留）
  bubbleClose.addEventListener('click', function (e) {
    e.stopPropagation()
    hideBubble()
  })

  sendBtn.addEventListener('click', send)
  inputText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send()
    if (e.key === 'Escape') closeInput()
  })

  /* ---------- 原生壳注入的桥 ---------- */
  window.petBridge = {
    setState: setState,

    /** 载入 host 端持久化的会话记录（启动时由 Swift 调用）。 */
    loadHistory: function (turns) {
      if (streaming) return
      if (!Array.isArray(turns)) return
      conversation = turns
        .filter(function (t) {
          return t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string'
        })
        .map(function (t) {
          return { role: t.role, raw: t.content }
        })
      lastEntryIndex = -1
      if (conversation.length > 0) showTranscript()
    },

    /** 清空会话记录（托盘「清空对话记忆」时由 Swift 调用）。 */
    clearTranscript: function () {
      conversation = []
      lastEntryIndex = -1
      bubble.hidden = true
      transcript.innerHTML = ''
      refreshCloseButton()
    },

    /** 回复增量（追加到当前流式回复，逐字渲染） */
    renderDelta: function (text) {
      if (!streaming) return
      if (lastEntryIndex < 0 || !conversation[lastEntryIndex]) return
      conversation[lastEntryIndex].raw += text
      renderLastWithCaret()
    },

    /** 回复结束：移除光标、说完歇 1.6s 回待机（不自动收起，保留会话面板） */
    renderDone: function () {
      streaming = false
      // 移除末尾光标
      const richEl = transcript.querySelector('.msg-assistant:last-of-type .rich')
      if (richEl) richEl.innerHTML = renderRich(conversation[lastEntryIndex] ? conversation[lastEntryIndex].raw : '')
      fitBubbleWidthSoon()
      refreshCloseButton()
      if (state === 'thinking') setState('speaking')
      setTimeout(function () {
        if (!streaming && state === 'speaking') setState('idle')
      }, 1600)
    },

    /** 出错：以一条临时 assistant 消息呈现，3s 后移除 */
    renderError: function (message) {
      streaming = false
      const idx = conversation.push({
        role: 'assistant',
        raw: '😢 ' + (message || '出错了'),
      }) - 1
      lastEntryIndex = idx
      showTranscript()
      refreshCloseButton()
      setTimeout(function () {
        if (!streaming && conversation[idx] && idx === conversation.length - 1) {
          conversation.pop()
          if (conversation.length === 0) {
            bubble.hidden = true
            transcript.innerHTML = ''
          } else {
            renderAll()
            fitBubbleWidth()
          }
        }
        if (state !== 'offline') setState('idle')
      }, 3000)
    },

    /** 进入离线态 */
    renderOffline: function () {
      if (state === 'offline') return
      streaming = false
      setState('offline')
      offlineTag.hidden = false
      inputBar.hidden = true
      hideBubble()
    },

    /** 恢复在线 */
    renderOnline: function () {
      setState('idle')
      offlineTag.hidden = true
      if (conversation.length > 0) showTranscript()
    },

    /** 调试：注入一条长回复（--snapshot 模式验证气泡布局用） */
    debugLongBubble: function (text) {
      conversation = [{ role: 'assistant', raw: text || '长文本' }]
      lastEntryIndex = conversation.length - 1
      showTranscript()
      setState('speaking')
    },

    /** 调试：模拟真实"流式→完成"路径（验证完成后 ✕ 显示） */
    debugSimulateDone: function (text) {
      conversation = [
        { role: 'user', raw: '验证消息' },
        { role: 'assistant', raw: '' },
      ]
      lastEntryIndex = 1
      streaming = true
      showTranscript()
      conversation[1].raw = text || ''
      renderLastWithCaret()
      // 与真实路径一致：由 Swift 调 window.petBridge.renderDone()
      window.petBridge.renderDone()
    },

    /** 调试：把会话纯文本写进 document.title（Swift 读 webView.title 取回） */
    debugDump: function () {
      document.title = 'PET_DUMP:' + (transcript.innerText || '').slice(0, 600)
    },
  }

  /* 初始化渲染栈（失败自动回落纯文本），初次上屏动画：先待机 */
  initMarked()
  setState('idle')
})()
