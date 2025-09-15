// Стохастический диффузионный поиск (SDS) — реализация в стиле вашей функции initBoids
// Однофайловый Canvas-виджет с наглядной визуализацией и интерактивными контролами.
// Использование:
//   const stop = initSDS(canvas, { N: 300 });
//   // Опционально: initSDS(canvas, opts).createControls(domContainer)
//   // Для остановки анимации: stop()

export function initSDS(canvas, options = {}) {
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  // ===== Векторная алгебра и утилиты =====
  const add  = (a,b)=>({x:a.x+b.x,y:a.y+b.y});
  const sub  = (a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const mult = (v,s)=>({x:v.x*s,y:v.y*s});
  const div  = (v,s)=>({x:v.x/s,y:v.y/s});
  const mag  = v => Math.hypot(v.x,v.y);
  const norm = v => { const m = mag(v); return m===0?{x:0,y:0}:{x:v.x/m,y:v.y/m}; };
  const setMag  = (v,m)=> mult(norm(v), m);
  const clipMag = (v,m)=>{ const mm=mag(v); return mm>m ? mult(v, m/(mm||1e-9)) : v; };
  const dot = (a,b)=> a.x*b.x + a.y*b.y;
  const clamp = (x,a,b)=> Math.min(b, Math.max(a,x));

  // ===== Детерминированный ГПСЧ (Mulberry32) и нормаль Бокса–Мюллера =====
  function RNG(seed){ this.s = (seed>>>0)||123456789; }
  RNG.prototype.next = function(){
    let t = (this.s += 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.uniform = function(a=0,b=1){ return a + (b-a)*this.next(); };
  RNG.prototype.randn = function(){
    const u = 1 - this.next();
    const v = 1 - this.next();
    return Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  };

  // ===== Целевые функции (максимизируем) =====
  const Objectives = {
    twopeaks: {
      name: "Две горки (глобумакс справа)",
      range: 2.5,
      f: (x,y)=> {
        const g1 = Math.exp(-((x-1.0)**2/0.15 + (y-0.2)**2/0.25));
        const g2 = 0.6*Math.exp(-((x+1.0)**2/1.0 + (y+0.3)**2/0.8));
        return g1 + g2; // ~[0,1], максимум ≈ (1,0.2)
      },
      hint: {x:1.0,y:0.2}
    },
    sphere: {
      name: "Сфера (вогнутая) — максимум в 0",
      range: 2.5,
      f: (x,y)=> Math.max(0, 1 - (x*x + y*y)/(2.5*2.5)),
      hint: {x:0,y:0}
    },
    rastrigin: {
      name: "Растригин (инвертированный)",
      range: 2.5,
      f: (x,y)=> {
        const A = 10;
        const val = 2*A + (x*x - A*Math.cos(2*Math.PI*x)) + (y*y - A*Math.cos(2*Math.PI*y));
        return Math.max(0, 1 - val/40); // грубая нормировка [0,1]
      },
      hint: {x:0,y:0}
    },
    ackley: {
      name: "Акли (инвертированный)",
      range: 2.5,
      f: (x,y)=> {
        const a=20,b=0.2,c=2*Math.PI;
        const s1 = 0.5*(x*x + y*y);
        const s2 = 0.5*(Math.cos(c*x) + Math.cos(c*y));
        const ack = -a*Math.exp(-b*Math.sqrt(s1)) - Math.exp(s2) + a + Math.E;
        return Math.max(0, 1 - ack/8); // нормировка [0,1]
      },
      hint: {x:0,y:0}
    }
  };
  const FUNC_KEYS = Object.keys(Objectives);

  // ===== Параметры =====
  const params = {
    // Популяция и стохастика
    N: options.N ?? 100,
    seed: options.seed ?? 123456789,

    // Поиск
    func: options.func ?? 'twopeaks', // ключ из Objectives
    get range(){ return Objectives[this.func].range; }, // используем диапазон из функции
    sigma: options.sigma ?? 0.05,     // дисперсия разведки
    anneal: options.anneal ?? false,  // затухание шума
    annealDecay: options.annealDecay ?? 0.999, // σ_t = σ_0 * decay^t
    restartProb: options.restartProb ?? 0.5,   // доля агентов к перезапуску при отсутствии победителей

    // Визуализация и цикл
    stepsPerFrame: options.stepsPerFrame ?? 3,
    showHeatmap: options.showHeatmap ?? true,
    heatGrid: options.heatGrid ?? 220, // разрешение сетки теплокарты
    showTraj: options.showTraj ?? true,
    trackCount: options.trackCount ?? 12,
    maxTrail: options.maxTrail ?? 200,
    showBest: options.showBest ?? true,

    // Палитра (изменены цвета для лучшей видимости на темном фоне)
    colorWin: options.colorWin ?? '#3ddc84',  // яркий зеленый для победителей
    colorLose: options.colorLose ?? '#9ca3af',// светло-серый для проигравших
    trail: options.trail ?? '#64748b',        // серо-синий для следов

    // Пауза
    isPreview: options.isPreview ?? false,
    startPaused: options.startPaused ?? false
  };

  // ===== Состояние симуляции =====
  let rng = new RNG(params.seed);
  let t = 0;
  let isPaused = options.startPaused ?? false;
  let animationId = null;
  let isAnimationRunning = false;

  let agents = [];  // {x,y, success}
  let winnersIdx = [];
  let tracksIdx = []; // индексы трека
  let tracks = [];    // массив массивов [ [ [x,y], ... ], ... ]

  // Метрики
  let bestF = 0, meanF = 0, winnersFrac = 0;

  // Offscreen теплокарта
  let heatCanvas = document.createElement('canvas');
  let heatValid = false; // требует перерендера при смене функции/размера

  // Предрендеренные LaTeX формулы
  let tooltipElements = {};

  // ===== Инициализация =====
  function randInRange(){ return (rng.next()*2 - 1) * params.range; }

  function initAgents(){
    agents = Array.from({length: params.N}, ()=>({ x: randInRange(), y: randInRange(), success: false }));
    // выберем индексы для траекторий
    const set = new Set();
    while (set.size < Math.min(params.trackCount, params.N)) set.add((rng.next()*params.N)|0);
    tracksIdx = Array.from(set.values());
    tracks = tracksIdx.map(()=> []);
    t = 0; bestF = 0; meanF = 0; winnersFrac = 0;
  }

  // ===== Математика целевой функции =====
  function f(x,y){ return Objectives[params.func].f(x,y); }

  // ===== Тепловая карта (более темная палитра) =====
  function renderHeatmap(){
    heatCanvas.width = canvas.width;
    heatCanvas.height = canvas.height;
    const hctx = heatCanvas.getContext('2d');
    const w = heatCanvas.width, h = heatCanvas.height;
    const img = hctx.createImageData(w, h);

    // оценим min/max на грубой сетке для нормировки
    let fmin = Infinity, fmax = -Infinity;
    const G = params.heatGrid;
    for (let iy=0; iy<G; iy++){
      const y = ((iy+0.5)/G)*2*params.range - params.range;
      for (let ix=0; ix<G; ix++){
        const x = ((ix+0.5)/G)*2*params.range - params.range;
        const v = f(x,y);
        if (v<fmin) fmin=v; if (v>fmax) fmax=v;
      }
    }
    const denom = (fmax - fmin) || 1e-9;

    // Более темная колормапа для соответствия стилю интерфейса
    const grad = t => {
      t = clamp(t, 0, 1);
      if (t < 0.25) { 
        // Очень темный синий → темный синий
        const u = t / 0.25;
        return [
          Math.round(10 + 15 * u),   // R: 10 → 25
          Math.round(15 + 25 * u),   // G: 15 → 40
          Math.round(25 + 35 * u)    // B: 25 → 60
        ];
      } else if (t < 0.5) { 
        // Темный синий → темный зеленый
        const u = (t - 0.25) / 0.25;
        return [
          Math.round(25 + 15 * u),   // R: 25 → 40
          Math.round(40 + 40 * u),   // G: 40 → 80
          Math.round(60 - 20 * u)    // B: 60 → 40
        ];
      } else if (t < 0.75) { 
        // Темный зеленый → темный оранжевый
        const u = (t - 0.5) / 0.25;
        return [
          Math.round(40 + 60 * u),   // R: 40 → 100
          Math.round(80 - 10 * u),   // G: 80 → 70
          Math.round(40 - 20 * u)    // B: 40 → 20
        ];
      } else { 
        // Темный оранжевый → умеренно-красный
        const u = (t - 0.75) / 0.25;
        return [
          Math.round(100 + 60 * u),  // R: 100 → 160
          Math.round(70 - 30 * u),   // G: 70 → 40
          Math.round(20 - 10 * u)    // B: 20 → 10
        ];
      }
    };

    for (let j=0;j<h;j++){
      const y = ((j+0.5)/h)*2*params.range - params.range;
      for (let i=0;i<w;i++){
        const x = ((i+0.5)/w)*2*params.range - params.range;
        const v = f(x,y);
        const tt = (v - fmin) / denom;
        const [r,g,b] = grad(tt);
        const idx = (j*w+i)*4;
        img.data[idx+0]=r; img.data[idx+1]=g; img.data[idx+2]=b; img.data[idx+3]=255;
      }
    }
    hctx.putImageData(img,0,0);
    heatValid = true;
  }

  // ===== Координатные преобразования =====
  function worldToPix(p){
    return {
      x: (p.x + params.range) / (2*params.range) * canvas.width,
      y: (p.y + params.range) / (2*params.range) * canvas.height
    };
  }

  // ===== Шаг SDS =====
  function step(){
    if (isPaused || !isAnimationRunning) return;

    const n = agents.length;
    winnersIdx.length = 0;
    let sum = 0; bestF = -Infinity;

    // 1) локальный бинарный тест
    for (let i=0;i<n;i++){
      const a = agents[i];
      const xr = randInRange();
      const yr = randInRange();
      const fi = f(a.x, a.y);
      const fr = f(xr, yr);
      a.success = (fi >= fr);
      if (a.success) winnersIdx.push(i);
      if (fi > bestF) bestF = fi;
      sum += fi;
    }

    // 2) диффузия
    if (winnersIdx.length === 0){
      for (let i=0;i<n;i++){
        if (rng.next() < params.restartProb){
          agents[i].x = randInRange();
          agents[i].y = randInRange();
        }
      }
    } else {
      for (let i=0;i<n;i++){
        const a = agents[i];
        if (!a.success){
          const j = winnersIdx[(winnersIdx.length * rng.next())|0];
          a.x = agents[j].x; a.y = agents[j].y;
        }
      }
    }

    // 3) разведка (шум)
    const sig = params.anneal ? params.sigma * Math.pow(params.annealDecay, t) : params.sigma;
    for (let i=0;i<n;i++){
      agents[i].x = clamp(agents[i].x + rng.randn()*sig, -params.range, params.range);
      agents[i].y = clamp(agents[i].y + rng.randn()*sig, -params.range, params.range);
    }

    // обновим треки
    for (let k=0;k<tracksIdx.length;k++){
      const idx = tracksIdx[k];
      const tr = tracks[k];
      tr.push([agents[idx].x, agents[idx].y]);
      if (tr.length > params.maxTrail) tr.shift();
    }

    // метрики
    meanF = sum / n;
    winnersFrac = winnersIdx.length / n;
    t += 1;

    // Обновление UI панели (если элементы существуют)
    updateUIMetrics();
  }

  // ===== Обновление метрик в UI =====
  function updateUIMetrics() {
    // Обновляем таблицу в панели управления
    const iterationEl = document.getElementById('iterationCount');
    const bestFitnessEl = document.getElementById('bestFitness');
    const winnersCountEl = document.getElementById('winnersCount');

    if (iterationEl) iterationEl.textContent = t;
    if (bestFitnessEl) bestFitnessEl.textContent = bestF.toFixed(4);
    if (winnersCountEl) winnersCountEl.textContent = winnersIdx.length;
  }

  // ===== Отрисовка =====
  function draw(){
    if (!heatValid) renderHeatmap();
    ctx.clearRect(0,0,canvas.width,canvas.height);

    if (params.showHeatmap) ctx.drawImage(heatCanvas, 0, 0);

    // траектории
    if (params.showTraj){
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = params.trail;
      for (let k=0;k<tracks.length;k++){
        const tr = tracks[k]; if (tr.length<2) continue;
        ctx.beginPath();
        for (let m=0;m<tr.length;m++){
          const [x,y] = tr[m];
          const p = worldToPix({x,y});
          if (m===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // агенты
    for (let i=0;i<agents.length;i++){
      const a = agents[i];
      const p = worldToPix(a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, a.success? 2.8 : 2.2, 0, Math.PI*2);
      ctx.fillStyle = a.success ? params.colorWin : params.colorLose;
      ctx.globalAlpha = a.success ? 0.95 : 0.8;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // метка глобального максимума (изменен цвет для лучшей видимости)
    if (params.showBest){
      const hint = Objectives[params.func].hint;
      if (hint){
        const p = worldToPix(hint);
        ctx.beginPath(); 
        ctx.arc(p.x, p.y, 6, 0, Math.PI*2); 
        ctx.strokeStyle = '#f59e0b'; // яркий оранжевый цвет
        ctx.lineWidth = 3; 
        ctx.stroke();
        ctx.beginPath(); 
        ctx.moveTo(p.x-10,p.y); ctx.lineTo(p.x+10,p.y); 
        ctx.moveTo(p.x,p.y-10); ctx.lineTo(p.x,p.y+10); 
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  // ===== Цикл =====
  function loop(){
    // Выполняем шаги алгоритма только если не на паузе
    if (!isPaused && isAnimationRunning) {
      for (let k=0;k<params.stepsPerFrame;k++) step();
    }
    draw();
    if (isAnimationRunning) {
      animationId = requestAnimationFrame(loop);
    }
  }

  // ===== Функции управления анимацией =====
  function startAnimation() {
    if (!isAnimationRunning) {
      isAnimationRunning = true;
      isPaused = false;
      loop();
    }
  }

  function pauseAnimation() {
    isPaused = true;
    isAnimationRunning = false;
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
    // Рисуем один кадр в паузе
    drawStaticFrame();
  }

  function drawStaticFrame() {
    draw();
  }

  // ===== API =====
  function updateParam(key, val){
    if (key === 'N') {
      params.N = Math.max(10, Math.floor(val));
      initAgents();
      return;
    }
    if (key === 'func') {
      if (Objectives[val]) { params.func = val; heatValid = false; initAgents(); }
      return;
    }
    if (key === 'seed') {
      params.seed = (val>>>0) || 123456789; rng = new RNG(params.seed); initAgents(); return;
    }
    params[key] = val;
    if (key === 'heatGrid') heatValid = false;
  }

  function updateParams(newParams){
    for (const [k,v] of Object.entries(newParams)) updateParam(k, v);
  }

  function updateCanvasSize(){
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (W && H && (canvas.width!==W || canvas.height!==H)){
      canvas.width=W; canvas.height=H; heatValid=false;
    }
  }

  // ===== Функции управления =====
  function pause() {
    isPaused = true;
  }

  function resume() {
    isPaused = false;
    if (!isAnimationRunning) {
      startAnimation();
    }
  }

  function togglePause() {
    if (isPaused) {
      resume();
    } else {
      pause();
    }
    return isPaused;
  }

  function reset() {
    initAgents();
    updateUIMetrics();
  }

  function stop(){ 
    if (animationId) cancelAnimationFrame(animationId);
    isAnimationRunning = false;
    window.removeEventListener('resize', onResize); 
  }

  function onResize(){ updateCanvasSize(); }

  // ===== Инициализация всплывающих подсказок =====
  async function initTooltips() {
    const tooltipData = {
      'func': {
        title: 'Целевая функция $f$',
        description: 'Оптимизируемая функция $f: \\mathcal{S} \\rightarrow \\mathbb{R}_+$ для максимизации на области поиска $\\mathcal{S}$.'
      },
      'N': {
        title: 'Размер популяции $N$',
        description: 'Количество агентов в популяции $N \\in \\mathbb{N}$. Больший размер улучшает исследование пространства поиска.'
      },
      'sigma': {
        title: 'Дисперсия шума $\\sigma_0$',
        description: 'Начальная дисперсия гауссовского шума для разведки $\\sigma_0 > 0$. Контролирует интенсивность исследования.'
      },
      'restartProb': {
        title: 'Вероятность перезапуска $p_{\\text{restart}}$',
        description: 'Доля агентов для случайного перезапуска при отсутствии успешных агентов $p_{\\text{restart}} \\in [0,1]$.'
      },
      'rho': {
        title: 'Коэффициент затухания $\\rho$',
        description: 'Мультипликативный коэффициент уменьшения дисперсии $\\rho \\in (0,1)$: $\\sigma^{(t)} = \\sigma_0 \\cdot \\rho^t$.'
      },
      'maxIterations': {
        title: 'Бюджет итераций $T$',
        description: 'Максимальное количество итераций алгоритма $T \\in \\mathbb{N}$ для ограничения времени выполнения.'
      },
      'seed': {
        title: 'Seed (ГПСЧ)',
        description: 'Начальное значение генератора псевдослучайных чисел для воспроизводимости результатов.'
      },
      'anneal': {
        title: 'Адаптивное затухание',
        description: 'Использование адаптивного уменьшения дисперсии со временем: $\\sigma^{(t)} = \\sigma_0 \\cdot \\rho^t$.'
      }
    };

    // Создаем скрытые элементы для предрендеринга LaTeX
    const hiddenContainer = document.createElement('div');
    hiddenContainer.style.position = 'absolute';
    hiddenContainer.style.left = '-9999px';
    hiddenContainer.style.visibility = 'hidden';
    document.body.appendChild(hiddenContainer);

    // Предрендериваем все формулы
    for (const [key, data] of Object.entries(tooltipData)) {
      const element = document.createElement('div');
      element.innerHTML = `<strong>${data.title}</strong><br>${data.description}`;
      hiddenContainer.appendChild(element);
      tooltipElements[key] = element;
    }

    // Рендерим LaTeX формулы
    if (window.MathJax && window.MathJax.typesetPromise) {
      await window.MathJax.typesetPromise([hiddenContainer]);
    }

    const tooltip = document.getElementById('tooltip');
    const tooltipLabels = document.querySelectorAll('.tooltip-label');

    tooltipLabels.forEach(label => {
      const tooltipKey = label.getAttribute('data-tooltip');
      const element = tooltipElements[tooltipKey];
      
      if (element) {
        label.addEventListener('mouseenter', (e) => {
          tooltip.innerHTML = element.innerHTML;
          tooltip.style.display = 'block';
          
          const rect = label.getBoundingClientRect();
          tooltip.style.left = (rect.right + 10) + 'px';
          tooltip.style.top = rect.top + 'px';
        });

        label.addEventListener('mouseleave', () => {
          tooltip.style.display = 'none';
        });

        label.addEventListener('mousemove', (e) => {
          tooltip.style.left = (e.clientX + 10) + 'px';
          tooltip.style.top = (e.clientY - 10) + 'px';
        });
      }
    });
  }

  // ===== Функция для получения текущих метрик =====
  function getMetrics() {
    return {
      t: t,
      bestF: bestF,
      meanF: meanF,
      winnersFrac: winnersFrac,
      winnersCount: winnersIdx.length,
      totalAgents: agents.length,
      isPaused: isPaused
    };
  }

  function createUI() {
    if (params.isPreview) {
      // Для превью рисуем статичный кадр после небольшой задержки, 
      // чтобы убедиться что canvas готов
      setTimeout(() => {
        drawStaticFrame();
      }, 10);
      
      return { 
        params, 
        updateParams, 
        updateParam, 
        getMetrics, 
        startAnimation, 
        pauseAnimation,
        drawStaticFrame
      };
    }

    // Инициализация всплывающих подсказок
    setTimeout(() => {
      initTooltips();
    }, 1000); // Даём время MathJax для загрузки

    const controlPanel = document.getElementById('controlPanel');
    const toggleBtn = document.getElementById('toggleBtn');
    
    // Панель изначально свёрнута
    let isCollapsed = true;
    toggleBtn.textContent = '☰';
    
    // Сворачивание/разворачивание панели
    toggleBtn.addEventListener('click', () => {
      isCollapsed = !isCollapsed;
      controlPanel.classList.toggle('collapsed', isCollapsed);
      toggleBtn.textContent = isCollapsed ? '☰' : '←';
    });

    // Состояние интерфейса
    let isAdvancedExpanded = false;
    let maxIterations = 1000;

    // Названия функций из теории
    const functionNames = {
      'twopeaks': 'Две горки',
      'sphere': 'Сфера',
      'rastrigin': 'Растригин',
      'ackley': 'Акли'
    };

    // Кнопки управления
    const pauseBtn = document.getElementById('pauseBtn');
    pauseBtn.addEventListener('click', () => {
      const isPausedNow = togglePause();
      pauseBtn.textContent = isPausedNow ? 'Старт' : 'Пауза';
      pauseBtn.classList.toggle('active', !isPausedNow);
      // Сбрасываем активных агентов при паузе
      if (isPausedNow) {
        document.getElementById('winnersCount').textContent = '0';
      }
    });

    // Кнопка генерации нового сида
    document.getElementById('newSeedBtn').addEventListener('click', () => {
      reset();
      const newSeed = Math.floor(Math.random() * 1000000000);
      updateParam('seed', newSeed);
      document.getElementById('seed').value = newSeed;
      // Сбрасываем все метрики при генерации нового сида
      document.getElementById('iterationCount').textContent = '0';
      document.getElementById('bestFitness').textContent = '0.0000';
      document.getElementById('winnersCount').textContent = '0';
    });

    // Кнопка тепловой карты
    const heatmapBtn = document.getElementById('showHeatmapBtn');
    heatmapBtn.classList.toggle('active', params.showHeatmap);
    heatmapBtn.addEventListener('click', () => {
      const newState = !params.showHeatmap;
      updateParam('showHeatmap', newState);
      heatmapBtn.classList.toggle('active', newState);
      heatmapBtn.textContent = newState ? 'Тепло ВКЛ' : 'Тепло ВЫКЛ';
    });

    // Кнопка траекторий
    const trajBtn = document.getElementById('showTrajBtn');
    trajBtn.classList.toggle('active', params.showTraj);
    trajBtn.addEventListener('click', () => {
      const newState = !params.showTraj;
      updateParam('showTraj', newState);
      trajBtn.classList.toggle('active', newState);
      trajBtn.textContent = newState ? 'След ВКЛ' : 'След ВЫКЛ';
    });

    // Кнопка отображения максимума
    const bestBtn = document.getElementById('showBestBtn');
    bestBtn.classList.toggle('active', params.showBest);
    bestBtn.addEventListener('click', () => {
      const newState = !params.showBest;
      updateParam('showBest', newState);
      bestBtn.classList.toggle('active', newState);
      bestBtn.textContent = newState ? 'Макс ВКЛ' : 'Макс ВЫКЛ';
    });

    // Кнопка выбора функции
    const funcBtn = document.getElementById('funcBtn');
    const funcKeys = Object.keys(functionNames);
    let funcIndex = funcKeys.indexOf(params.func);
    funcBtn.textContent = functionNames[params.func];
    funcBtn.addEventListener('click', () => {
      funcIndex = (funcIndex + 1) % funcKeys.length;
      const newFunc = funcKeys[funcIndex];
      updateParam('func', newFunc);
      funcBtn.textContent = functionNames[newFunc];
      updateDisplay();
    });

    // Расширенные настройки
    document.getElementById('advancedBtn').addEventListener('click', () => {
      isAdvancedExpanded = !isAdvancedExpanded;
      const advancedControls = document.getElementById('advancedControls');
      const advancedBtn = document.getElementById('advancedBtn');
      
      if (isAdvancedExpanded) {
        advancedControls.style.display = 'block';
        advancedBtn.textContent = 'Скрыть расширенные настройки';
      } else {
        advancedControls.style.display = 'none';
        advancedBtn.textContent = 'Расширенные настройки';
      }
    });

    // Кнопка адаптивного затухания
    const annealBtn = document.getElementById('annealBtn');
    annealBtn.classList.toggle('active', params.anneal);
    annealBtn.textContent = params.anneal ? 'вкл' : 'выкл';
    annealBtn.addEventListener('click', () => {
      const newState = !params.anneal;
      updateParam('anneal', newState);
      annealBtn.classList.toggle('active', newState);
      annealBtn.textContent = newState ? 'вкл' : 'выкл';
    });

    // Функция для привязки слайдеров
    function bindSlider(id, callback) {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(id + 'Val');
      
      slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        callback(value);
        
        // Обновление отображения значения
        if (valueDisplay) {
          if (id === 'populationSize' || id === 'maxIterations') {
            valueDisplay.textContent = Math.round(value).toString();
          } else if (id === 'sigma') {
            valueDisplay.textContent = value.toFixed(2);
          } else if (id === 'restartProb') {
            valueDisplay.textContent = value.toFixed(2);
          } else if (id === 'annealDecay') {
            valueDisplay.textContent = value.toFixed(3);
          } else {
            valueDisplay.textContent = value.toString();
          }
        }
      });
    }

    // Привязка всех слайдеров
    bindSlider('populationSize', (v) => updateParam('N', parseInt(v)));
    bindSlider('sigma', (v) => updateParam('sigma', v));
    bindSlider('restartProb', (v) => updateParam('restartProb', v));
    bindSlider('annealDecay', (v) => updateParam('annealDecay', v));
    bindSlider('maxIterations', (v) => {
      maxIterations = parseInt(v);
      return parseInt(v);
    });

    // Текстовое поле seed
    document.getElementById('seed').addEventListener('change', (e) => {
      updateParam('seed', parseInt(e.target.value) || 123456789);
      updateDisplay();
    });

    function updateDisplay() {
      const metrics = getMetrics();
      document.getElementById('iterationCount').textContent = metrics.t;
      document.getElementById('bestFitness').textContent = metrics.bestF.toFixed(4);
      document.getElementById('winnersCount').textContent = metrics.winnersCount;
    }

    // Обновление метрик в реальном времени
    function updateMetrics() {
      updateDisplay();
      requestAnimationFrame(updateMetrics);
    }

    // Инициализация значений
    updateDisplay();
    
    // Скрытие расширенных настроек по умолчанию
    document.getElementById('advancedControls').style.display = 'none';

    startAnimation();
    updateMetrics();
  }

  // ===== Публичный интерфейс =====

  // ===== Старт =====
  initAgents();
  renderHeatmap();
  window.addEventListener('resize', onResize);
  
  // Запускаем анимацию если не указан стартовый режим паузы
  if (!isPaused) {
    startAnimation();
  } else {
    drawStaticFrame();
  }

  return { 
    params, 
    updateParams, 
    updateParam, 
    createUI,
    getMetrics, 
    pause,
    resume,
    togglePause,
    reset,
    stop,
    startAnimation,
    pauseAnimation,
    drawStaticFrame
  };
}
