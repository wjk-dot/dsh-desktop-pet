/* DeepSeek 桌宠页面逻辑：状态机 + 气泡打字机 + 输入框 + 拖动判定。
 * 与原生壳的契约：
 *   JS → Swift: window.webkit.messageHandlers.pet.postMessage({type, ...})
 *     - {type:'chat', text}   发送一条对话
 *     - {type:'drag'}         进入拖动模式（原生壳接管窗口移动）
 *   Swift → JS: window.petBridge.* 注入方法（由原生壳 evaluateJavaScript 调用）
 */

(function () {
  'use strict'

  const stage = document.getElementById('stage')
  const bubble = document.getElementById('bubble')
  const bubbleText = document.getElementById('bubbleText')
  const inputBar = document.getElementById('inputBar')
  const inputText = document.getElementById('inputText')
  const sendBtn = document.getElementById('sendBtn')
  const offlineTag = document.getElementById('offlineTag')

  let state = 'idle'        // idle | listening | thinking | speaking | offline
  let streaming = false     // 正在等待/接收回复
  let greetingShown = false

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

  /* ---------- 气泡打字机 ---------- */

  let raw = ''              // 当前气泡的原始文本（Markdown 源）
  const caretHtml = '<span class="caret"></span>'
  let caretVisible = false
  let renderPending = false

  /** 重渲染气泡（rAF 合并高频增量，限高后滚到底部）。 */
  function renderBubble(withCaret) {
    caretVisible = withCaret
    if (renderPending) return
    renderPending = true
    requestAnimationFrame(function () {
      renderPending = false
      bubbleText.innerHTML = renderRich(raw) + (caretVisible ? caretHtml : '')
      bubble.scrollTop = bubble.scrollHeight
    })
  }

  function showBubble(text, withCaret) {
    raw = text || ''
    bubble.hidden = false
    renderBubble(withCaret)
  }

  function appendDelta(text) {
    raw += text
    renderBubble(true)
  }

  function hideBubble() {
    bubble.hidden = true
    bubbleText.textContent = ''
    raw = ''
    caretVisible = false
  }

  /* ---------- 输入框 ---------- */
  function openInput() {
    if (streaming) return
    inputBar.hidden = false
    setState('listening')
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
    showBubble('', true)
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
      // 单击：切换输入框
      if (inputBar.hidden) openInput()
      else closeInput()
    }
    downX = 0
    downY = 0
    moved = false
    dragging = false
  })

  sendBtn.addEventListener('click', send)
  inputText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') send()
    if (e.key === 'Escape') closeInput()
  })

  /* ---------- 原生壳注入的桥 ---------- */
  window.petBridge = {
    setState: setState,

    /** 回复增量（逐字渲染） */
    renderDelta: function (text) {
      if (!streaming) return
      if (bubble.hidden) showBubble('', true)
      appendDelta(text)
    },

    /** 回复结束 */
    renderDone: function () {
      streaming = false
      if (state === 'thinking') setState('speaking')
      // 说完歇 1.6s 回待机
      setTimeout(function () {
        if (!streaming && state === 'speaking') setState('idle')
      }, 1600)
    },

    /** 出错 */
    renderError: function (message) {
      streaming = false
      showBubble('😢 ' + (message || '出错了'), false)
      setTimeout(function () {
        if (!streaming) hideBubble()
        if (state !== 'offline') setState('idle')
      }, 3000)
    },

    /** 进入离线态 */
    renderOffline: function () {
      if (state === 'offline') return
      streaming = false
      setState('offline')
      offlineTag.hidden = false
      hideBubble()
      inputBar.hidden = true
    },

    /** 恢复在线 */
    renderOnline: function () {
      const wasOffline = state === 'offline'
      setState('idle')
      offlineTag.hidden = true
      if (wasOffline && !greetingShown) {
        greetingShown = true
        showBubble('嗨！我是小鲸鱼，点我聊天～', false)
        setTimeout(hideBubble, 3200)
      }
    },

    /** 一键问候（初次上屏） */
    greet: function () {
      if (greetingShown) return
      greetingShown = true
      showBubble('嗨！我是小鲸鱼，点我聊天～', false)
      setTimeout(hideBubble, 3200)
    },

    /** 调试：注入一条长回复（--snapshot 模式验证气泡布局用） */
    debugLongBubble: function (text) {
      showBubble(text || '长文本', false)
      setState('speaking')
    },

    /** 调试：把渲染后的纯文本写进 document.title（Swift 读 webView.title 取回） */
    debugDump: function () {
      document.title = 'PET_DUMP:' + (bubbleText.innerText || '').slice(0, 600)
    },
  }

  /* 初始化渲染栈（失败自动回落纯文本），初次上屏动画：先待机 */
  initMarked()
  setState('idle')
})()
