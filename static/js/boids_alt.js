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
  const angleBetween = (v1,v2)=>{
    const a = norm(v1), b = norm(v2);
    const d = Math.max(-1, Math.min(1, a.x*b.x + a.y*b.y));
    return Math.acos(d);
  };

  // Параметры (по Рейнольдсу: локальность восприятия, три руля, ограничение по ускорению и скорости)
  const params = {
    // кинематика
    dt: options.dt ?? 1.0,
    v_max: options.v_max ?? 2.5,
    a_max: options.a_max ?? 0.05,

    // предпочтительная скорость и константы релаксации правил
    v_pref: options.v_pref ?? 0.6 * (options.v_max ?? 2.5),
    tau_match: options.tau_match ?? 2.0,
    tau_center: options.tau_center ?? 2.5,
    tau_sep: options.tau_sep ?? 1.5,

    // демпфирование (только ускорительное A_damp = -gamma * V)
    dampMode: options.dampMode ?? 'off',   // 'off' | 'accel'
    gamma: options.gamma ?? 0.0,           // с^-1 в дискретизации через dt

    // восприятие
    r: options.r ?? 60,                    // радиус соседства для match/center (метрическое)
    r_sep: options.r_sep ?? 30,            // ближняя зона separation (всегда метрическая)
    fovDeg: options.fovDeg ?? 135,
    get phi(){ return (this.fovDeg * Math.PI) / 180; },

    // режим выбора соседей для match/center
    neighborMode: options.neighborMode ?? 'metric', // 'metric' | 'topo'
    kTopo: options.kTopo ?? 7,                      // число ближайших (топологическое)

    // веса правил
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
    showFov: options.showFov ?? false
  };

  function inFOV(boid, other, radius){
    const toOther = sub(other.X, boid.X);
    const d = mag(toOther);
    if (d === 0 || d > radius) return false;
    if (params.phi >= 2*Math.PI) return true; // полный обзор

    const spd = mag(boid.V);
    if (spd === 0) return true; // изотропный обзор при нулевой скорости

    const cosHalf = Math.cos(params.phi/2);
    const dot = boid.V.x * toOther.x + boid.V.y * toOther.y;
    return dot >= spd * d * cosHalf;
  }

  // Соседи для правил match/center по выбранному режиму
  function neighborsForMatchCenter(self, boids){
    if (params.neighborMode === 'metric') {
      const res = [];
      for (const other of boids){
        if (other===self) continue;
        if (inFOV(self, other, params.r)) res.push(other);
      }
      return res;
    } else {
      // топология: k ближайших в секторе обзора, без ограничения по радиусу
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
      // отражающие границы (допустимое упрощение окружения)
      if (this.X.x < 0) { this.X.x=0; this.V.x*=-1; }
      if (this.X.x > canvas.width) { this.X.x=canvas.width; this.V.x*=-1; }
      if (this.X.y < 0) { this.X.y=0; this.V.y*=-1; }
      if (this.X.y > canvas.height){ this.X.y=canvas.height; this.V.y*=-1; }
    }

    // правило выравнивания (alignment / velocity matching) — возвращает УСКОРЕНИЕ
    ruleMatch(boids){
      const neigh = neighborsForMatchCenter(this, boids);
      const count = neigh.length;
      if (count === 0) return {x:0, y:0};
      let avgV = {x:0, y:0};
      for (const other of neigh) avgV = add(avgV, other.V);
      avgV = div(avgV, count);
      const m = mag(avgV);
      if (m < 1e-8) return {x:0, y:0};
      const desired = setMag(avgV, params.v_pref);
      return div(sub(desired, this.V), params.tau_match);
    }

    // правило центрирования (cohesion / flock centering) — возвращает УСКОРЕНИЕ
    ruleCenter(boids){
      const neigh = neighborsForMatchCenter(this, boids);
      const n = neigh.length;
      if (n===0) return {x:0,y:0};
      let sum = {x:0,y:0};
      for (const b of neigh) sum = add(sum, b.X);
      const C = div(sum, n);
      const desired = setMag(sub(C, this.X), params.v_pref);
      return div(sub(desired, this.V), params.tau_center);
    }

    // правило разделения (separation) — ближняя зона без FOV; возвращает УСКОРЕНИЕ
    ruleSep(boids){
      let force = {x:0, y:0};
      for (const other of boids) {
        if (other === this) continue;
        const dvec = sub(other.X, this.X);     // d_{ij} = X_j - X_i
        const dist = mag(dvec);
        if (dist > 0 && dist < params.r_sep) {
          const rho = (params.r_sep - dist) / params.r_sep; // [0,1)
          const away = mult(norm(dvec), -1);                // -d̂
          force = add(force, mult(away, rho));
        }
      }
      if (force.x === 0 && force.y === 0) return {x:0, y:0};
      return div(force, params.tau_sep);
    }

    // арбитраж: взвесить ускорения правил + демпфирование, затем одна отсечка по a_max
    flock(boids){
      const A_match  = this.ruleMatch(boids);
      const A_center = this.ruleCenter(boids);
      const A_sep    = this.ruleSep(boids);

      const A_damp = (params.dampMode === 'accel')
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

      const angle = Math.atan2(this.V.y, this.V.x);
      ctx.save();
      ctx.translate(this.X.x, this.X.y);
      ctx.rotate(angle);

      ctx.beginPath();
      const s = this.radius;
      ctx.moveTo(s, 0);
      ctx.lineTo(-s, 0.6*s);
      ctx.lineTo(-s, -0.6*s);
      ctx.closePath();

      ctx.fillStyle = params.color;
      ctx.fill();
      ctx.restore();
    }
  }

  // создание стаи
  let boids = Array.from({length: params.boidCount}, ()=> new Boid());

  function updateBoidCount(n){
    const cur = boids.length;
    if (n>cur) for (let i=0;i<n-cur;i++) boids.push(new Boid());
    else if (n<cur) boids = boids.slice(0, n);
  }

  function updateParams(newParams){
    Object.assign(params, newParams);
  }

  function animate(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for (const b of boids){
      b.flock(boids);
      b.update();
      b.edges();
      b.draw();
    }
    requestAnimationFrame(animate);
  }
  animate();

  function createControls(container){
    const html = `
      <div style="background:rgba(0,0,0,0.7);padding:10px;color:white;font:12px/1.2 sans-serif;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;">

        <label>dt:<br><span id="dtVal">${params.dt}</span>
          <input type="range" id="dt" min="0.1" max="2.0" step="0.1" value="${params.dt}">
        </label>

        <label>v_max:<br><span id="vmaxVal">${params.v_max}</span>
          <input type="range" id="vmax" min="0.5" max="6" step="0.1" value="${params.v_max}">
        </label>

        <label>a_max:<br><span id="amaxVal">${params.a_max}</span>
          <input type="range" id="amax" min="0.01" max="0.5" step="0.01" value="${params.a_max}">
        </label>

        <label>v_pref:<br><span id="vprefVal">${params.v_pref}</span>
          <input type="range" id="vpref" min="0.1" max="${params.v_max}" step="0.1" value="${params.v_pref}">
        </label>

        <label>τ_match:<br><span id="tmatchVal">${params.tau_match}</span>
          <input type="range" id="tmatch" min="0.5" max="5" step="0.1" value="${params.tau_match}">
        </label>

        <label>τ_center:<br><span id="tcenterVal">${params.tau_center}</span>
          <input type="range" id="tcenter" min="0.5" max="5" step="0.1" value="${params.tau_center}">
        </label>

        <label>τ_sep:<br><span id="tsepVal">${params.tau_sep}</span>
          <input type="range" id="tsep" min="0.3" max="5" step="0.1" value="${params.tau_sep}">
        </label>

        <label>γ (демпф):<br><span id="gammaVal">${params.gamma}</span>
          <input type="range" id="gamma" min="0" max="1" step="0.01" value="${params.gamma}">
        </label>

        <label>r (FOV радиус):<br><span id="rVal">${params.r}</span>
          <input type="range" id="r" min="10" max="150" step="1" value="${params.r}">
        </label>

        <label>r_sep:<br><span id="rsepVal">${params.r_sep}</span>
          <input type="range" id="rsep" min="5" max="100" step="1" value="${params.r_sep}">
        </label>

        <label>FOV, °:<br><span id="fovVal">${params.fovDeg}</span>
          <input type="range" id="fov" min="0" max="360" step="5" value="${params.fovDeg}">
        </label>

        <label>Mode:
          <select id="neighborMode">
            <option value="metric" ${params.neighborMode==='metric'?'selected':''}>metric</option>
            <option value="topo" ${params.neighborMode==='topo'?'selected':''}>topo</option>
          </select>
        </label>

        <label>kTopo:<br><span id="ktopoVal">${params.kTopo}</span>
          <input type="range" id="ktopo" min="1" max="20" step="1" value="${params.kTopo}">
        </label>

        <button id="traceBtn">${params.tracing ? 'Tracing ON' : 'Tracing OFF'}</button>
        <button id="fovBtn">${params.showFov ? 'Show FOV ON' : 'Show FOV OFF'}</button>

      </div>
    `;
    container.innerHTML = html;

    const q = id => container.querySelector(id);

    const bindRange = (id, key, spanId)=>{
      const el = q(id);
      const span = q(spanId);
      el.addEventListener('input', ()=>{
        params[key] = parseFloat(el.value);
        span.textContent = params[key];
      });
    };

    bindRange('#dt',      'dt',      '#dtVal');
    bindRange('#vmax',    'v_max',   '#vmaxVal');
    bindRange('#amax',    'a_max',   '#amaxVal');
    bindRange('#vpref',   'v_pref',  '#vprefVal');
    bindRange('#tmatch',  'tau_match','#tmatchVal');
    bindRange('#tcenter', 'tau_center','#tcenterVal');
    bindRange('#tsep',    'tau_sep', '#tsepVal');
    bindRange('#gamma',   'gamma',   '#gammaVal');
    bindRange('#r',       'r',       '#rVal');
    bindRange('#rsep',    'r_sep',   '#rsepVal');
    bindRange('#fov',     'fovDeg',  '#fovVal');
    const neighborModeSel = q('#neighborMode');
    neighborModeSel.addEventListener('change', ()=>{
      params.neighborMode = neighborModeSel.value;
    });
    const ktopo = q('#ktopo');
    const ktopoSpan = q('#ktopoVal');
    ktopo.addEventListener('input', ()=>{
      params.kTopo = parseInt(ktopo.value,10);
      ktopoSpan.textContent = params.kTopo;
    });

    const traceBtn = container.querySelector('#traceBtn');
    traceBtn.addEventListener('click', ()=>{
      params.tracing = !params.tracing;
      traceBtn.textContent = params.tracing ? 'Tracing ON' : 'Tracing OFF';
    });

    const fovBtn = container.querySelector('#fovBtn');
    fovBtn.addEventListener('click', ()=>{
      params.showFov = !params.showFov;
      fovBtn.textContent = params.showFov ? 'Show FOV ON' : 'Show FOV OFF';
    });
  }

  return { params, updateBoidCount, updateParams, createControls };
}
