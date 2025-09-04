export function initBoids(canvas, options = {}) {
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  // Векторная алгебра
  const add  = (a,b)=>({x:a.x+b.x,y:a.y+b.y});
  const sub  = (a,b)=>({x:a.x-b.x,y:a.y-b.y});
  const mult = (v,s)=>({x:v.x*s,y:v.y*s});
  const div  = (v,s)=>({x:v.x/s,y:v.y/s});
  const mag  = v => Math.hypot(v.x,v.y);
  const norm = v => {
    const m = mag(v);
    return m===0 ? {x:0,y:0} : {x:v.x/m,y:v.y/m};
  };
  const setMag = (v,m)=> mult(norm(v), m);
  const clipMag = (v, m)=> {
    const mm = mag(v);
    return mm>m ? mult(v, m/mm) : v;
  };
  const dot = (a,b)=> a.x*b.x + a.y*b.y;

  // Состояние симуляции
  let isPaused = options.startPaused ?? false;
  let wallsEnabled = true;
  let animationId = null;
  let isAnimationRunning = false;

  // Предрендеренные LaTeX формулы
  let tooltipElements = {};

  // Параметры
  const params = {
    // кинематика
    dt: options.dt ?? 1.0,
    v_max: options.v_max ?? 2.5,
    a_max: options.a_max ?? 0.05,

    // предпочтительная скорость для направляющих правил
    v_pref: options.v_pref ?? (options.v_max ? 0.6*options.v_max : 0.6*2.5),

    // временные константы релаксации
    tauMatch:  options.tauMatch  ?? 1.0,
    tauCenter: options.tauCenter ?? 1.2,
    tauSep:    options.tauSep    ?? 0.6,

    // коэффициент силы разделения
    k_sep: options.k_sep ?? 1.0,

    // демпфирование (только ускорительное A_damp = -gamma * V)
    dampMode: options.dampMode ?? false,   // 'off' | 'accel'
    gamma: options.gamma ?? 0.0,           // с^-1 в дискретизации через dt

    // восприятие
    r: options.r ?? 60,                    // радиус соседства для match/center (метрическое)
    r_sep: options.r_sep ?? 30,            // ближняя зона separation (изотропная)
    fovDeg: options.fovDeg ?? 135,
    get phi(){ return (this.fovDeg * Math.PI) / 180; },

    // режим выбора соседей для match/center
    // neighborMode: options.neighborMode ?? 'metric', // 'metric' | 'topo'
    neighborMode: options.neighborMode ?? true,
    kTopo: options.kTopo ?? 7,                      // число ближайших (топологическое)

    // веса правил (безразмерные)
    w: {
      match: options.w_match ?? 1.0,
      center: options.w_center ?? 0.8,
      sep: options.w_sep ?? 1.2
    },

    // визуализация
    boidCount: options.boidCount ?? 100,
    tracing: options.tracing ?? false,
    boidSize: options.boidSize ?? 6,
    color: options.color ?? "white",
    showFov: options.showFov ?? false,
    isPreview: options.isPreview ?? false,
    startPaused: options.startPaused ?? false
  };

  // Сектор обзора для match/center: сравнение по скалярному произведению
  function inFOV(boid, other, radius){
    const toOther = sub(other.X, boid.X);
    const d = mag(toOther);
    if (!isFinite(radius)) {
      if (d===0) return false;
    } else {
      if (d===0 || d>radius) return false;
    }

    if (params.phi >= 2*Math.PI) return true;

    const spd = mag(boid.V);
    if (spd===0) return true; // нулевая скорость -> изотропный обзор

    const cosHalf = Math.cos(params.phi/2);
    // V·(Xj−Xi) ≥ |V|·|Xj−Xi|·cos(phi/2)
    return dot(boid.V, toOther) >= spd * d * cosHalf;
  }

  // Соседи для правил match/center по выбранному режиму
  function neighborsForMatchCenter(self, boids){
    if (params.neighborMode) {
      const res = [];
      for (const other of boids){
        if (other===self) continue;
        if (inFOV(self, other, params.r)) res.push(other);
      }
      return res;
    } else {
      const candidates = [];
      for (const other of boids){
        if (other===self) continue;
        if (inFOV(self, other, Infinity)) {
          const d = mag(sub(other.X, self.X));
          candidates.push({other, d});
        }
      }
      candidates.sort((a,b)=> a.d - b.d);
      const k = Math.max(0, Math.floor(params.kTopo));
      const res = [];
      for (let i=0; i<Math.min(k, candidates.length); i++){
        res.push(candidates[i].other);
      }
      return res;
    }
  }

  class Boid {
    constructor(){
      this.X = { x: Math.random()*canvas.width,  y: Math.random()*canvas.height };
      const dir = norm({ x: Math.random()*2-1, y: Math.random()*2-1 });
      this.V = mult(dir, 0.5*params.v_max); // старт умеренный
      this.A = { x:0, y:0 };
      this.radius = params.boidSize;
      this.history = [];
      this.maxTrail = 40;
    }

    edges(){
      if (!wallsEnabled) {
        // тороидальная геометрия
        if (this.X.x < 0) this.X.x = canvas.width;
        if (this.X.x > canvas.width) this.X.x = 0;
        if (this.X.y < 0) this.X.y = canvas.height;
        if (this.X.y > canvas.height) this.X.y = 0;
      } else {
        // отражающие границы
        if (this.X.x < 0) { this.X.x=0; this.V.x*=-1; }
        if (this.X.x > canvas.width) { this.X.x=canvas.width; this.V.x*=-1; }
        if (this.X.y < 0) { this.X.y=0; this.V.y*=-1; }
        if (this.X.y > canvas.height){ this.X.y=canvas.height; this.V.y*=-1; }
      }
    }

    // Ускорение для выравнивания (alignment)
    accelMatch(boids){
      const neigh = neighborsForMatchCenter(this, boids);
      const count = neigh.length;
      if (count === 0) return {x:0, y:0};

      let avgV = {x:0, y:0};
      for (const other of neigh) avgV = add(avgV, other.V);
      avgV = div(avgV, count);

      // если средняя скорость почти нулевая — не "тормозим" резко; тянемся к текущему направлению
      const eps = 1e-6;
      const desired = (mag(avgV) < eps) ? this.V : setMag(avgV, Math.min(params.v_pref, params.v_max));
      const a = mult(sub(desired, this.V), 1/Math.max(params.tauMatch, eps));
      return a;
    }

    // Ускорение для центрирования (cohesion)
    accelCenter(boids){
      const neigh = neighborsForMatchCenter(this, boids);
      const n = neigh.length;
      if (n===0) return {x:0,y:0};

      let sum = {x:0,y:0};
      for (const b of neigh) sum = add(sum, b.X);
      const C = div(sum, n);

      const toC = sub(C, this.X);
      const eps = 1e-6;
      if (mag(toC) < eps) return {x:0,y:0};

      const desired = setMag(toC, Math.min(params.v_pref, params.v_max));
      const a = mult(sub(desired, this.V), 1/Math.max(params.tauCenter, eps));
      return a;
    }

    // Ускорение для разделения (separation) — изотропная ближняя зона d < r_sep
    accelSep(boids){
      let F = {x:0, y:0};
      for (const other of boids) {
        if (other === this) continue;
        const dvec = sub(other.X, this.X);
        const dist = mag(dvec);
        if (dist > 0 && dist < params.r_sep) {
          // вес ~ (r_sep/dist - 1) по направлению отталкивания
          const w = Math.max(0, params.r_sep/dist - 1);
          const away = mult(norm(dvec), -1);
          F = add(F, mult(away, w));
        }
      }
      if (F.x === 0 && F.y === 0) return {x:0, y:0};

      const eps = 1e-6;
      // ускорение сепарации как k_sep/τ_sep * F
      return mult(F, params.k_sep / Math.max(params.tauSep, eps));
    }

    // Арбитраж: суммирование ускорений правил, демпфирование, одна отсечка по a_max
    flock(boids){
      const A_match  = this.accelMatch(boids);
      const A_center = this.accelCenter(boids);
      const A_sep    = this.accelSep(boids);

      const A_damp = (params.dampMode)
        ? mult(this.V, -params.gamma)   // A_damp = -gamma V
        : {x:0,y:0};

      const Areq = add(
        add( mult(A_sep,    params.w.sep),
            add( mult(A_match,  params.w.match),
                 mult(A_center, params.w.center) ) ),
        A_damp
      );

      this.A = clipMag(Areq, params.a_max);
    }

    update(){
      if (isPaused || !isAnimationRunning) return;

      // интегрирование с явным dt
      this.V = add(this.V, mult(this.A, params.dt));
      this.V = clipMag(this.V, params.v_max);
      this.X = add(this.X, mult(this.V, params.dt));

      this.A = {x:0,y:0};

      if (params.tracing){
        this.history.push({x:this.X.x,y:this.X.y});
        if (this.history.length>this.maxTrail) this.history.shift();
      }
    }

    getTrailColor(){
      const s = Math.min(1, mag(this.V)/params.v_max);
      const r = Math.floor(255*s);
      const g = Math.floor(255*(1 - Math.abs(s-0.5)*2));
      const b = Math.floor(255*(1-s));
      return `rgba(${r},${g},${b},0.4)`;
    }

    draw(){
      if (params.tracing && this.history.length>1){
        ctx.beginPath();
        ctx.moveTo(this.history[0].x, this.history[0].y);
        for (const p of this.history) ctx.lineTo(p.x,p.y);
        ctx.strokeStyle = this.getTrailColor();
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      if (params.showFov){
        const ang = Math.atan2(this.V.y, this.V.x);
        const r = params.r;
        ctx.beginPath();
        ctx.moveTo(this.X.x, this.X.y);
        ctx.arc(this.X.x, this.X.y, r, ang - params.phi/2, ang + params.phi/2);
        ctx.closePath();
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(this.X.x, this.X.y, params.r_sep, 0, 2*Math.PI);
        ctx.strokeStyle = "rgba(255,0,0,0.15)";
        ctx.stroke();
      }

      const ang = Math.atan2(this.V.y, this.V.x);
      ctx.save();
      ctx.translate(this.X.x, this.X.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(this.radius*2, 0);
      ctx.lineTo(-this.radius,  this.radius);
      ctx.lineTo(-this.radius, -this.radius);
      ctx.closePath();
      ctx.fillStyle = params.color;
      ctx.fill();
      ctx.restore();
    }
  }

  let boids = Array.from({length: params.boidCount}, ()=> new Boid());

  function updateBoidCount(n){
    params.boidCount = n;
    boids = Array.from({length:n}, ()=> new Boid());
  }

  function updateParams(newParams){
    if (newParams.w_match!==undefined) params.w.match = newParams.w_match;
    if (newParams.w_center!==undefined) params.w.center = newParams.w_center;
    if (newParams.w_sep!==undefined) params.w.sep = newParams.w_sep;
    Object.assign(params, Object.fromEntries(Object.entries(newParams).filter(([k])=>
      !['w_match','w_center','w_sep'].includes(k)
    )));
    if (newParams.boidSize!==undefined){
      boids.forEach(b=> b.radius = params.boidSize);
    }
  }

  function animate(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (const b of boids){
      if (!isPaused && isAnimationRunning) {
        b.flock(boids);
        b.update();
        b.edges();
      }
      b.draw();
    }
    if (isAnimationRunning) {
      animationId = requestAnimationFrame(animate);
    }
  }

  function startAnimation() {
    if (!isAnimationRunning) {
      isAnimationRunning = true;
      isPaused = false;
      animate();
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
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (const b of boids) {
      b.draw();
    }
  }

  async function initTooltips() {
    const tooltipData = {
      'dt': {
        title: 'Шаг интегрирования $\\Delta t$',
        description: 'Дискретизация времени для явной схемы Эйлера. Увеличение ускоряет процесс эволюции всей системы.'
      },
      'v_max': {
        title: 'Ограничение скорости $v_{\\max}$',
        description: 'Верхняя граница для нормы скорости $\\| v \\|$. Явно определяет максимальную скорость движения всех особей и косвенно ограничивает быстроту поворота без явного расчета кривизны.'
      },
      'a_max': {
        title: 'Ограничение ускорения $a_{\\max}$',
        description: 'Верхняя граница для нормы результирующего ускорения после суммирования всех компонент побуждений. Определяет маневренность, подавляет резкие изменения траектории.'
      },
      'v_pref': {
        title: 'Предпочтительная скорость $v_{\\text{pref}}$',
        description: 'Целевая скорость для опорных векторов выравнивания и центрирования. Формирует типовой масштаб движения, не являясь жестким ограничением.'
      },
      'tauMatch': {
        title: 'Постоянная выравнивания $\\tau_{\\mathrm{match}}$',
        description: 'Время релаксации в $a_{\\mathrm{match}}$. Уменьшение ускоряет локальное согласование скоростей.'
      },
      'tauCenter': {
        title: 'Постоянная центрирования $\\tau_{\\mathrm{center}}$',
        description: 'Время релаксации в $a_{\\mathrm{center}}$. Уменьшение ускоряет быстроту переориентирования особей к локальному центру.'
      },
      'tauSep': {
        title: 'Постоянная разделения $\\tau_{\\mathrm{sep}}$',
        description: 'Время релаксации в $a_{\\mathrm{sep}}$. Задает быстроту реакции на сближение.'
      },
      'k_sep': {
        title: 'Интенсивность разделения $k_{\\mathrm{sep}}$',
        description: 'Безразмерное масштабирование суммарной «социальной» силы в ближней зоне. Линейно усиливает отталкивание независимо от $\\tau_{\\mathrm{sep}}$.'
      },
      'dampMode': {
        title: 'Режим вязкости среды',
        description: 'Включение компоненты $a_{\\mathrm{damp}} = \\gamma v$ в суммарное ускорение.'
      },
      'gamma': {
        title: 'Коэффициент вязкости $\\gamma$',
        description: 'Параметр экспоненциального затухания свободного движения.'
      },
      'neighborMode': {
        title: 'Схема соседства',
        description: 'Выбор окружения при выравнивании и центрировании: метрическое - по радиусу $r$, топологическое - по ближайшим $k$ соседям.'
      },
      'r': {
        title: 'Радиус восприятия $r$',
        description: 'Порог расстояния для метрического соседства. Применяется совместно с углом моделируемого поля зрения $\\phi$.'
      },
      'kTopo': {
        title: 'Число топологических соседей $k$',
        description: 'Размерность окружения при топологической схеме соседства. Не зависит от плотности агентов.'
      },
      'fovDeg': {
        title: 'Угол поля восприятия $\\phi$',
        description: 'Полный угол поля восприятия, ориентируемого относительно текущей скорости $v$. Определяет анизотропный выбор соседей.'
      },
      'r_sep': {
        title: 'Радиус ближней зоны $r_{\\mathrm{sep}}$',
        description: 'Изотропная зона действия правила разделения. Не зависит от сектора $\\phi$.'
      },
      'w_match': {
        title: 'Вес выравнивания $w_{\\mathrm{match}}$',
        description: 'Линейное масштабирование вклада компоненты выравнивания скоростей $a_{\\mathrm{match}}$ в суммарное ускорение.'
      },
      'w_center': {
        title: 'Вес центрирования $w_{\\mathrm{center}}$',
        description: 'Линейное масштабирование вклада компоненты центрирования $a_{\\mathrm{center}}$ в суммарное ускорение.'
      },
      'w_sep': {
        title: 'Вес разделения $w_{\\mathrm{sep}}$',
        description: 'Линейное масштабирование вклада компоненты разделения $a_{\\mathrm{sep}}$ в суммарное ускорение.'
      },
      'boidCount': {
        title: 'Число агентов $N$',
        description: 'Количество особей на сцене.'
      },
      'tracing': {
        title: 'След траектории',
        description: 'Отрисовка историй движения особей. Несет лишь визуальный характер, не влияя на динамику.'
      },
      'showFov': {
        title: 'Отображения полей восприятия',
        description: 'Отрисовка сектора $\\phi$ и окружности $r_{\\mathrm{sep}}$ для отображения геометрии восприятия.'
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

  function createUI(){
    if (params.isPreview) {
      // Для превью рисуем статичный кадр после небольшой задержки, 
      // чтобы убедиться что canvas готов
      setTimeout(() => {
        drawStaticFrame();
      }, 10);
      
      return { 
        params, 
        updateBoidCount, 
        updateParams, 
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

    // Кнопка паузы (изначально Play, так как симуляция запущена)
    const pauseBtn = document.getElementById('pauseBtn');
    pauseBtn.addEventListener('click', () => {
      isPaused = !isPaused;
      pauseBtn.textContent = isPaused ? 'Play' : 'Pause';
      pauseBtn.classList.toggle('active', !isPaused);
    });

    // Кнопка стен
    const wallsBtn = document.getElementById('wallsBtn');
    wallsBtn.addEventListener('click', () => {
      wallsEnabled = !wallsEnabled;
      wallsBtn.textContent = !wallsEnabled ? 'Walls ON' : 'Walls OFF';
      wallsBtn.classList.toggle('active', wallsEnabled);
    });

    // Кнопка FOV
    const fovBtn = document.getElementById('fovBtn');
    fovBtn.addEventListener('click', () => {
      params.showFov = !params.showFov;
      fovBtn.textContent = !params.showFov ? 'FOV ON' : 'FOV OFF';
      fovBtn.classList.toggle('active', params.showFov);
    });

    // Кнопка трасировки
    const tracingBtn = document.getElementById('tracingBtn');
    tracingBtn.addEventListener('click', () => {
      params.tracing = !params.tracing;
      tracingBtn.textContent = !params.tracing ? 'Trace ON' : 'Trace OFF';
      tracingBtn.classList.toggle('active', params.tracing);
    });

    // Кнопка расширенных настроек
    const advancedBtn = document.getElementById('advancedBtn');
    const advancedControls = document.getElementById('advancedControls');
    let advancedVisible = false;
    advancedBtn.addEventListener('click', () => {
      advancedVisible = !advancedVisible;
      if (advancedVisible) {
        advancedControls.classList.add('show');
        advancedBtn.textContent = 'Скрыть';
      } else {
        advancedControls.classList.remove('show');
        advancedBtn.textContent = 'Расширенные настройки';
      }
    });

    // Кнопка соседства
    const neighborBtn = document.getElementById('neighborBtn');
    const k_topo = document.getElementById('k_topo');
    neighborBtn.addEventListener('click', () => {
      params.neighborMode = !params.neighborMode;
      if (!params.neighborMode) {
        k_topo.classList.add('show');
        neighborBtn.textContent = 'topo';
      } else {
        k_topo.classList.remove('show');
        neighborBtn.textContent = 'metric';
      }
    });

    // Кнопка сопротивления
    const dampBtn = document.getElementById('dampBtn');
    const damp = document.getElementById('damp');
    dampBtn.addEventListener('click', () => {
      params.dampMode = !params.dampMode;
      if (!params.dampMode) {
        damp.classList.remove('show');
        dampBtn.textContent = 'off';
      } else {
        damp.classList.add('show');
        dampBtn.textContent = 'accel';
      }
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
          if (id === 'phi') {
            valueDisplay.textContent = value + '°';
          } else if (['taumatch', 'taucenter', 'tausep', 'ksep', 'vpref'].includes(id)) {
            valueDisplay.textContent = value.toFixed(2);
          } else if (id === 'boidCount' || id === 'kTopo') {
            valueDisplay.textContent = value.toString();
          } else {
            valueDisplay.textContent = value.toString();
          }
        }
      });
    }

    // Привязка всех слайдеров
    bindSlider('wmatch', (v) => params.w.match = v);
    bindSlider('wcenter', (v) => params.w.center = v);
    bindSlider('wsep', (v) => params.w.sep = v);
    bindSlider('dt', (v) => params.dt = v);
    bindSlider('boidCount', (v) => updateBoidCount(parseInt(v)));
    bindSlider('phi', (v) => params.fovDeg = v);
    bindSlider('kTopo', (v) => params.kTopo = parseInt(v));
    bindSlider('r', (v) => params.r = v);
    bindSlider('rsep', (v) => params.r_sep = v);
    bindSlider('vpref', (v) => params.v_pref = v);
    bindSlider('vmax', (v) => params.v_max = v);
    bindSlider('amax', (v) => params.a_max = v);
    bindSlider('taumatch', (v) => params.tauMatch = v);
    bindSlider('taucenter', (v) => params.tauCenter = v);
    bindSlider('tausep', (v) => params.tauSep = v);
    bindSlider('ksep', (v) => params.k_sep = v);
    bindSlider('gamma', (v) => params.gamma = v);

    startAnimation();
  }

  return { 
    params, 
    updateBoidCount, 
    updateParams, 
    createUI, 
    startAnimation, 
    pauseAnimation,
    drawStaticFrame
  };
}
