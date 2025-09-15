export function initVicsek(canvas, options = {}) {
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
  let animationId = null;
  let isAnimationRunning = false;

  // Предрендеренные LaTeX формулы
  let tooltipElements = {};

  // Псевдослучайный генератор для воспроизводимости
  class PRNG {
    constructor(seed = 42) {
      this.seed = seed;
    }
    
    random() {
      this.seed = (this.seed * 9301 + 49297) % 233280;
      return this.seed / 233280;
    }
    
    uniform(min, max) {
      return min + (max - min) * this.random();
    }
  }

  // Параметры модели Вичека
  const params = {
    // Основные параметры
    particleCount: options.particleCount ?? 300,
    // Убираем boxSize - теперь используем размеры канваса
    interactionRadius: options.interactionRadius ?? 5,
    noiseAmplitude: options.noiseAmplitude ?? 0.5,
    speed: options.speed ?? 1.0,
    timeStep: options.timeStep ?? 1.0,
    
    // Инициализация
    initHeadings: options.initHeadings ?? 'uniform', // 'uniform' | 'aligned' | 'cone'
    initPositions: options.initPositions ?? 'uniform', // 'uniform' | 'grid'
    
    // Статистика
    burnIn: options.burnIn ?? 200,
    avgWindow: options.avgWindow ?? 100,
    
    // Визуализация
    vizTrails: options.vizTrails ?? 50,
    showTrails: options.showTrails ?? false, // Отключено по умолчанию
    showNeighbors: options.showNeighbors ?? false,
    showVelocities: options.showVelocities ?? false,
    
    // Технические параметры
    rngSeed: options.rngSeed ?? 42,
    isPreview: options.isPreview ?? false
  };

  // Состояние системы
  let particles = [];
  let iteration = 0;
  let phiHistory = []; // История параметра порядка
  let currentPhi = 0;
  let avgPhi = 0;
  let prng = new PRNG(params.rngSeed);

  // Получить текущие размеры области (размеры канваса)
  function getAreaSize() {
    return {
      width: canvas.width,
      height: canvas.height
    };
  }

  // Периодические границы (тор) - теперь используем размеры канваса
  function wrapPosition(pos) {
    const area = getAreaSize();
    return {
      x: ((pos.x % area.width) + area.width) % area.width,
      y: ((pos.y % area.height) + area.height) % area.height
    };
  }

  // Минимальное расстояние на торе
  function toroidalDistance(pos1, pos2) {
    const area = getAreaSize();
    const dx = Math.abs(pos1.x - pos2.x);
    const dy = Math.abs(pos1.y - pos2.y);
    
    const minDx = Math.min(dx, area.width - dx);
    const minDy = Math.min(dy, area.height - dy);
    
    return Math.sqrt(minDx * minDx + minDy * minDy);
  }

  // Минимальное смещение на торе
  function toroidalDisplacement(from, to) {
    const area = getAreaSize();
    let dx = to.x - from.x;
    let dy = to.y - from.y;
    
    // Выбираем кратчайший путь через границы
    if (dx > area.width / 2) dx -= area.width;
    if (dx < -area.width / 2) dx += area.width;
    if (dy > area.height / 2) dy -= area.height;
    if (dy < -area.height / 2) dy += area.height;
    
    return { x: dx, y: dy };
  }

  class Particle {
    constructor(x, y, theta) {
      this.position = { x, y };
      this.theta = theta; // Угол направления в радианах
      this.history = [];
      this.neighbors = [];
    }

    get velocity() {
      return {
        x: params.speed * Math.cos(this.theta),
        y: params.speed * Math.sin(this.theta)
      };
    }

    // Найти соседей в радиусе взаимодействия
    findNeighbors(allParticles) {
      this.neighbors = [];
      for (const other of allParticles) {
        if (other === this) continue;
        
        const distance = toroidalDistance(this.position, other.position);
        if (distance <= params.interactionRadius) {
          this.neighbors.push(other);
        }
      }
    }

    // Обновить направление согласно модели Вичека
    updateDirection() {
      if (this.neighbors.length === 0) {
        // Если нет соседей, добавляем только шум
        const noise = prng.uniform(-params.noiseAmplitude / 2, params.noiseAmplitude / 2);
        this.theta += noise;
        return;
      }

      // Вычисляем среднее направление через векторную сумму
      let sumX = Math.cos(this.theta); // Включаем себя
      let sumY = Math.sin(this.theta);
      
      for (const neighbor of this.neighbors) {
        sumX += Math.cos(neighbor.theta);
        sumY += Math.sin(neighbor.theta);
      }

      // Аргумент векторной суммы
      const averageTheta = Math.atan2(sumY, sumX);
      
      // Добавляем равномерный угловой шум
      const noise = prng.uniform(-params.noiseAmplitude / 2, params.noiseAmplitude / 2);
      
      this.theta = averageTheta + noise;
    }

    // Обновить позицию
    updatePosition() {
      const velocity = this.velocity;
      const displacement = mult(velocity, params.timeStep);
      
      this.position = add(this.position, displacement);
      this.position = wrapPosition(this.position);

      // Обновляем историю для следов
      if (params.showTrails && params.vizTrails > 0) {
        this.history.push({ ...this.position });
        if (this.history.length > params.vizTrails) {
          this.history.shift();
        }
      } else {
        this.history = [];
      }
    }

    draw() {
      // Рисуем след
      if (params.showTrails && this.history.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(100, 150, 255, 0.3)';
        ctx.lineWidth = 1;
        
        ctx.moveTo(this.history[0].x, this.history[0].y);
        for (let i = 1; i < this.history.length; i++) {
          ctx.lineTo(this.history[i].x, this.history[i].y);
        }
        ctx.stroke();
      }

      // Рисуем связи с соседями
      if (params.showNeighbors) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 0.5;
        
        for (const neighbor of this.neighbors) {
          ctx.moveTo(this.position.x, this.position.y);
          ctx.lineTo(neighbor.position.x, neighbor.position.y);
        }
        ctx.stroke();
      }

      // Рисуем частицу как стрелку
      const arrowLength = 8;
      const arrowWidth = 4;
      
      ctx.save();
      ctx.translate(this.position.x, this.position.y);
      ctx.rotate(this.theta);
      
      // Тело стрелки
      ctx.beginPath();
      ctx.moveTo(arrowLength, 0);
      ctx.lineTo(-arrowLength/2, arrowWidth);
      ctx.lineTo(-arrowLength/2, -arrowWidth);
      ctx.closePath();
      
      // Цвет зависит от локальной упорядоченности
      const localOrder = this.neighbors.length > 0 ? 
        mag(this.neighbors.reduce((sum, n) => add(sum, {
          x: Math.cos(n.theta),
          y: Math.sin(n.theta)
        }), { x: 0, y: 0 })) / this.neighbors.length : 0;
      
      const hue = 120 + localOrder * 120; // От красного к зеленому
      ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.5;
      ctx.stroke();
      
      // Рисуем вектор скорости
      if (params.showVelocities) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(arrowLength * 1.5, 0);
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      ctx.restore();
    }
  }

  // Инициализация частиц
  function initializeParticles() {
    particles = [];
    const area = getAreaSize();
    
    for (let i = 0; i < params.particleCount; i++) {
      let x, y, theta;
      
      // Инициализация позиций - используем полные размеры канваса
      if (params.initPositions === 'uniform') {
        x = prng.uniform(0, area.width);
        y = prng.uniform(0, area.height);
      } else if (params.initPositions === 'grid') {
        const gridSize = Math.ceil(Math.sqrt(params.particleCount));
        const cellWidth = area.width / gridSize;
        const cellHeight = area.height / gridSize;
        const row = Math.floor(i / gridSize);
        const col = i % gridSize;
        
        x = (col + 0.5) * cellWidth + prng.uniform(-cellWidth/4, cellWidth/4);
        y = (row + 0.5) * cellHeight + prng.uniform(-cellHeight/4, cellHeight/4);
        
        x = ((x % area.width) + area.width) % area.width;
        y = ((y % area.height) + area.height) % area.height;
      }
      
      // Инициализация направлений
      if (params.initHeadings === 'uniform') {
        theta = prng.uniform(0, 2 * Math.PI);
      } else if (params.initHeadings === 'aligned') {
        theta = 0; // Все в одном направлении
      } else if (params.initHeadings === 'cone') {
        const coneWidth = Math.PI / 4; // 45 градусов
        theta = prng.uniform(-coneWidth/2, coneWidth/2);
      }
      
      particles.push(new Particle(x, y, theta));
    }
    
    iteration = 0;
    phiHistory = [];
    currentPhi = 0;
    avgPhi = 0;
  }

  // Вычисление параметра порядка
  function calculateOrderParameter() {
    if (particles.length === 0) return 0;
    
    let sumX = 0, sumY = 0;
    for (const particle of particles) {
      const velocity = particle.velocity;
      sumX += velocity.x;
      sumY += velocity.y;
    }
    
    const totalSpeed = particles.length * params.speed;
    return Math.sqrt(sumX * sumX + sumY * sumY) / totalSpeed;
  }

  // Обновление статистики
  function updateStatistics() {
    currentPhi = calculateOrderParameter();
    phiHistory.push(currentPhi);
    
    // Вычисляем среднее по окну после разогрева
    if (iteration >= params.burnIn) {
      const startIdx = Math.max(0, phiHistory.length - params.avgWindow);
      const relevantHistory = phiHistory.slice(startIdx);
      avgPhi = relevantHistory.reduce((sum, phi) => sum + phi, 0) / relevantHistory.length;
    }
  }

  // Один шаг симуляции
  function step() {
    if (isPaused || !isAnimationRunning) return;

    // Фаза 1: Найти соседей для всех частиц
    for (const particle of particles) {
      particle.findNeighbors(particles);
    }

    // Фаза 2: Обновить направления (синхронно)
    for (const particle of particles) {
      particle.updateDirection();
    }

    // Фаза 3: Обновить позиции
    for (const particle of particles) {
      particle.updatePosition();
    }

    iteration++;
    updateStatistics();
    updateUIMetrics();
  }

  // Отрисовка
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Рисуем все частицы
    for (const particle of particles) {
      particle.draw();
    }
  }

  // Обновление метрик в UI
  function updateUIMetrics() {
    const iterationEl = document.getElementById('iterationCount');
    const currentPhiEl = document.getElementById('currentPhi');
    const avgPhiEl = document.getElementById('avgPhi');

    if (iterationEl) iterationEl.textContent = iteration;
    if (currentPhiEl) currentPhiEl.textContent = currentPhi.toFixed(4);
    if (avgPhiEl) avgPhiEl.textContent = avgPhi.toFixed(4);
  }

  // Цикл анимации
  function animate() {
    step();
    draw();
    
    if (isAnimationRunning) {
      animationId = requestAnimationFrame(animate);
    }
  }

  // Функции управления анимацией
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
    drawStaticFrame();
  }

  function drawStaticFrame() {
    draw();
  }

  // Обновление параметров
  function updateParams(newParams) {
    Object.assign(params, newParams);
    
    if (newParams.particleCount !== undefined ||
        newParams.rngSeed !== undefined ||
        newParams.initHeadings !== undefined ||
        newParams.initPositions !== undefined) {
      if (newParams.rngSeed !== undefined) {
        prng = new PRNG(params.rngSeed);
      }
      initializeParticles();
    }
  }

  // Обработчик изменения размера канваса
  function handleResize() {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    // При изменении размера переинициализируем частицы
    initializeParticles();
    draw();
  }

  // Инициализация всплывающих подсказок
  async function initTooltips() {
    const tooltipData = {
      'particleCount': {
        title: 'Число частиц $N$',
        description: 'Определяет размер популяции. При фиксированных размерах области и $r$ рост $N$ повышает плотность и, как правило, облегчает возникновение порядка.'
      },
      'interactionRadius': {
        title: 'Радиус взаимодействия $r > 0$',
        description: 'Метрическое соседство $\\mathcal{N}_i^n = \\{j: \\|x_j^n - x_i^n\\| \\leq r\\}$, определяющее локальность выравнивания направлений движения.'
      },
      'noiseAmplitude': {
        title: 'Амплитуда углового шума $\\eta \\geq 0$',
        description: 'Равномерная добавка к углу после усреднения направлений: $\\Delta\\theta_i^n \\sim \\mathcal{U}[-\\eta/2, \\eta/2]$. Увеличение $\\eta$ разрушает коллективный порядок.'
      },
      'speed': {
        title: 'Скорость частиц $v_0 > 0$',
        description: 'Постоянная по модулю скорость движения. Вместе с $\\Delta t$ задаёт безразмерную длину шага $\\nu = v_0 \\Delta t$.'
      },
      'timeStep': {
        title: 'Шаг по времени $\\Delta t > 0$',
        description: 'Дискретизация обновления. В классике зачастую полагается $\\Delta t \\equiv 1$. Управляет величиной $\\nu = v_0 \\Delta t$. Слишком крупный шаг визуально "рвёт" траектории.'
      },
      'initHeadings': {
        title: 'Инициализация направлений $\\theta_i^0$',
        description: 'Варианты: равномерное $[0, 2\\pi)$; выровненное (один общий курс); конусное (узкий конус вокруг заданного курса). Влияет на длину разогрева.'
      },
      'initPositions': {
        title: 'Инициализация позиций $x_i^0$',
        description: 'Варианты: равномерное (равномерно по тору), решётка с шумом. Выбор влияет только на переходный процесс.'
      },
      'burnIn': {
        title: 'Длина разогрева $B$',
        description: 'Число шагов, которые не учитываются в статистике $\\Phi$, чтобы уйти от влияния начальной конфигурации.'
      },
      'avgWindow': {
        title: 'Окно усреднения $M$',
        description: 'Число шагов для оценки среднего параметра порядка $\\langle\\Phi\\rangle$ после разогрева.'
      },
      'vizTrails': {
        title: 'Отрисовка следов',
        description: 'Длина хвоста траектории частиц. Чисто визуальный параметр; на динамику не влияет, облегчает качественную оценку когерентности.'
      },
      'rngSeed': {
        title: 'Зерно генератора',
        description: 'Фиксирует выбор шума и инициализаций для воспроизводимости результатов эксперимента.'
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

  function createUI() {
    if (params.isPreview) {
      setTimeout(() => {
        drawStaticFrame();
      }, 10);
      
      return { 
        params, 
        updateParams, 
        startAnimation, 
        pauseAnimation,
        drawStaticFrame
      };
    }

    // Инициализация всплывающих подсказок
    setTimeout(() => {
      initTooltips();
    }, 1000);

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

    // Кнопка паузы
    const pauseBtn = document.getElementById('pauseBtn');
    pauseBtn.addEventListener('click', () => {
      if (isPaused) {
        startAnimation();
        pauseBtn.textContent = 'Пауза';
      } else {
        pauseAnimation();
        pauseBtn.textContent = 'Старт';
      }
    });

    // Кнопка сброса
    const resetBtn = document.getElementById('resetBtn');
    resetBtn.addEventListener('click', () => {
      initializeParticles();
      updateUIMetrics();
    });

    // Кнопка нового сида
    const newSeedBtn = document.getElementById('newSeedBtn');
    newSeedBtn.addEventListener('click', () => {
      const newSeed = Math.floor(Math.random() * 1000000000);
      params.rngSeed = newSeed;
      document.getElementById('rngSeed').value = newSeed;
      prng = new PRNG(newSeed);
      initializeParticles();
      updateUIMetrics();
    });

    // Визуальные кнопки
    const showTrailsBtn = document.getElementById('showTrailsBtn');
    showTrailsBtn.classList.toggle('active', params.showTrails);
    showTrailsBtn.textContent = params.showTrails ? 'След ВКЛ' : 'След ВЫКЛ';
    showTrailsBtn.addEventListener('click', () => {
      params.showTrails = !params.showTrails;
      showTrailsBtn.classList.toggle('active', params.showTrails);
      showTrailsBtn.textContent = params.showTrails ? 'След ВКЛ' : 'След ВЫКЛ';
    });

    const showNeighborsBtn = document.getElementById('showNeighborsBtn');
    showNeighborsBtn.classList.toggle('active', params.showNeighbors);
    showNeighborsBtn.addEventListener('click', () => {
      params.showNeighbors = !params.showNeighbors;
      showNeighborsBtn.classList.toggle('active', params.showNeighbors);
      showNeighborsBtn.textContent = params.showNeighbors ? 'Соседи ВКЛ' : 'Соседи ВЫКЛ';
    });

    const showVelocitiesBtn = document.getElementById('showVelocitiesBtn');
    showVelocitiesBtn.classList.toggle('active', params.showVelocities);
    showVelocitiesBtn.addEventListener('click', () => {
      params.showVelocities = !params.showVelocities;
      showVelocitiesBtn.classList.toggle('active', params.showVelocities);
      showVelocitiesBtn.textContent = params.showVelocities ? 'Скор ВКЛ' : 'Скор ВЫКЛ';
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

    // Кнопки выбора режимов инициализации
    const initHeadingsBtn = document.getElementById('initHeadingsBtn');
    const headingOptions = ['равномерные', 'выровненные', 'конус'];
    const headingValues = ['uniform', 'aligned', 'cone'];
    let headingIndex = headingValues.indexOf(params.initHeadings);
    initHeadingsBtn.textContent = headingOptions[headingIndex];
    initHeadingsBtn.addEventListener('click', () => {
      headingIndex = (headingIndex + 1) % headingOptions.length;
      params.initHeadings = headingValues[headingIndex];
      initHeadingsBtn.textContent = headingOptions[headingIndex];
      initializeParticles();
      updateUIMetrics();
    });

    const initPositionsBtn = document.getElementById('initPositionsBtn');
    const positionOptions = ['равномерные', 'решётка'];
    const positionValues = ['uniform', 'grid'];
    let positionIndex = positionValues.indexOf(params.initPositions);
    initPositionsBtn.textContent = positionOptions[positionIndex];
    initPositionsBtn.addEventListener('click', () => {
      positionIndex = (positionIndex + 1) % positionOptions.length;
      params.initPositions = positionValues[positionIndex];
      initPositionsBtn.textContent = positionOptions[positionIndex];
      initializeParticles();
      updateUIMetrics();
    });

    // Функция для привязки слайдеров
    function bindSlider(id, callback) {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(id + 'Val');
      
      if (!slider) return;
      
      slider.addEventListener('input', () => {
        const value = parseFloat(slider.value);
        callback(value);
        
        // Обновление отображения значения
        if (valueDisplay) {
          if (['particleCount', 'burnIn', 'avgWindow', 'vizTrails'].includes(id)) {
            valueDisplay.textContent = Math.round(value).toString();
          } else {
            valueDisplay.textContent = value.toFixed(2);
          }
        }
      });
    }

    // Функция для привязки числовых полей
    function bindNumberInput(id, callback) {
      const input = document.getElementById(id);
      
      if (!input) return;
      
      input.addEventListener('input', () => {
        const value = parseInt(input.value);
        callback(value);
      });
    }

    // Привязка всех элементов управления (убираем boxSize)
    bindSlider('particleCount', (v) => updateParams({ particleCount: parseInt(v) }));
    bindSlider('interactionRadius', (v) => updateParams({ interactionRadius: v }));
    bindSlider('noiseAmplitude', (v) => updateParams({ noiseAmplitude: v }));
    bindSlider('speed', (v) => updateParams({ speed: v }));
    bindSlider('timeStep', (v) => updateParams({ timeStep: v }));
    bindSlider('burnIn', (v) => updateParams({ burnIn: parseInt(v) }));
    bindSlider('avgWindow', (v) => updateParams({ avgWindow: parseInt(v) }));
    bindSlider('vizTrails', (v) => updateParams({ vizTrails: parseInt(v) }));
    bindNumberInput('rngSeed', (v) => updateParams({ rngSeed: v }));

    startAnimation();
  }

  // Обработчик изменения размера окна
  window.addEventListener('resize', handleResize);

  // Инициализация
  initializeParticles();

  return { 
    params, 
    updateParams, 
    createUI, 
    startAnimation, 
    pauseAnimation,
    drawStaticFrame
  };
}
