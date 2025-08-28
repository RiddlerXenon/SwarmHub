// Stochastic Diffusion Search (SDS) — реализация в стиле вашей функции initBoids
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
    N: options.N ?? 300,
    seed: options.seed ?? 123456789,

    // Поиск
    func: options.func ?? 'twopeaks', // ключ из Objectives
    get range(){ return Objectives[this.func].range; },
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

    // Палитра
    colorWin: options.colorWin ?? '#0f172a',  // победители
    colorLose: options.colorLose ?? '#64748b',// проигравшие
    trail: options.trail ?? '#111827',
  };

  // ===== Состояние алгоритма =====
  let rng = new RNG(params.seed);
  let t = 0;

  let agents = [];  // {x,y, success}
  let winnersIdx = [];
  let tracksIdx = []; // индексы трека
  let tracks = [];    // массив массивов [ [ [x,y], ... ], ... ]

  // Метрики
  let bestF = 0, meanF = 0, winnersFrac = 0;

  // Offscreen теплокарта
  let heatCanvas = document.createElement('canvas');
  let heatValid = false; // требует перерендера при смене функции/размера

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

  // ===== Тепловая карта =====
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

    // Колормапа для тёмного фона: глубокий синий → бирюзовый → оливковый → янтарный → тёплый красный
    const grad = t => {
      t = clamp(t, 0, 1);
      if (t < 0.25) { 
        // Синий → бирюзовый
        const u = t / 0.25;
        return [
          Math.round(20 + 20 * u),   // R: 20 → 40
          Math.round(40 + 80 * u),   // G: 40 → 120
          Math.round(90 + 100 * u)   // B: 90 → 190
        ];
      } else if (t < 0.5) { 
        // Бирюзовый → зелёный
        const u = (t - 0.25) / 0.25;
        return [
          Math.round(40 + 40 * u),   // R: 40 → 80
          Math.round(120 + 70 * u),  // G: 120 → 190
          Math.round(190 - 70 * u)   // B: 190 → 120
        ];
      } else if (t < 0.75) { 
        // Зелёный → янтарный
        const u = (t - 0.5) / 0.25;
        return [
          Math.round(80 + 120 * u),  // R: 80 → 200
          Math.round(190 - 20 * u),  // G: 190 → 170
          Math.round(120 - 60 * u)   // B: 120 → 60
        ];
      } else { 
        // Янтарный → красный
        const u = (t - 0.75) / 0.25;
        return [
          Math.round(200 + 40 * u),  // R: 200 → 240
          Math.round(170 - 90 * u),  // G: 170 → 80
          Math.round(60 - 40 * u)    // B: 60 → 20
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
  }

  // ===== Отрисовка =====
  function draw(){
    if (!heatValid) renderHeatmap();
    ctx.clearRect(0,0,canvas.width,canvas.height);

    if (params.showHeatmap) ctx.drawImage(heatCanvas, 0, 0);

    // траектории
    if (params.showTraj){
      ctx.lineWidth = 1.25;
      ctx.globalAlpha = 0.85;
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
      ctx.arc(p.x, p.y, a.success? 2.3 : 1.7, 0, Math.PI*2);
      ctx.fillStyle = a.success ? params.colorWin : params.colorLose;
      ctx.globalAlpha = a.success ? 0.96 : 0.86;
      ctx.fill();
      ctx.globalAlpha = 1.0;
    }

    // метка глобального максимума
    if (params.showBest){
      const hint = Objectives[params.func].hint;
      if (hint){
        const p = worldToPix(hint);
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI*2); ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(p.x-8,p.y); ctx.lineTo(p.x+8,p.y); ctx.moveTo(p.x,p.y-8); ctx.lineTo(p.x,p.y+8); ctx.stroke();
      }
    }

    // оверлей метрик
    ctx.fillStyle = 'rgba(248,250,252,0.9)';
    ctx.fillRect(8,8,220,70);
    ctx.fillStyle = '#0f172a';
    ctx.font = '12px ui-sans-serif, system-ui';
    ctx.fillText(`t: ${t}`, 16, 26);
    ctx.fillText(`winners: ${(winnersFrac*100).toFixed(1)}%`, 16, 42);
    ctx.fillText(`best f: ${bestF.toFixed(4)}`, 16, 58);
    ctx.fillText(`mean f: ${meanF.toFixed(4)}`, 116, 58);
  }

  // ===== Цикл =====
  let raf = null;
  function loop(){
    for (let k=0;k<params.stepsPerFrame;k++) step();
    draw();
    raf = requestAnimationFrame(loop);
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

  function stop(){ if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); }

  function onResize(){ updateCanvasSize(); }

  // ===== UI: панель управления в стиле вашего примера =====
  function createControls(container){
    const funcOptions = FUNC_KEYS.map(k=>`<option value="${k}">${Objectives[k].name}</option>`).join('');
    const html = `
    <div style="background:rgba(0,0,0,0.72);padding:10px;font:12px ui-sans-serif,system-ui;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;">
      <label>Функция:<br>
        <select id="func" style="width:180px;">${funcOptions}</select>
      </label>

      <label>N:<br><span id="NVal">${params.N}</span>
        <input type="range" id="N" min="50" max="1200" step="10" value="${params.N}" style="width:110px;">
      </label>

      <label>σ:<br><span id="sigmaVal">${params.sigma.toFixed(3)}</span>
        <input type="range" id="sigma" min="0.005" max="0.2" step="0.005" value="${params.sigma}" style="width:110px;">
      </label>

      <label>steps/frame:<br><span id="spfVal">${params.stepsPerFrame}</span>
        <input type="range" id="stepsPerFrame" min="1" max="20" step="1" value="${params.stepsPerFrame}" style="width:110px;">
      </label>

      <label>restart p:<br><span id="restartVal">${params.restartProb.toFixed(2)}</span>
        <input type="range" id="restartProb" min="0" max="1" step="0.05" value="${params.restartProb}" style="width:110px;">
      </label>

      <label>heat grid:<br><span id="gridVal">${params.heatGrid}</span>
        <input type="range" id="heatGrid" min="80" max="400" step="10" value="${params.heatGrid}" style="width:110px;">
      </label>

      <label>Seed:<br>
        <input type="number" id="seed" value="${params.seed}" style="width:120px;">
      </label>

      <button id="randSeed" style="padding:5px 10px;background:#222;border:1px solid #555;color:#eee;border-radius:5px;cursor:pointer;">Random</button>

      <label class="tgl"><input type="checkbox" id="showHeatmap" ${params.showHeatmap?'checked':''}> Heatmap</label>
      <label class="tgl"><input type="checkbox" id="showTraj" ${params.showTraj?'checked':''}> Traj</label>
      <label class="tgl"><input type="checkbox" id="showBest" ${params.showBest?'checked':''}> Max mark</label>

      <label class="tgl"><input type="checkbox" id="anneal" ${params.anneal?'checked':''}> Anneal</label>
      <label>decay:<br><span id="decayVal">${params.annealDecay.toFixed(4)}</span>
        <input type="range" id="annealDecay" min="0.95" max="0.9999" step="0.0005" value="${params.annealDecay}" style="width:110px;">
      </label>
    </div>`;

    container.innerHTML = html;
    container.querySelector('#func').value = params.func;

    const bind = (id, handler)=>{
      const el = container.querySelector('#'+id);
      const lab = container.querySelector('#'+id+'Val');
      el.addEventListener('input', ()=>{
        let v = el.value;
        if (id==='N' || id==='heatGrid' || id==='stepsPerFrame') v = parseInt(v);
        else if (id==='seed') v = parseInt(v);
        else if (id==='restartProb' || id==='sigma' || id==='annealDecay') v = parseFloat(v);
        handler(v);
        if (lab) lab.textContent = (typeof v==='number' && !Number.isNaN(v)) ? (id==='sigma'? v.toFixed(3) : id==='restartProb'? v.toFixed(2) : id==='annealDecay'? v.toFixed(4) : v) : el.value;
      });
    };

    bind('func', v=> updateParam('func', v));
    bind('N', v=> updateParam('N', v));
    bind('sigma', v=> updateParam('sigma', v));
    bind('stepsPerFrame', v=> updateParam('stepsPerFrame', v));
    bind('restartProb', v=> updateParam('restartProb', v));
    bind('heatGrid', v=> updateParam('heatGrid', v));
    bind('annealDecay', v=> updateParam('annealDecay', v));

    const seedInput = container.querySelector('#seed');
    seedInput.addEventListener('change', ()=> updateParam('seed', parseInt(seedInput.value||'0')) );

    const randBtn = container.querySelector('#randSeed');
    randBtn.addEventListener('click', ()=>{ updateParam('seed', (Math.random()*2**31)|0); seedInput.value = params.seed; });

    const chk = (id,key)=>{
      const el = container.querySelector('#'+id);
      el.addEventListener('change', ()=>{ updateParam(key, !!el.checked); });
    };
    chk('showHeatmap','showHeatmap');
    chk('showTraj','showTraj');
    chk('showBest','showBest');
    chk('anneal','anneal');
  }

  // ===== Публичный интерфейс =====

  // ===== Старт =====
  initAgents();
  renderHeatmap();
  window.addEventListener('resize', onResize);
  loop();

  return { params, updateParams, updateParam, createControls, stop };
}
