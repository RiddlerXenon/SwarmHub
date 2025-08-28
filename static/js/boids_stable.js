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
    dampMode: options.dampMode ?? 'off',   // 'off' | 'accel'
    gamma: options.gamma ?? 0.0,           // с^-1 в дискретизации через dt

    // восприятие
    r: options.r ?? 60,                    // радиус соседства для match/center (метрическое)
    r_sep: options.r_sep ?? 30,            // ближняя зона separation (изотропная)
    fovDeg: options.fovDeg ?? 135,
    get phi(){ return (this.fovDeg * Math.PI) / 180; },

    // режим выбора соседей для match/center
    neighborMode: options.neighborMode ?? 'metric', // 'metric' | 'topo'
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
    showFov: options.showFov ?? false
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
    if (params.neighborMode === 'metric') {
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
      // отражающие границы
      if (this.X.x < 0) { this.X.x=0; this.V.x*=-1; }
      if (this.X.x > canvas.width) { this.X.x=canvas.width; this.V.x*=-1; }
      if (this.X.y < 0) { this.X.y=0; this.V.y*=-1; }
      if (this.X.y > canvas.height){ this.X.y=canvas.height; this.V.y*=-1; }
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
        // сектор обзора для match/center
        const ang = Math.atan2(this.V.y, this.V.x);
        ctx.save();
        ctx.translate(this.X.x, this.X.y);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(0,0);
        ctx.arc(0,0, params.r, -params.phi/2, params.phi/2);
        ctx.closePath();
        ctx.fillStyle = "rgba(0,255,0,0.1)";
        ctx.fill();
        ctx.restore();

        // изотропная ближняя зона separation (полный круг)
        ctx.beginPath();
        ctx.arc(this.X.x, this.X.y, params.r_sep, 0, 2*Math.PI);
        ctx.closePath();
        ctx.fillStyle = "rgba(255,0,0,0.08)";
        ctx.fill();
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
      <div style="background:rgba(0,0,0,0.7);padding:10px;color:#eee;font:12px sans-serif;display:flex;flex-wrap:wrap;gap:10px;justify-content:center;align-items:center;">

        <label>dt:<br><span id="dtVal">${params.dt}</span>
          <input type="range" id="dt" min="0.1" max="2.0" step="0.1" value="${params.dt}" style="width:100px;">
        </label>

        <label>Соседство:<br>
          <select id="neighborMode" style="width:120px;">
            <option value="metric"${params.neighborMode==='metric'?' selected':''}>metric</option>
            <option value="topo"${params.neighborMode==='topo'?' selected':''}>topo</option>
          </select>
        </label>

        <label>k (topo):<br><span id="kTopoVal">${params.kTopo}</span>
          <input type="range" id="kTopo" min="1" max="50" step="1" value="${params.kTopo}" style="width:100px;">
        </label>

        <label>r:<br><span id="rVal">${params.r}</span>
          <input type="range" id="r" min="20" max="150" step="1" value="${params.r}" style="width:100px;">
        </label>

        <label>r_sep:<br><span id="rsepVal">${params.r_sep}</span>
          <input type="range" id="rsep" min="10" max="100" step="1" value="${params.r_sep}" style="width:100px;">
        </label>

        <label>φ (deg):<br><span id="phiVal">${(params.fovDeg).toFixed(0)}°</span>
          <input type="range" id="phi" min="45" max="360" step="1" value="${(params.fovDeg).toFixed(0)}">
        </label>

        <label>Boids:<br><span id="boidCountVal">${params.boidCount}</span>
          <input type="range" id="boidCount" min="20" max="200" value="${params.boidCount}" style="width:100px;">
        </label>

        <label>v_pref:<br><span id="vprefVal">${params.v_pref.toFixed(2)}</span>
          <input type="range" id="vpref" min="0.1" max="6.0" step="0.1" value="${params.v_pref}" style="width:100px;">
        </label>

        <label>v_max:<br><span id="vmaxVal">${params.v_max}</span>
          <input type="range" id="vmax" min="1.0" max="6.0" step="0.1" value="${params.v_max}" style="width:100px;">
        </label>

        <label>a_max:<br><span id="amaxVal">${params.a_max}</span>
          <input type="range" id="amax" min="0.01" max="0.2" step="0.005" value="${params.a_max}" style="width:100px;">
        </label>

        <label>τ_match:<br><span id="taumatchVal">${params.tauMatch.toFixed(2)}</span>
          <input type="range" id="taumatch" min="0.1" max="5.0" step="0.1" value="${params.tauMatch}" style="width:100px;">
        </label>

        <label>τ_center:<br><span id="taucenterVal">${params.tauCenter.toFixed(2)}</span>
          <input type="range" id="taucenter" min="0.1" max="5.0" step="0.1" value="${params.tauCenter}" style="width:100px;">
        </label>

        <label>τ_sep:<br><span id="tausepVal">${params.tauSep.toFixed(2)}</span>
          <input type="range" id="tausep" min="0.1" max="5.0" step="0.1" value="${params.tauSep}" style="width:100px;">
        </label>

        <label>k_sep:<br><span id="ksepVal">${params.k_sep.toFixed(2)}</span>
          <input type="range" id="ksep" min="0.0" max="5.0" step="0.1" value="${params.k_sep}" style="width:100px;">
        </label>

        <label>Вязкое сопротивление:<br>
          <select id="dampMode" style="width:120px;">
            <option value="off"${params.dampMode==='off'?' selected':''}>off</option>
            <option value="accel"${params.dampMode==='accel'?' selected':''}>accel</option>
          </select>
        </label>

        <label>γ:<br><span id="gammaVal">${params.gamma}</span>
          <input type="range" id="gamma" min="0.0" max="0.5" step="0.01" value="${params.gamma}" style="width:100px;">
        </label>

        <label>w_match:<br><span id="wmatchVal">${params.w.match}</span>
          <input type="range" id="wmatch" min="0.0" max="2.0" step="0.1" value="${params.w.match}" style="width:100px;">
        </label>

        <label>w_center:<br><span id="wcenterVal">${params.w.center}</span>
          <input type="range" id="wcenter" min="0.0" max="2.0" step="0.1" value="${params.w.center}" style="width:100px;">
        </label>

        <label>w_sep:<br><span id="wsepVal">${params.w.sep}</span>
          <input type="range" id="wsep" min="0.0" max="3.0" step="0.1" value="${params.w.sep}" style="width:100px;">
        </label>

        <button id="traceBtn" style="padding:5px 10px;background:#222;border:1px solid #555;color:#eee;border-radius:5px;cursor:pointer;">
          Tracing ${params.tracing ? 'ON' : 'OFF'}
        </button>
        <button id="fovBtn" style="padding:5px 10px;background:#222;border:1px solid #555;color:#eee;border-radius:5px;cursor:pointer;">
          Show FOV ${params.showFov ? 'ON' : 'OFF'}
        </button>
      </div>`;
    container.innerHTML = html;

    const setDisabled = (el, disabled)=>{ el.disabled = !!disabled; el.style.opacity = disabled? 0.5 : 1; };

    const bind = (id, setter)=>{
      const s = container.querySelector('#'+id);
      const l = container.querySelector('#'+id+'Val');
      s.addEventListener('input', ()=>{
        const v =
          id==='boidCount' ? parseInt(s.value) :
          id==='phi' ? parseInt(s.value) :
          (id==='neighborMode' ? s.value :
          (id==='kTopo' ? parseInt(s.value) : parseFloat(s.value)));
        setter(v);
        if (l) l.textContent = (id==='phi')? (v+'°') : (Number.isFinite(v) ? v : s.value);
      });
    };

    bind('dt', v=> params.dt = v);
    bind('neighborMode', v=> params.neighborMode = v);
    bind('kTopo', v=> { params.kTopo = v; container.querySelector('#kTopoVal').textContent = v; });
    bind('r', v=> params.r = v);
    bind('boidCount', v=> updateBoidCount(v));
    bind('vpref', v=> { params.v_pref = v; container.querySelector('#vprefVal').textContent = v.toFixed(2); });
    bind('vmax', v=> params.v_max = v);
    bind('amax', v=> params.a_max = v);
    bind('rsep', v=> params.r_sep = v);
    bind('phi', v=> { params.fovDeg = v; container.querySelector('#phiVal').textContent = v+'°'; });
    bind('gamma', v=> { params.gamma = v; container.querySelector('#gammaVal').textContent = v; });
    bind('taumatch', v=> { params.tauMatch = v; container.querySelector('#taumatchVal').textContent = v.toFixed(2); });
    bind('taucenter', v=> { params.tauCenter = v; container.querySelector('#taucenterVal').textContent = v.toFixed(2); });
    bind('tausep', v=> { params.tauSep = v; container.querySelector('#tausepVal').textContent = v.toFixed(2); });
    bind('ksep', v=> { params.k_sep = v; container.querySelector('#ksepVal').textContent = v.toFixed(2); });
    bind('wmatch', v=> params.w.match = v);
    bind('wcenter', v=> params.w.center = v);
    bind('wsep', v=> params.w.sep = v);

    const modeSel = container.querySelector('#dampMode');
    const gammaSlider = container.querySelector('#gamma');
    const updateGammaUI = ()=> setDisabled(gammaSlider, modeSel.value==='off');
    modeSel.addEventListener('change', ()=>{ params.dampMode = modeSel.value; updateGammaUI(); });
    updateGammaUI();

    // UI-связка: r активно только при metric; kTopo активно только при topo
    const neighborSel = container.querySelector('#neighborMode');
    const rSlider = container.querySelector('#r');
    const kTopoSlider = container.querySelector('#kTopo');
    const syncNeighborUI = ()=>{
      const metric = neighborSel.value==='metric';
      setDisabled(rSlider, !metric);
      setDisabled(kTopoSlider, metric);
    };
    neighborSel.addEventListener('change', syncNeighborUI);
    syncNeighborUI();

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
