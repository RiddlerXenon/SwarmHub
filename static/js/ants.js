export function initAnts(canvas, options = {}) {
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let params = {
        nodeCount: options.nodeCount || 10,
        alpha: options.alpha || 1.0,      // влияние феромона
        beta: options.beta || 2.0,        // влияние расстояния
        rho: options.rho || 0.5,          // испарение
        autoRun: options.autoRun || false,
        speed: options.speed || 1000      // интервал в мс
    };

    let nodes = [];
    let pheromones = [];
    let distances = [];
    let startNode = 0;
    let endNode = 1;
    let bestPath = null;
    let bestLength = Infinity;
    let currentPath = null;
    let iteration = 0;
    let running = false;
    let timer = null;

    // Вспомогательные функции
    function dist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function generateGraph() {
        nodes = [];
        const margin = 30;
        
        // Генерируем случайные позиции узлов
        for (let i = 0; i < params.nodeCount; i++) {
            nodes.push({
                x: Math.random() * (canvas.width - 2 * margin) + margin,
                y: Math.random() * (canvas.height - 2 * margin) + margin
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
        pheromones = Array.from({ length: params.nodeCount }, () => Array(params.nodeCount).fill(1));

        for (let i = 0; i < params.nodeCount; i++) {
            for (let j = i + 1; j < params.nodeCount; j++) {
                const d = dist(nodes[i], nodes[j]);
                distances[i][j] = distances[j][i] = d;
            }
        }

        // Сброс результатов
        bestPath = null;
        bestLength = Infinity;
        currentPath = null;
        iteration = 0;
    }

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Рисуем все возможные рёбра слабым светом
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        
        for (let i = 0; i < params.nodeCount; i++) {
            for (let j = i + 1; j < params.nodeCount; j++) {
                ctx.beginPath();
                ctx.moveTo(nodes[i].x, nodes[i].y);
                ctx.lineTo(nodes[j].x, nodes[j].y);
                ctx.stroke();
            }
        }

        // Рисуем текущий путь (штриховая линия)
        if (currentPath && currentPath.length > 1) {
            ctx.save();
            ctx.lineWidth = 3;
            ctx.setLineDash([10, 6]);
            ctx.strokeStyle = "#f0c674"; // янтарный
            ctx.beginPath();
            ctx.moveTo(nodes[currentPath[0]].x, nodes[currentPath[0]].y);
            for (let k = 1; k < currentPath.length; k++) {
                ctx.lineTo(nodes[currentPath[k]].x, nodes[currentPath[k]].y);
            }
            ctx.stroke();
            ctx.restore();
        }

        // Рисуем лучший путь (сплошная линия)
        if (bestPath && bestPath.length > 1) {
            ctx.save();
            ctx.setLineDash([]);
            ctx.strokeStyle = "#3ddc84"; // зелёный
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(nodes[bestPath[0]].x, nodes[bestPath[0]].y);
            for (let k = 1; k < bestPath.length; k++) {
                ctx.lineTo(nodes[bestPath[k]].x, nodes[bestPath[k]].y);
            }
            ctx.stroke();
            ctx.restore();
        }

        // Рисуем узлы
        for (let i = 0; i < params.nodeCount; i++) {
            ctx.beginPath();
            ctx.arc(nodes[i].x, nodes[i].y, 8, 0, 2 * Math.PI);
            
            if (i === startNode) {
                ctx.fillStyle = "#3ddc84"; // зелёный для старта
            } else if (i === endNode) {
                ctx.fillStyle = "#ff6b6b"; // красный для финиша
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
    }

    function step() {
        const path = [startNode];
        const visited = new Set([startNode]);
        let current = startNode;

        // Строим путь от стартового узла к финишному
        while (current !== endNode && visited.size < params.nodeCount) {
            const probabilities = [];
            let totalProbability = 0;

            // Вычисляем вероятности перехода к соседним узлам
            for (let j = 0; j < params.nodeCount; j++) {
                if (!visited.has(j)) {
                    const tau = Math.pow(pheromones[current][j], params.alpha);
                    const eta = Math.pow(1 / (distances[current][j] + 1e-6), params.beta);
                    const probability = tau * eta;
                    
                    if (isFinite(probability) && probability > 0) {
                        probabilities.push({ node: j, probability });
                        totalProbability += probability;
                    }
                }
            }

            if (probabilities.length === 0) break;

            // Выбираем следующий узел методом рулетки
            const random = Math.random() * totalProbability;
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

        // Сохраняем текущий путь для отображения
        currentPath = path.slice();

        // Вычисляем длину пути
        let pathLength = 0;
        for (let i = 0; i < path.length - 1; i++) {
            pathLength += distances[path[i]][path[i + 1]];
        }

        // Обновляем лучший путь, если текущий лучше
        if (current === endNode && pathLength < bestLength) {
            bestLength = pathLength;
            bestPath = path.slice();
        }

        // Испарение феромонов
        for (let i = 0; i < params.nodeCount; i++) {
            for (let j = 0; j < params.nodeCount; j++) {
                pheromones[i][j] *= (1 - params.rho);
                if (pheromones[i][j] < 1e-6) {
                    pheromones[i][j] = 1e-6;
                }
            }
        }

        // Усиление феромонов на пройденном пути
        if (current === endNode) {
            const reinforcement = 1 / Math.max(pathLength, 1e-6);
            for (let i = 0; i < path.length - 1; i++) {
                const a = path[i];
                const b = path[i + 1];
                pheromones[a][b] += reinforcement;
                pheromones[b][a] += reinforcement;
            }
        }

        iteration++;
        draw();
    }

    function start() {
        if (!running) {
            running = true;
            timer = setInterval(step, params.speed);
        }
    }

    function pause() {
        running = false;
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    function reset() {
        pause();
        generateGraph();
        draw();
    }

    function updateParams(newParams) {
        Object.assign(params, newParams);
        
        if (newParams.nodeCount !== undefined) {
            generateGraph();
        }
        
        if (newParams.speed !== undefined && running) {
            pause();
            start();
        }
    }

    function createControls(container) {
        const controlsHTML = `
        <div class="ants-controls" style="background: rgba(0,0,0,0.8); padding: 15px; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 15px; color: #eee; font-family: Arial, sans-serif; font-size: 13px;">
            <label>Узлы:<br>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span id="nodeCountVal">${params.nodeCount}</span>
                    <input type="range" id="nodeCount" min="5" max="25" value="${params.nodeCount}" style="width: 100px;">
                </div>
            </label>
            <label>α (феромон):<br>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span id="alphaVal">${params.alpha}</span>
                    <input type="range" id="alpha" min="0.1" max="5" step="0.1" value="${params.alpha}" style="width: 100px;">
                </div>
            </label>
            <label>β (расстояние):<br>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span id="betaVal">${params.beta}</span>
                    <input type="range" id="beta" min="0.1" max="10" step="0.1" value="${params.beta}" style="width: 100px;">
                </div>
            </label>
            <label>ρ (испарение):<br>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span id="rhoVal">${params.rho}</span>
                    <input type="range" id="rho" min="0.01" max="1" step="0.01" value="${params.rho}" style="width: 100px;">
                </div>
            </label>
            <label>Скорость:<br>
                <div style="display: flex; align-items: center; gap: 5px;">
                    <span id="speedVal">${params.speed}мс</span>
                    <input type="range" id="speed" min="100" max="2000" step="100" value="${params.speed}" style="width: 100px;">
                </div>
            </label>
        </div>
        <div style="flex-basis: 100%; display: flex; justify-content: center; gap: 15px; background: rgba(0,0,0,0.8); padding: 10px;">
            <button id="newGraphBtn" style="padding: 8px 15px; background: #4f46e5; border: none; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">Новый граф</button>
            <button id="startBtn" style="padding: 8px 15px; background: #059669; border: none; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">Старт</button>
            <button id="pauseBtn" style="padding: 8px 15px; background: #dc2626; border: none; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">Пауза</button>
            <button id="stepBtn" style="padding: 8px 15px; background: #7c3aed; border: none; color: white; border-radius: 6px; cursor: pointer; font-weight: bold;">Шаг</button>
        </div>
        <div id="info" style="background: rgba(0,0,0,0.8); padding: 10px; text-align: center; color: #eee; font-family: Arial, sans-serif;">
            Итераций: <span id="iterationCount">0</span> | Лучший путь: <span id="bestPathLength">–</span>
        </div>`;

        container.innerHTML = controlsHTML;

        // Привязываем слайдеры
        function bindSlider(id, key, isInt = false, suffix = "") {
            const slider = container.querySelector(`#${id}`);
            const label = container.querySelector(`#${id}Val`);
            slider.addEventListener("input", () => {
                const value = isInt ? parseInt(slider.value) : parseFloat(slider.value);
                updateParams({ [key]: value });
                if (label) label.textContent = slider.value + suffix;
            });
        }

        bindSlider("nodeCount", "nodeCount", true);
        bindSlider("alpha", "alpha");
        bindSlider("beta", "beta");
        bindSlider("rho", "rho");
        bindSlider("speed", "speed", true, "мс");

        // Привязываем кнопки
        container.querySelector("#newGraphBtn").addEventListener("click", reset);
        container.querySelector("#startBtn").addEventListener("click", start);
        container.querySelector("#pauseBtn").addEventListener("click", pause);
        container.querySelector("#stepBtn").addEventListener("click", step);

        // Функция для обновления информации
        function updateInfo() {
            container.querySelector("#iterationCount").textContent = iteration;
            container.querySelector("#bestPathLength").textContent = 
                bestLength < Infinity ? bestLength.toFixed(1) : "–";
        }

        // Периодически обновляем информацию
        setInterval(updateInfo, 100);
    }

    // Обработчик изменения размера окна
    function handleResize() {
        const newWidth = window.innerWidth;
        const newHeight = window.innerHeight;
        
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

    // Инициализация
    generateGraph();
    draw();

    // Автозапуск, если указан
    if (params.autoRun) {
        start();
    }

    return { 
        params, 
        updateParams, 
        createControls,
        start,
        pause,
        step,
        reset,
        handleResize
    };
}
