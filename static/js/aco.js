export function initAnts(canvas, options = {}) {
  const ctx = canvas.getContext("2d");
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;

  // Псевдослучайный генератор для воспроизводимости
  class PRNG {
    constructor(seed = 42) {
      this.seed = seed;
    }
    
    random() {
      this.seed = (this.seed * 9301 + 49297) % 233280;
      return this.seed / 233280;
    }
  }

  // Состояние симуляции
  let isPaused = false;
  let running = false;
  let timer = null;
  let animationId = null;
  let isAnimationRunning = false;

  // Параметры ACO алгоритма
  const params = {
    // Основные параметры ACO
    nodeCount: options.nodeCount ?? 10,
    alpha: options.alpha ?? 1.0,              // влияние феромона
    beta: options.beta ?? 2.0,                // влияние эвристики
    rho: options.rho ?? 0.5,                  // коэффициент испарения (0, 1]
    Q: options.Q ?? 1.0,                      // интенсивность подкрепления (> 0)
    colonySize: options.colonySize ?? 10,     // численность колонии m
    maxIterations: options.maxIterations ?? 100, // бюджет итераций T
    tau0: options.tau0 ?? 1.0,                // начальная концентрация феромона (> 0)
    graphType: options.graphType ?? 'undirected', // тип графа
    startDist: options.startDist ?? 'uniform', // распределение стартовых вершин
    seed: options.seed ?? 42,                 // инициализация ГПСЧ
    
    // Технические параметры
    speed: options.speed ?? 1000,             // интервал в мс
    visualizationMode: options.visualizationMode ?? 'pheromones', // 'pheromones' | 'heuristic' | 'off'
    isPreview: options.isPreview ?? false
  };

  // Состояние алгоритма
  let nodes = [];
  let pheromones = [];
  let distances = [];
  let startNode = 0;  // Начальная точка
  let endNode = 1;    // Конечная точка
  let bestPath = null;
  let bestLength = Infinity;
  let currentBestPath = null;
  let currentBestLength = Infinity;
  let iteration = 0;
  let prng = new PRNG(params.seed);

  // Предрендеренные LaTeX формулы
  let tooltipElements = {};

  // Вспомогательные функции
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function generateRandomSeed() {
    return Math.floor(Math.random() * 10000);
  }

  function generateGraph() {
    // Инициализируем PRNG
    prng = new PRNG(params.seed);
    
    nodes = [];
    const margin = 50;
    
    // Генерируем случайные позиции узлов
    for (let i = 0; i < params.nodeCount; i++) {
      nodes.push({
        x: prng.random() * (canvas.width - 2 * margin) + margin,
        y: prng.random() * (canvas.height - 2 * margin) + margin
      });
    }

    // Находим самые удаленные узлы для старта и финиша
    let maxDistance = 0;
    for (let i = 0; i < params.nodeCount; i++) {
      for (let j = i + 1; j < params.nodeCount; j++) {
        const d = dist(nodes[i], nodes[j]);
        if (d > maxDistance) {
          maxDistance = d;
          startNode = i;
          endNode = j;
        }
      }
    }

    // Инициализируем матрицы расстояний и феромонов
    distances = Array.from({ length: params.nodeCount }, () => Array(params.nodeCount).fill(0));
    pheromones = Array.from({ length: params.nodeCount }, () => Array(params.nodeCount).fill(params.tau0));

    for (let i = 0; i < params.nodeCount; i++) {
      for (let j = 0; j < params.nodeCount; j++) {
        if (i !== j) {
          const d = dist(nodes[i], nodes[j]);
          distances[i][j] = d;
          
          // Для ориентированного графа феромоны могут быть асимметричными
          if (params.graphType === 'undirected') {
            distances[j][i] = d;
            pheromones[j][i] = params.tau0;
          }
        }
      }
    }

    // Сброс результатов
    bestPath = null;
    bestLength = Infinity;
    currentBestPath = null;
    currentBestLength = Infinity;
    iteration = 0;
  }

  function drawArrow(fromX, fromY, toX, toY, color, lineWidth) {
    const angle = Math.atan2(toY - fromY, toX - fromX);
    const length = Math.hypot(toX - fromX, toY - fromY);
    
    // Укорачиваем линию чтобы стрелка не перекрывала узлы
    const nodeRadius = 8;
    const adjustedLength = length - 2 * nodeRadius;
    const adjustedToX = fromX + Math.cos(angle) * (length - nodeRadius);
    const adjustedToY = fromY + Math.sin(angle) * (length - nodeRadius);
    const adjustedFromX = fromX + Math.cos(angle) * nodeRadius;
    const adjustedFromY = fromY + Math.sin(angle) * nodeRadius;
    
    // Рисуем линию
    ctx.beginPath();
    ctx.moveTo(adjustedFromX, adjustedFromY);
    ctx.lineTo(adjustedToX, adjustedToY);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
    
    // Рисуем стрелку
    const arrowLength = 10;
    const arrowAngle = Math.PI / 6; // 30 градусов
    
    ctx.beginPath();
    ctx.moveTo(adjustedToX, adjustedToY);
    ctx.lineTo(
      adjustedToX - arrowLength * Math.cos(angle - arrowAngle),
      adjustedToY - arrowLength * Math.sin(angle - arrowAngle)
    );
    ctx.moveTo(adjustedToX, adjustedToY);
    ctx.lineTo(
      adjustedToX - arrowLength * Math.cos(angle + arrowAngle),
      adjustedToY - arrowLength * Math.sin(angle + arrowAngle)
    );
    ctx.stroke();
  }

  function drawPathWithDirection(path, color, lineWidth, dashed = false) {
    if (!path || path.length < 2) return;
    
    ctx.save();
    if (dashed) {
      ctx.setLineDash([10, 6]);
    } else {
      ctx.setLineDash([]);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    
    // Рисуем направленные рёбра пути
    for (let k = 0; k < path.length - 1; k++) {
      const from = path[k];
      const to = path[k + 1];
      
      if (params.graphType === 'directed') {
        drawArrow(nodes[from].x, nodes[from].y, nodes[to].x, nodes[to].y, color, lineWidth);
      } else {
        ctx.beginPath();
        ctx.moveTo(nodes[from].x, nodes[from].y);
        ctx.lineTo(nodes[to].x, nodes[to].y);
        ctx.stroke();
      }
    }
    
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Рисуем рёбра в зависимости от режима визуализации
    if (params.visualizationMode === 'pheromones') {
      // Визуализация феромонов
      const maxPheromone = Math.max(...pheromones.flat());
      const minPheromone = Math.min(...pheromones.flat());
      const pheromoneRange = maxPheromone - minPheromone;

      for (let i = 0; i < params.nodeCount; i++) {
        for (let j = 0; j < params.nodeCount; j++) {
          if (i !== j) {
            const pheromone = pheromones[i][j];
            const intensity = pheromoneRange > 0 ? 
              (pheromone - minPheromone) / pheromoneRange : 0.1;
            
            const color = `rgba(255, 100, 100, ${0.1 + intensity * 0.6})`; // Красноватый для феромонов
            const lineWidth = 1 + intensity * 4;
            
            if (params.graphType === 'directed') {
              drawArrow(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y, color, lineWidth);
            } else if (i < j) { // Для неориентированного графа рисуем только один раз
              ctx.beginPath();
              ctx.moveTo(nodes[i].x, nodes[i].y);
              ctx.lineTo(nodes[j].x, nodes[j].y);
              ctx.strokeStyle = color;
              ctx.lineWidth = lineWidth;
              ctx.stroke();
            }
          }
        }
      }
    } else if (params.visualizationMode === 'heuristic') {
      // Визуализация эвристики (обратно пропорциональна расстоянию)
      const maxDistance = Math.max(...distances.flat());
      const minDistance = Math.min(...distances.flat().filter(d => d > 0));
      const distanceRange = maxDistance - minDistance;

      for (let i = 0; i < params.nodeCount; i++) {
        for (let j = 0; j < params.nodeCount; j++) {
          if (i !== j) {
            const distance = distances[i][j];
            const heuristic = 1 / distance; // η = 1/d
            const maxHeuristic = 1 / minDistance;
            const minHeuristic = 1 / maxDistance;
            const heuristicRange = maxHeuristic - minHeuristic;
            
            const intensity = heuristicRange > 0 ? 
              (heuristic - minHeuristic) / heuristicRange : 0.1;
            
            const color = `rgba(100, 100, 255, ${0.1 + intensity * 0.6})`; // Синеватый для эвристики
            const lineWidth = 1 + intensity * 4;
            
            if (params.graphType === 'directed') {
              drawArrow(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y, color, lineWidth);
            } else if (i < j) {
              ctx.beginPath();
              ctx.moveTo(nodes[i].x, nodes[i].y);
              ctx.lineTo(nodes[j].x, nodes[j].y);
              ctx.strokeStyle = color;
              ctx.lineWidth = lineWidth;
              ctx.stroke();
            }
          }
        }
      }
    } else if (params.visualizationMode === 'off') {
      // Только слабые связи для контекста
      for (let i = 0; i < params.nodeCount; i++) {
        for (let j = 0; j < params.nodeCount; j++) {
          if (i !== j) {
            const color = "rgba(255,255,255,0.05)";
            const lineWidth = 1;
            
            if (params.graphType === 'directed') {
              drawArrow(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y, color, lineWidth);
            } else if (i < j) {
              ctx.beginPath();
              ctx.moveTo(nodes[i].x, nodes[i].y);
              ctx.lineTo(nodes[j].x, nodes[j].y);
              ctx.strokeStyle = color;
              ctx.lineWidth = lineWidth;
              ctx.stroke();
            }
          }
        }
      }
    }

    // Рисуем текущий лучший путь (штриховая линия)
    if (currentBestPath && currentBestPath.length > 1) {
      drawPathWithDirection(currentBestPath, "#f0c674", 3, true);
    }

    // Рисуем глобально лучший путь (сплошная линия)
    if (bestPath && bestPath.length > 1) {
      drawPathWithDirection(bestPath, "#3ddc84", 4, false);
    }

    // Рисуем узлы
    for (let i = 0; i < params.nodeCount; i++) {
      ctx.beginPath();
      ctx.arc(nodes[i].x, nodes[i].y, 8, 0, 2 * Math.PI);
      
      // Определяем цвет узла
      if (i === startNode) {
        ctx.fillStyle = "#4ade80"; // зелёный для начальной точки
      } else if (i === endNode) {
        ctx.fillStyle = "#f87171"; // красный для конечной точки
      } else {
        ctx.fillStyle = "#e5e7eb"; // серый для обычных узлов
      }
      
      ctx.fill();
      ctx.strokeStyle = "#374151";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Подписываем узлы
      ctx.fillStyle = "#1f2937";
      ctx.font = "12px Arial";
      ctx.textAlign = "center";
      ctx.fillText(i.toString(), nodes[i].x, nodes[i].y + 4);
    }

    // Добавляем подписи для начальной и конечной точек
    ctx.fillStyle = "#ffffff";
    ctx.font = "10px Arial";
    ctx.textAlign = "center";
    
    // Подпись "СТАРТ"
    ctx.fillText("СТАРТ", nodes[startNode].x, nodes[startNode].y - 15);
    
    // Подпись "ФИНИШ"
    ctx.fillText("ФИНИШ", nodes[endNode].x, nodes[endNode].y - 15);
  }

  function constructPath(fromNode) {
    const path = [fromNode];
    const visited = new Set([fromNode]);
    let current = fromNode;

    // Строим путь от начального узла к конечному
    while (current !== endNode && visited.size < params.nodeCount) {
      const probabilities = [];
      let totalProbability = 0;

      // Вычисляем вероятности перехода к непосещённым узлам
      for (let j = 0; j < params.nodeCount; j++) {
        if (!visited.has(j)) {
          const tau = Math.pow(Math.max(pheromones[current][j], 1e-10), params.alpha);
          const eta = Math.pow(1 / Math.max(distances[current][j], 1e-10), params.beta);
          const probability = tau * eta;
          
          if (isFinite(probability) && probability > 0) {
            probabilities.push({ node: j, probability });
            totalProbability += probability;
          }
        }
      }

      if (probabilities.length === 0) break;

      // Выбираем следующий узел методом рулетки
      const random = prng.random() * totalProbability;
      let accumulated = 0;
      let chosen = null;

      for (const option of probabilities) {
        accumulated += option.probability;
        if (random <= accumulated) {
          chosen = option.node;
          break;
        }
      }

      if (chosen === null) chosen = probabilities[probabilities.length - 1].node;

      path.push(chosen);
      visited.add(chosen);
      current = chosen;
    }

    return path;
  }

  function calculatePathLength(path) {
    if (path.length < 2) return Infinity;
    
    let length = 0;
    for (let i = 0; i < path.length - 1; i++) {
      length += distances[path[i]][path[i + 1]];
    }
    
    return length;
  }

  function getStartingNode() {
    if (params.startDist === 'uniform') {
      // Равномерное распределение по всем узлам
      return Math.floor(prng.random() * params.nodeCount);
    } else {
      // Фиксированный старт из начальной точки
      return startNode;
    }
  }

  function step() {
    if (iteration >= params.maxIterations) {
      const startBtn = document.getElementById('startBtn');
      if (startBtn) startBtn.textContent = 'Старт';
      pause();
      return;
    }

    const paths = [];
    const pathLengths = [];
    
    // Генерируем пути для всех муравьёв в колонии
    for (let ant = 0; ant < params.colonySize; ant++) {
      const startingNode = getStartingNode();
      const path = constructPath(startingNode);
      const pathLength = calculatePathLength(path);
      
      paths.push(path);
      pathLengths.push(pathLength);
    }

    // Находим лучший путь в текущей итерации (только среди тех, что достигли цели)
    let iterationBestIdx = -1;
    let iterationBestLength = Infinity;
    
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const length = pathLengths[i];
      
      // Проверяем, достиг ли путь конечной точки
      if (path[path.length - 1] === endNode && length < iterationBestLength) {
        iterationBestLength = length;
        iterationBestIdx = i;
      }
    }

    if (iterationBestIdx !== -1) {
      currentBestPath = paths[iterationBestIdx];
      currentBestLength = iterationBestLength;

      // Обновляем глобально лучший путь
      if (iterationBestLength < bestLength) {
        bestLength = iterationBestLength;
        bestPath = paths[iterationBestIdx].slice();
      }
    }

    // Испарение феромонов
    for (let i = 0; i < params.nodeCount; i++) {
      for (let j = 0; j < params.nodeCount; j++) {
        pheromones[i][j] *= (1 - params.rho);
        if (pheromones[i][j] < 1e-10) {
          pheromones[i][j] = 1e-10;
        }
      }
    }

    // Откладывание феромонов муравьями, достигшими цели
    for (let ant = 0; ant < params.colonySize; ant++) {
      const path = paths[ant];
      const pathLength = pathLengths[ant];
      
      // Откладываем феромон только если муравей достиг конечной точки
      if (path[path.length - 1] === endNode && pathLength < Infinity && pathLength > 0) {
        const deltaTau = params.Q / pathLength;
        
        // Обновляем феромоны на рёбрах пути
        for (let i = 0; i < path.length - 1; i++) {
          const from = path[i];
          const to = path[i + 1];
          pheromones[from][to] += deltaTau;
          
          if (params.graphType === 'undirected') {
            pheromones[to][from] += deltaTau;
          }
        }
      }
    }

    iteration++;
    draw();
    updateInfo();
  }

  function start() {
    if (!running) {
      running = true;
      isPaused = false;
      timer = setInterval(step, params.speed);
      
      const startBtn = document.getElementById('startBtn');
      if (startBtn) startBtn.textContent = 'Пауза';
    }
  }

  function pause() {
    running = false;
    isPaused = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    
    const startBtn = document.getElementById('startBtn');
    if (startBtn) startBtn.textContent = 'Старт';
  }

  function reset() {
    pause();
    generateGraph();
    draw();
    updateInfo();
  }

  function newGraph() {
    pause();
    // Генерируем новый случайный сид
    const newSeed = generateRandomSeed();
    params.seed = newSeed;
    
    // Обновляем поле сида в интерфейсе
    const seedInput = document.getElementById('seed');
    const seedVal = document.getElementById('seedVal');
    if (seedInput) seedInput.value = newSeed;
    if (seedVal) seedVal.textContent = newSeed;
    
    generateGraph();
    draw();
    updateInfo();
  }

  function updateNodeCount(n) {
    params.nodeCount = n;
    generateGraph();
    draw();
    updateInfo();
  }

  function updateParams(newParams) {
    Object.assign(params, newParams);
    
    if (newParams.nodeCount !== undefined) {
      updateNodeCount(newParams.nodeCount);
      return;
    }
    
    if (newParams.seed !== undefined) {
      generateGraph();
      draw();
      updateInfo();
      return;
    }
    
    if (newParams.tau0 !== undefined) {
      // Перегенерируем матрицу феромонов с новым начальным значением
      for (let i = 0; i < params.nodeCount; i++) {
        for (let j = 0; j < params.nodeCount; j++) {
          if (i !== j) {
            pheromones[i][j] = params.tau0;
          }
        }
      }
      draw();
    }
    
    if (newParams.speed !== undefined && running) {
      pause();
      start();
    }
  }

  function updateInfo() {
    const iterationEl = document.getElementById('iterationCount');
    const bestLengthEl = document.getElementById('bestPathLength');
    const currentLengthEl = document.getElementById('currentPathLength');
    
    if (iterationEl) iterationEl.textContent = iteration;
    if (bestLengthEl) {
      bestLengthEl.textContent = bestLength < Infinity ? bestLength.toFixed(1) : "–";
    }
    if (currentLengthEl) {
      currentLengthEl.textContent = currentBestLength < Infinity ? currentBestLength.toFixed(1) : "–";
    }
  }

  function drawStaticFrame() {
    draw();
  }

  function createUI() {
    if (params.isPreview) {
      setTimeout(() => {
        drawStaticFrame();
      }, 10);
      
      return { 
        params, 
        updateNodeCount, 
        updateParams, 
        start, 
        pause,
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

    // Кнопка старт/пауза
    const startBtn = document.getElementById('startBtn');
    startBtn.addEventListener('click', () => {
      if (running) {
        pause();
      } else {
        start();
      }
    });

    // Кнопки управления
    const newGraphBtn = document.getElementById('newGraphBtn');
    const stepBtn = document.getElementById('stepBtn');

    newGraphBtn.addEventListener('click', newGraph);
    stepBtn.addEventListener('click', step);

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

    // Кнопка типа графа
    const graphTypeBtn = document.getElementById('graphTypeBtn');
    if (graphTypeBtn) {
      graphTypeBtn.addEventListener('click', () => {
        params.graphType = params.graphType === 'undirected' ? 'directed' : 'undirected';
        graphTypeBtn.textContent = params.graphType === 'undirected' ? 'неориентированный' : 'ориентированный';
        generateGraph();
        draw();
        updateInfo();
      });
    }

    // Кнопка стартового распределения
    const startDistBtn = document.getElementById('startDistBtn');
    if (startDistBtn) {
      startDistBtn.addEventListener('click', () => {
        params.startDist = params.startDist === 'uniform' ? 'fixed' : 'uniform';
        startDistBtn.textContent = params.startDist === 'uniform' ? 'равномерное' : 'фиксированное';
      });
    }

    // Кнопка визуализации с тремя режимами
    const visualBtn = document.getElementById('visualBtn');
    if (visualBtn) {
      visualBtn.addEventListener('click', () => {
        if (params.visualizationMode === 'pheromones') {
          params.visualizationMode = 'heuristic';
          visualBtn.textContent = 'эвристика';
        } else if (params.visualizationMode === 'heuristic') {
          params.visualizationMode = 'off';
          visualBtn.textContent = 'выкл';
        } else {
          params.visualizationMode = 'pheromones';
          visualBtn.textContent = 'феромоны';
        }
        draw();
      });
      
      // Устанавливаем начальный текст кнопки
      visualBtn.textContent = 'феромоны';
    }

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
          if (['nodeCount', 'colonySize', 'maxIterations', 'seed'].includes(id)) {
            valueDisplay.textContent = Math.round(value).toString();
          } else if (id === 'speed') {
            valueDisplay.textContent = value + ' мс';
          } else {
            valueDisplay.textContent = value.toFixed(2);
          }
        }
      });
    }

    // Функция для привязки числовых полей
    function bindNumberInput(id, callback) {
      const input = document.getElementById(id);
      const valueDisplay = document.getElementById(id + 'Val');
      
      if (!input) return;
      
      input.addEventListener('input', () => {
        const value = parseInt(input.value);
        callback(value);
        
        if (valueDisplay) {
          valueDisplay.textContent = value.toString();
        }
      });
    }

    // Привязка всех элементов управления
    bindSlider('nodeCount', (v) => updateNodeCount(parseInt(v)));
    bindSlider('speed', (v) => updateParams({ speed: parseInt(v) }));
    bindSlider('alpha', (v) => updateParams({ alpha: v }));
    bindSlider('beta', (v) => updateParams({ beta: v }));
    bindSlider('rho', (v) => updateParams({ rho: v }));
    bindSlider('Q', (v) => updateParams({ Q: v }));
    bindSlider('colonySize', (v) => updateParams({ colonySize: parseInt(v) }));
    bindSlider('maxIterations', (v) => updateParams({ maxIterations: parseInt(v) }));
    bindSlider('tau0', (v) => updateParams({ tau0: v }));
    bindNumberInput('seed', (v) => updateParams({ seed: v }));

    // Инициализация
    generateGraph();
    draw();
    updateInfo();
  }

  async function initTooltips() {
    const tooltipData = {
      'alpha': {
        title: 'Влияние феромона $\\alpha$',
        description: 'Степень использования накопленного опыта в правиле выбора $p_{ij}^k(t) \\propto [\\tau_{ij}(t)]^{\\alpha}[\\eta_{ij}]^{\\beta}$. Увеличение $\\alpha$ усиливает детерминированность переходов к рёбрам с большими $\\tau$, сокращая исследование.'
      },
      'beta': {
        title: 'Влияние эвристики $\\beta$',
        description: 'Степень учёта априорной «желательности» $\\eta_{ij}$ в $p_{ij}^k(t)$. При $\\beta \\to 0$ эвристика игнорируется. При больших $\\beta$ выбор доминирует кратчайшими/наиболее выгодными локальными шагами.'
      },
      'rho': {
        title: 'Коэффициент испарения $\\rho \\in (0,1]$',
        description: 'Мера «забывания» в динамике $\\tau_{ij}(t+1) = (1-\\rho)\\tau_{ij}(t) + \\sum_k \\Delta\\tau_{ij}^k(t)$. Большие $\\rho$ укорачивают память колонии и повышают адаптивность, а малые $\\rho$ закрепляют найденные траектории.'
      },
      'Q': {
        title: 'Интенсивность подкрепления $Q$',
        description: 'Масштаб откладываемого феромона $\\Delta\\tau_{ij}^k(t) = Q/L_k(t)$ на рёбрах решения. Линейно усиливает контраст между хорошими и плохими решениями. Влияет на скорость самоусиления доминирующих путей.'
      },
      'm': {
        title: 'Численность колонии $m$',
        description: 'Количество независимых агентов. Увеличение снижает дисперсию оценки и ускоряет обнаружение качественных маршрутов при линейных вычислительных затратах.'
      },
      'T': {
        title: 'Бюджет итераций $T$',
        description: 'Число глобальных циклов «решение–обновление». Прямо ограничивает время работы и глубину стабилизации распределения $\\tau$.'
      },
      'tau0': {
        title: 'Начальная концентрация феромона $\\tau_0$',
        description: 'Инициализационное значение $\\tau_{ij}(0) = \\tau_0$ на всех рёбрах (дугах). Большие значения $\\tau_0$ делают стартовое поведение ближе к равномерному, а малые усиливают роль $\\eta$ на ранних шагах.'
      },
      'graphType': {
        title: 'Тип графа (неориентированный/ориентированный)',
        description: 'Определяет симметрию феромонов: для неориентированного случая $\\tau_{ij} = \\tau_{ji}$ и $w_{ij} = w_{ji}$, для орграфа — независимые $\\tau_{ij}$ и $\\tau_{ji}$. Влияет на множество допустимых переходов и на нормировку $p_{ij}^k(t)$.'
      },
      'startDist': {
        title: 'Распределение стартовых вершин',
        description: 'Закон выбора начальной вершины $i_0$ для каждого муравья: равномерно по $V$ либо по заданному распределению. Контролирует охват пространства решений на ранних итерациях.'
      },
      'seed': {
        title: 'Инициализация ГПСЧ',
        description: 'Фиксация состояния ГПСЧ для воспроизводимости траекторий построения решений и последовательностей обновления $\\tau$. Влияет на конкретную реализацию процесса.'
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

  // Обработчик изменения размера окна
  function handleResize() {
    const newWidth = window.innerWidth;
    const newHeight = window.innerHeight;
    
    if (canvas.width === 0 || canvas.height === 0) {
      canvas.width = newWidth;
      canvas.height = newHeight;
      generateGraph();
      draw();
      return;
    }
    
    // Коэффициенты масштабирования
    const scaleX = newWidth / canvas.width;
    const scaleY = newHeight / canvas.height;
    
    // Масштабируем позиции узлов
    nodes.forEach(node => {
      node.x *= scaleX;
      node.y *= scaleY;
    });
    
    // Обновляем размер канваса
    canvas.width = newWidth;
    canvas.height = newHeight;
    
    // Перерисовываем
    draw();
  }
  
  // Привязываем обработчик изменения размера
  window.addEventListener('resize', handleResize);

  return { 
    params, 
    updateNodeCount, 
    updateParams, 
    createUI,
    start,
    pause,
    step,
    reset,
    drawStaticFrame,
    handleResize
  };
}
