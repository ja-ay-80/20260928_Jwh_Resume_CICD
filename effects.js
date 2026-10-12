// ==========================================================================
// 个人主页 · 视觉增强脚本（effects.js）
// --------------------------------------------------------------------------
// 这个文件只做「锦上添花」的事，一行内容文案都不动，也不接管任何跳转：
//   1. 鼠标拖尾光带 —— canvas 上追着指针画一条渐隐渐细的光带
//   2. 光晕跟随    —— 一团柔光慢慢追上指针，压在玻璃面板下当补光
//   3. 作品卡 3D 倾斜 + 鼠标聚光（写入 CSS 变量 --rx / --ry / --mx / --my）
//   4. 按钮涟漪
//   5. 导航滑动指示块（写入 --nav-x / --nav-w）
//   6. 头像轻微视差
//
// 三条自我约束：
//   · 全部用「渐进增强」写法：脚本挂了、或者浏览器不支持，页面照常能读能用；
//   · 系统开了「减少动态效果」、或者设备没有精确指针（手机/平板触屏），
//     自动关掉所有花哨动效；
//   · 监听器尽量少，动画统一收在一条 requestAnimationFrame 里。
// ==========================================================================

;(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches

  // ══════════════════════════════════════════════════════════════
  // 一、鼠标拖尾（canvas）+ 光晕跟随（DOM 元素）
  // ══════════════════════════════════════════════════════════════
  function initCursor() {
    // --- 1.1 建两个「画布」：canvas 画拖尾，div 画光晕 ---
    const canvas = document.createElement('canvas')
    canvas.className = 'cursor-trail'
    // aria-hidden：纯装饰，读屏软件不用念它
    canvas.setAttribute('aria-hidden', 'true')

    const glow = document.createElement('div')
    glow.className = 'cursor-glow'
    glow.setAttribute('aria-hidden', 'true')

    document.body.append(canvas, glow)

    const ctx = canvas.getContext('2d')
    let dpr = 1
    let viewW = 0
    let viewH = 0

    // 上一帧画过的矩形。每帧只擦这一小块，不擦整屏。
    // 必须在 resize() 调用前声明：resize 里会把它清空。
    let dirty = null

    // 高分屏上按设备像素比放大画布，否则光带边缘会有锯齿
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      viewW = window.innerWidth
      viewH = window.innerHeight
      canvas.width = Math.floor(viewW * dpr)
      canvas.height = Math.floor(viewH * dpr)
      canvas.style.width = viewW + 'px'
      canvas.style.height = viewH + 'px'
      // 之后所有绘制都用 CSS 像素坐标，缩放交给这一句
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dirty = null   // 改画布尺寸会把内容清空，记录也一并作废
    }
    resize()
    window.addEventListener('resize', resize)

    // --- 1.2 数据：拖尾轨迹点 + 溅出的小火花 ---
    // --- 1.2 数据：拖尾轨迹点 + 溅出的小火花 ---
    // 手感都在这几个数字里，想调节奏只改这一段：
    const TRAIL_LIFE = 640   // 一个点活多久（毫秒）。越长尾巴越绵长、越不闪
    const TRAIL_MAX = 56     // 最多留多少个点
    const SPARK_MAX = 40     // 火花上限，防止指针狂甩时掉帧
    const HEAD_PAD = 30      // 头部柔光半径（算脏矩形要用）

    const points = []        // { x, y, t }  鼠标走过的位置
    const sparks = []        // { x, y, vx, vy, life, size }

    // 拖尾的两端颜色：头部玫瑰粉 → 尾部浅紫
    const HEAD = [233, 120, 155]
    const TAIL = [166, 132, 226]
    const mix = (a, b, k) => Math.round(a + (b - a) * k)

    let prevX = null
    let prevY = null
    let running = false
    let rafId = 0

    // 光晕的当前位置与目标位置：位置用插值追上去，就有「拖」的感觉
    const glowPos = { x: viewW / 2, y: viewH / 2 }
    let glowTargetX = glowPos.x
    let glowTargetY = glowPos.y

    function spawnSparks(x, y, dx, dy) {
      const count = Math.min(3, 1 + Math.floor(Math.hypot(dx, dy) / 45))
      for (let i = 0; i < count && sparks.length < SPARK_MAX; i += 1) {
        sparks.push({
          x, y,
          // 火花朝鼠标前进方向的「反侧」飞，像是被甩出去的
          vx: -dx * 0.07 + (Math.random() - 0.5) * 1.8,
          vy: -dy * 0.07 + (Math.random() - 0.5) * 1.8,
          life: 1,
          size: 0.9 + Math.random() * 1.6,
        })
      }
    }

    function onPointerMove(event) {
      if (event.pointerType === 'touch') return

      const now = performance.now()
      const x = event.clientX
      const y = event.clientY

      if (prevX !== null) {
        const dx = x - prevX
        const dy = y - prevY
        const dist = Math.hypot(dx, dy)

        // 两次事件之间跳得远（鼠标划得快）时补几个中间点。
        // 不补的话光带就是一根直愣愣的长线，看着一跳一跳的。
        if (dist > 18) {
          const steps = Math.min(6, Math.floor(dist / 18))
          for (let s = 1; s <= steps; s += 1) {
            const k = s / (steps + 1)
            points.push({ x: prevX + dx * k, y: prevY + dy * k, t: now })
          }
        }
        // 速度够快才溅火花：慢慢挪是一条干净的光带，快速划才有碎屑
        if (dist > 30) spawnSparks(x, y, dx, dy)
      }
      prevX = x
      prevY = y

      points.push({ x, y, t: now })
      if (points.length > TRAIL_MAX) points.shift()

      glowTargetX = x
      glowTargetY = y
      glow.classList.add('is-on')

      start()
    }

    // 指针离开窗口：不再硬清空轨迹（会突然「啪」地断掉），
    // 让已经画出去的点自然老去、淡出，只把光晕收起来。
    function onPointerLeave() {
      prevX = prevY = null
      glow.classList.remove('is-on')
      start()
    }

    // 按下时来一圈火花：点击也有手感
    function onPointerDown(event) {
      if (event.pointerType === 'touch') return
      for (let i = 0; i < 10 && sparks.length < SPARK_MAX; i += 1) {
        const a = (Math.PI * 2 * i) / 10
        sparks.push({
          x: event.clientX,
          y: event.clientY,
          vx: Math.cos(a) * (1.2 + Math.random() * 1.2),
          vy: Math.sin(a) * (1.2 + Math.random() * 1.2),
          life: 1,
          size: 1.2 + Math.random() * 1.6,
        })
      }
      start()
    }

    // --- 1.3 每帧绘制 ---
    // 性能上的关键一条：**只擦上一帧画过的那一小块**。
    // 整屏 clearRect 会让压在拖尾下面的毛玻璃面板跟着重新模糊一次，
    // 面板越大越贵 —— 那才是「看起来卡」的主因。
    function drawTrail(now) {
      if (dirty) {
        ctx.clearRect(dirty.x0, dirty.y0, dirty.x1 - dirty.x0, dirty.y1 - dirty.y0)
        dirty = null
      }

      // 丢掉过期的轨迹点
      while (points.length && now - points[0].t > TRAIL_LIFE) points.shift()

      // 一点东西都没有了，这一帧就不用画
      if (points.length === 0 && sparks.length === 0) return false

      // 这一帧要画的矩形范围，边画边扩
      let x0 = Infinity
      let y0 = Infinity
      let x1 = -Infinity
      let y1 = -Infinity
      const grow = (x, y, pad) => {
        if (x - pad < x0) x0 = x - pad
        if (y - pad < y0) y0 = y - pad
        if (x + pad > x1) x1 = x + pad
        if (y + pad > y1) y1 = y + pad
      }

      // ① 光带本体：用二次曲线把折线抹圆，不再一段段直线硬拼。
      //    粗细和浓淡一律按「点的年龄」算，而不是按它在数组里的序号 ——
      //    序号会随着点数增减整体平移，那正是拖尾忽粗忽细、看着跳的原因。
      //    线帽必须用 butt：圆头（round）会让相邻两段的半透明圆帽互相
      //    叠加，透明度翻倍，沿光带出现一排均匀的深色圆点。
      ctx.lineCap = 'butt'
      for (let i = 1; i < points.length; i += 1) {
        const p0 = points[i - 1]
        const p1 = points[i]
        const fresh = 1 - Math.min(1, (now - p1.t) / TRAIL_LIFE)  // 1=刚画，0=快没了
        const alpha = 0.46 * fresh * fresh + 0.05 * fresh
        const width = 1 + fresh * fresh * 6.2
        const before = points[i - 2] || p0
        // 以相邻两点的中点为锚、原曲线控制点，穿过每个采样点
        ctx.strokeStyle = `rgba(${mix(HEAD[0], TAIL[0], 1 - fresh)},${mix(HEAD[1], TAIL[1], 1 - fresh)},${mix(HEAD[2], TAIL[2], 1 - fresh)},${alpha.toFixed(3)})`
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo((before.x + p0.x) / 2, (before.y + p0.y) / 2)
        ctx.quadraticCurveTo(p0.x, p0.y, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2)
        ctx.stroke()
        grow((before.x + p0.x) / 2, (before.y + p0.y) / 2, width / 2 + 2)
        grow((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, width / 2 + 2)
      }

      // ② 光标头部一颗亮点 + 外圈柔光
      const head = points[points.length - 1]
      if (head) {
        const halo = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, HEAD_PAD)
        halo.addColorStop(0, 'rgba(255,255,255,0.72)')
        halo.addColorStop(0.3, 'rgba(255,158,181,0.42)')
        halo.addColorStop(1, 'rgba(201,167,240,0)')
        ctx.fillStyle = halo
        ctx.beginPath()
        ctx.arc(head.x, head.y, HEAD_PAD, 0, Math.PI * 2)
        ctx.fill()
        grow(head.x, head.y, HEAD_PAD)

        ctx.fillStyle = 'rgba(255,255,255,0.9)'
        ctx.beginPath()
        ctx.arc(head.x, head.y, 2.4, 0, Math.PI * 2)
        ctx.fill()
      }

      // ③ 火花：飞出去、减速、变小、消失
      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i]
        s.x += s.vx
        s.y += s.vy
        s.vx *= 0.95
        s.vy = s.vy * 0.95 + 0.02   // 加一点向下的力，像真的碎屑
        s.life -= 0.019
        if (s.life <= 0) {
          sparks.splice(i, 1)
          continue
        }
        ctx.fillStyle = `rgba(255,${Math.round(150 + 60 * s.life)},${Math.round(190 + 40 * s.life)},${(s.life * 0.7).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2)
        ctx.fill()
        grow(s.x, s.y, s.size * s.life + 1)
      }

      // 记下这一帧画过的范围，交给下一帧去擦（顺便夹在画布内）
      if (x1 > x0 && y1 > y0) {
        dirty = {
          x0: Math.max(0, Math.floor(x0)),
          y0: Math.max(0, Math.floor(y0)),
          x1: Math.min(viewW, Math.ceil(x1)),
          y1: Math.min(viewH, Math.ceil(y1)),
        }
      }
      return true
    }

    function drawGlow() {
      const dx = glowTargetX - glowPos.x
      const dy = glowTargetY - glowPos.y
      glowPos.x += dx * 0.16
      glowPos.y += dy * 0.16
      glow.style.transform = `translate3d(${glowPos.x.toFixed(1)}px, ${glowPos.y.toFixed(1)}px, 0)`
      // 还在明显移动就继续追
      return Math.abs(dx) + Math.abs(dy) > 0.6
    }

    function frame() {
      const drawing = drawTrail(performance.now())
      const chasing = drawGlow()
      // 拖尾全部淡完、光晕也追上了 → 停掉 rAF，不空转烧电
      if (drawing || chasing) {
        rafId = requestAnimationFrame(frame)
      } else {
        running = false
      }
    }

    function start() {
      if (running) return
      running = true
      rafId = requestAnimationFrame(frame)
    }

    document.addEventListener('pointermove', onPointerMove, { passive: true })
    document.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.addEventListener('pointerleave', onPointerLeave)
    window.addEventListener('blur', onPointerLeave)

    // 页面切到后台时，浏览器本来就会暂停 rAF，这里只是把状态摆正
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && running) {
        cancelAnimationFrame(rafId)
        running = false
      }
    })
  }

  // ══════════════════════════════════════════════════════════════
  // 二、作品卡：3D 倾斜 + 鼠标聚光
  // ══════════════════════════════════════════════════════════════
  // 倾斜和聚光全都由 CSS 变量驱动 —— JS 只负责把鼠标位置换算成两个角度、
  // 两个百分比写进去，剩下的交给 CSS 过渡。这也是最省性能的分工：
  // 每帧只写 4 个变量，不触发重排。
  //
  // 注意：列表会被 works-render.js 整个重建（筛选/排序都会）。
  // 所以这里**不给每张卡单独绑事件**，而是在 document 上监听一次，
  // 再从事件目标往上找最近的卡片 —— 卡片重建多少次都不受影响。
  function initTilt() {
    let activeCard = null

    function reset(card) {
      if (!card) return
      const link = card.querySelector('a')
      if (!link) return
      link.style.removeProperty('--rx')
      link.style.removeProperty('--ry')
      link.style.removeProperty('--mx')
      link.style.removeProperty('--my')
    }

    document.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return

        const card = event.target.closest ? event.target.closest('.work-card') : null
        if (card !== activeCard) {
          reset(activeCard)
          activeCard = card
        }
        if (!card) return

        const link = card.querySelector('a')
        if (!link) return

        const rect = link.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const px = (event.clientX - rect.left) / rect.width   // 0~1
        const py = (event.clientY - rect.top) / rect.height

        // 鼠标在左半边 → 卡片左边压低、右边抬起，像被手托起来
        link.style.setProperty('--ry', ((px - 0.5) * 9).toFixed(2) + 'deg')
        link.style.setProperty('--rx', ((0.5 - py) * 9).toFixed(2) + 'deg')
        // 聚光点跟着鼠标走
        link.style.setProperty('--mx', (px * 100).toFixed(1) + '%')
        link.style.setProperty('--my', (py * 100).toFixed(1) + '%')
      },
      { passive: true },
    )

    document.addEventListener('pointerout', (event) => {
      if (activeCard && !activeCard.contains(event.relatedTarget)) {
        reset(activeCard)
        activeCard = null
      }
    })
  }

  // ══════════════════════════════════════════════════════════════
  // 三、按钮涟漪
  // ══════════════════════════════════════════════════════════════
  // 同样用事件委托：标签按钮是动态生成的，绑两次就重复触发。
  function initRipple() {
    document.addEventListener(
      'pointerdown',
      (event) => {
        const button = event.target.closest ? event.target.closest('button') : null
        if (!button) return

        const rect = button.getBoundingClientRect()
        const size = Math.max(rect.width, rect.height) * 2
        const dot = document.createElement('span')
        dot.className = 'ripple'
        dot.style.width = size + 'px'
        dot.style.height = size + 'px'
        dot.style.left = event.clientX - rect.left + 'px'
        dot.style.top = event.clientY - rect.top + 'px'
        // 动画放完自己删掉，不在 DOM 里越堆越多
        dot.addEventListener('animationend', () => dot.remove())
        button.append(dot)
      },
      { passive: true },
    )
  }

  // ══════════════════════════════════════════════════════════════
  // 四、导航滑动指示块
  // ══════════════════════════════════════════════════════════════
  // 高亮由 app.js 切 .is-current 类决定；这里只盯着这个类的变化，
  // 把指示块平移到当前项的位置 —— 两边各管一件事，互不干扰。
  function initNavInk() {
    const nav = document.querySelector('.site-header nav')
    if (!nav) return

    const ink = document.createElement('span')
    ink.className = 'nav-ink'
    ink.setAttribute('aria-hidden', 'true')
    nav.prepend(ink)
    // 告诉 CSS「滑动块就绪了」：当前项从下划线兜底切换成白字＋色块
    nav.classList.add('has-ink')

    // 上一次写入的定位值。class/样式即使写成一样的值也会触发变更记录
    // （classList.add 对已存在的 token 也会走一次 setAttribute），
    // 不做这道闸，观察器会跟 move() 互相触发、无限循环把页面卡死。
    let lastX = null
    let lastW = null

    function move() {
      const current = nav.querySelector('a.is-current')
      // 小屏换行后 nav-ink 被 CSS 隐藏，这里也就不用算了
      if (!current || window.getComputedStyle(ink).display === 'none') {
        if (ink.classList.contains('is-ready')) ink.classList.remove('is-ready')
        lastX = lastW = null
        return
      }
      const w = current.offsetWidth
      const x = current.offsetLeft
      // 位置和大小都没变、且已经就绪 → 什么都不写，观察器也就不会再触发
      if (w === lastW && x === lastX && ink.classList.contains('is-ready')) return
      lastW = w
      lastX = x
      ink.style.width = w + 'px'
      ink.style.setProperty('--nav-x', x + 'px')
      if (!ink.classList.contains('is-ready')) ink.classList.add('is-ready')
    }

    // 属性一变（class 增删）就重新定位。attributeFilter 只盯 class，
    // 避免被其他属性变化频繁触发。
    new MutationObserver(move).observe(nav, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })
    window.addEventListener('resize', move)
    // 字体加载完宽度会变，等一等再量一次
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(move)
    move()
  }

  // ══════════════════════════════════════════════════════════════
  // 五、头像轻微视差
  // ══════════════════════════════════════════════════════════════
  function initParallax() {
    const stage = document.querySelector('.hero-top')
    const figure = document.querySelector('.hero-visual figure')
    if (!stage || !figure) return

    stage.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerType === 'touch') return
        const rect = stage.getBoundingClientRect()
        const dx = (event.clientX - rect.left) / rect.width - 0.5
        const dy = (event.clientY - rect.top) / rect.height - 0.5
        // 幅度写小一点：300ms 内的轻微位移是「活」，再大就晕了
        figure.style.transform = `translate3d(${(dx * 16).toFixed(1)}px, ${(dy * 16).toFixed(1)}px, 0)`
      },
      { passive: true },
    )
    stage.addEventListener('pointerleave', () => {
      figure.style.transform = ''
    })
  }

  // ══════════════════════════════════════════════════════════════
  // 启动：按设备能力挑着开
  // ══════════════════════════════════════════════════════════════
  if (reduceMotion) return   // 系统要求少动效：一个都不开

  initNavInk()
  initRipple()
  initParallax()

  if (finePointer) {
    initCursor()
    initTilt()
  }
})()
