package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
)

func main() {
	inputFile := flag.String("input", "", "Путь к LaTeX файлу")
	outputFile := flag.String("output", "output.html", "Путь к выходному HTML файлу")
	title := flag.String("title", "Конвертированный документ", "Заголовок документа")
	flag.Parse()

	if *inputFile == "" {
		log.Fatal("Необходимо указать входной файл")
	}

	latexContent, err := os.ReadFile(*inputFile)
	if err != nil {
		log.Fatalf("Ошибка чтения входного файла: %v", err)
	}

	htmlContent, err := ConvertLatexToHTML(string(latexContent), *title)
	if err != nil {
		log.Fatalf("Ошибка конвертации LaTeX в HTML: %v", err)
	}

	err = os.WriteFile(*outputFile, []byte(htmlContent), 0644)
	if err != nil {
		log.Fatalf("Ошибка записи выходного файла: %v", err)
	}

	fmt.Printf("Конвертация завершена. Результат сохранен в: %s\n", *outputFile)
}

// ConvertLatexToHTML конвертирует LaTeX контент в HTML с поддержкой MathJax
func ConvertLatexToHTML(latex, title string) (string, error) {
	content := extractDocumentContent(latex)

	// Обрабатываем алгоритмы БЕЗ источников
	content = processAlgorithmsAdvanced(content)

	// СНАЧАЛА извлекаем ссылки из всего документа
	references := extractReferences(content)

	// ЗАТЕМ очищаем контент от ссылок
	content = cleanupReferences(content)

	// Обрабатываем формулы с нумерацией
	content = processEquationsWithNumbering(content)

	// Обрабатываем абзацы и команды
	content = processParagraphs(content)
	content = processCommands(content)
	content = cleanupMathSymbols(content)

	html := generateHTML(content, references, title)
	return html, nil
}

// extractDocumentContent извлекает содержимое между \begin{document} и \end{document}
func extractDocumentContent(latex string) string {
	beginDoc := regexp.MustCompile(`\\begin\{document\}`)
	endDoc := regexp.MustCompile(`\\end\{document\}`)

	beginMatch := beginDoc.FindStringIndex(latex)
	endMatch := endDoc.FindStringIndex(latex)

	if beginMatch != nil && endMatch != nil {
		return latex[beginMatch[1]:endMatch[0]]
	}
	return latex
}

// extractReferences извлекает ссылки из документа
func extractReferences(content string) []string {
	var references []string
	lines := strings.Split(content, "\n")

	for i, line := range lines {
		line = strings.TrimSpace(line)

		// Ищем строки, начинающиеся с цифры и точки (источники)
		if matched, _ := regexp.MatchString(`^\d+\.\s+[A-Z]`, line); matched {
			ref := line
			// Собираем многострочную ссылку
			for j := i + 1; j < len(lines); j++ {
				nextLine := strings.TrimSpace(lines[j])
				if nextLine == "" {
					break
				}
				// Если встретили новый источник, останавливаемся
				if matched, _ := regexp.MatchString(`^\d+\.\s+[A-Z]`, nextLine); matched {
					break
				}
				ref += " " + nextLine
			}
			references = append(references, ref)
		}
	}

	return references
}

// cleanupReferences удаляет ссылки из контента
func cleanupReferences(content string) string {
	lines := strings.Split(content, "\n")
	var result []string

	foundFirstReference := false

	for _, line := range lines {
		originalLine := line
		line = strings.TrimSpace(line)

		// Если нашли первый источник, больше ничего не добавляем
		if matched, _ := regexp.MatchString(`^\d+\.\s+[A-Z]`, line); matched && !foundFirstReference {
			foundFirstReference = true
			break
		}

		if !foundFirstReference {
			result = append(result, originalLine)
		}
	}

	return strings.Join(result, "\n")
}

// processAlgorithmsAdvanced обрабатывает алгоритмы с корректной математикой
func processAlgorithmsAdvanced(content string) string {
	algorithmRe := regexp.MustCompile(`(?s)\\begin\{algorithm\}\[H\](.*?)\\end\{algorithm\}`)

	content = algorithmRe.ReplaceAllStringFunc(content, func(match string) string {
		inner := algorithmRe.FindStringSubmatch(match)[1]

		var result []string
		result = append(result, `<div class="algorithm">`)

		lines := strings.Split(inner, "\n")
		indentLevel := 0

		for _, line := range lines {
			line = strings.TrimSpace(line)

			if line == "" {
				continue
			}

			// Пропускаем строки, которые выглядят как источники
			if matched, _ := regexp.MatchString(`^\d+\.\s+[A-Z]`, line); matched {
				continue
			}

			// Обрабатываем заголовок
			if strings.Contains(line, "\\caption") {
				captionRe := regexp.MustCompile(`\\caption\{([^}]+)\}`)
				if matches := captionRe.FindStringSubmatch(line); len(matches) > 1 {
					caption := processInlineMathForAlgorithm(matches[1])
					result = append(result, `<div class="algorithm-title">Алгоритм: `+caption+`</div>`)
				}
				continue
			}

			// Обрабатываем входные параметры
			if strings.Contains(line, "\\KwIn") {
				kwinRe := regexp.MustCompile(`\\KwIn\{([^}]+)\}`)
				if matches := kwinRe.FindStringSubmatch(line); len(matches) > 1 {
					input := processInlineMathForAlgorithm(matches[1])
					result = append(result, `<div class="algorithm-input"><strong>Вход:</strong> `+input+`</div>`)
				}
				continue
			}

			// Обрабатываем выходные параметры
			if strings.Contains(line, "\\KwOut") {
				kwoutRe := regexp.MustCompile(`\\KwOut\{([^}]+)\}`)
				if matches := kwoutRe.FindStringSubmatch(line); len(matches) > 1 {
					output := processInlineMathForAlgorithm(matches[1])
					result = append(result, `<div class="algorithm-output"><strong>Выход:</strong> `+output+`</div>`)
				}
				continue
			}

			// Обрабатываем инициализацию
			if strings.Contains(line, "\\textbf{Init:}") {
				initRe := regexp.MustCompile(`\\textbf\{Init:\}\\quad\s*(.+)`)
				if matches := initRe.FindStringSubmatch(line); len(matches) > 1 {
					init := processAlgorithmComplexLine(matches[1])
					result = append(result, `<div class="algorithm-init"><strong>Инициализация:</strong> `+init+`</div>`)
				}
				continue
			}

			// Обрабатываем циклы For
			if strings.Contains(line, "\\For") {
				forRe := regexp.MustCompile(`\\For\{([^}]+)\}`)
				if matches := forRe.FindStringSubmatch(line); len(matches) > 1 {
					indent := strings.Repeat("&nbsp;&nbsp;&nbsp;&nbsp;", indentLevel)
					condition := processInlineMathForAlgorithm(matches[1])
					result = append(result, `<div class="algorithm-for">`+indent+`<strong>для</strong> `+condition+` <strong>делать</strong></div>`)
					indentLevel++
				}
				continue
			}

			// Обрабатываем циклы While
			if strings.Contains(line, "\\While") {
				whileRe := regexp.MustCompile(`\\While\{([^}]+)\}`)
				if matches := whileRe.FindStringSubmatch(line); len(matches) > 1 {
					indent := strings.Repeat("&nbsp;&nbsp;&nbsp;&nbsp;", indentLevel)
					condition := processAlgorithmComplexLine(matches[1])
					result = append(result, `<div class="algorithm-while">`+indent+`<strong>пока</strong> `+condition+` <strong>делать</strong></div>`)
					indentLevel++
				}
				continue
			}

			// Обрабатываем ForEach
			if strings.Contains(line, "\\ForEach") {
				foreachRe := regexp.MustCompile(`\\ForEach\{([^}]+)\}`)
				if matches := foreachRe.FindStringSubmatch(line); len(matches) > 1 {
					indent := strings.Repeat("&nbsp;&nbsp;&nbsp;&nbsp;", indentLevel)
					condition := processInlineMathForAlgorithm(matches[1])
					result = append(result, `<div class="algorithm-foreach">`+indent+`<strong>для каждого</strong> `+condition+` <strong>делать</strong></div>`)
					indentLevel++
				}
				continue
			}

			// Обрабатываем комментарии
			if strings.Contains(line, "\\tcp") {
				tcpRe := regexp.MustCompile(`\\tcp\{([^}]+)\}`)
				if matches := tcpRe.FindStringSubmatch(line); len(matches) > 1 {
					indent := strings.Repeat("&nbsp;&nbsp;&nbsp;&nbsp;", indentLevel)
					result = append(result, `<div class="algorithm-comment">`+indent+`// `+matches[1]+`</div>`)
				}
				continue
			}

			// Обрабатываем return
			if strings.Contains(line, "\\KwRet") {
				kwretRe := regexp.MustCompile(`\\KwRet\{([^}]+)\}`)
				if matches := kwretRe.FindStringSubmatch(line); len(matches) > 1 {
					indent := strings.Repeat("&nbsp;&nbsp;&nbsp;&nbsp;", indentLevel)
					ret := processInlineMathForAlgorithm(matches[1])
					result = append(result, `<div class="algorithm-return">`+indent+`<strong>вернуть</strong> `+ret+`</div>`)
				}
				continue
			}

			// Закрывающие скобки
			if line == "}" {
				if indentLevel > 0 {
					indentLevel--
				}
				continue
			}

			// Обрабатываем обычные строки кода
			if !strings.HasPrefix(line, "\\begin") && !strings.HasPrefix(line, "\\end") && line != "" {
				processedLine := processAlgorithmComplexLine(line)
				if processedLine != "" {
					indent := strings.Repeat("&nbsp;&nbsp;&nbsp;&nbsp;", indentLevel)
					processedLine = regexp.MustCompile(`\$\$(.+?)\$\$`).ReplaceAllString(processedLine, `<div class="algorithm-math">$$$1$$</div>`)
					processedLine = regexp.MustCompile(`\$(.+?)\$`).ReplaceAllString(processedLine, `<span class="algorithm-math">$$$1$$</span>`)
					result = append(result, `<div class="algorithm-line">`+indent+processedLine+`</div>`)
				}
			}
		}

		result = append(result, `</div>`)
		return strings.Join(result, "\n")
	})

	return content
}

// processInlineMathForAlgorithm обрабатывает inline математику в алгоритмах
func processInlineMathForAlgorithm(text string) string {
	// Очищаем текст
	text = strings.TrimSpace(text)
	text = strings.ReplaceAll(text, "\\quad", " ")
	text = strings.ReplaceAll(text, "\\;", " ")

	// Если уже есть $ или \(, оставляем как есть
	if strings.Contains(text, "$") || strings.Contains(text, "\\(") {
		return cleanMathSyntax(text)
	}

	// Если содержит математические символы, оборачиваем в $...$
	if containsMathSymbols(text) {
		cleanText := cleanMathSyntax(text)
		return "$" + cleanText + "$"
	}

	return text
}

// processAlgorithmComplexLine обрабатывает сложные строки в алгоритме
func processAlgorithmComplexLine(line string) string {
	// Убираем лишние пробельные конструкции
	line = strings.ReplaceAll(line, "\\quad", " ")
	line = strings.ReplaceAll(line, "\\;", " ")
	line = strings.ReplaceAll(line, "\\\\", "<br>")

	// Разбиваем строку на части по точке с запятой
	parts := regexp.MustCompile(`;\s*`).Split(line, -1)
	var processedParts []string

	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}

		// Обрабатываем inline/display математику для алгоритма
		processedPart := processInlineMathForAlgorithm(part)

		// Обрабатываем текстовые выделения
		processedPart = regexp.MustCompile(`\\textbf\{([^}]+)\}`).ReplaceAllString(processedPart, `<strong>$1</strong>`)
		processedPart = regexp.MustCompile(`\\textit\{([^}]+)\}`).ReplaceAllString(processedPart, `<em>$1</em>`)
		processedPart = regexp.MustCompile(`\\text\{([^}]+)\}`).ReplaceAllString(processedPart, `$1`)

		processedParts = append(processedParts, processedPart)
	}

	result := strings.Join(processedParts, "; ")

	// ВАЖНО: больше не удаляем все LaTeX-команды подряд,
	// иначе потеряем математику! Чистим только "мусор".
	result = strings.ReplaceAll(result, "\\,", " ")
	result = strings.TrimSpace(result)

	return result
}

// convertMathInText конвертирует математику в обычном тексте
func convertMathInText(text string) string {
	text = strings.TrimSpace(text)
	text = strings.ReplaceAll(text, "\\quad", " ")
	text = strings.ReplaceAll(text, "\\;", " ")

	// Если уже есть $...$, оставляем и чистим синтаксис
	if strings.Contains(text, "$") {
		return cleanMathSyntax(text)
	}

	// Если это явно математика, оборачиваем в $
	if containsMathSymbols(text) {
		cleanText := cleanMathSyntax(text)
		return "$" + cleanText + "$"
	}

	return text
}

// cleanMathSyntax очищает математический синтаксис
func cleanMathSyntax(math string) string {
	// Исправляем фигурные скобки
	math = strings.ReplaceAll(math, "\\left\\{", "\\{")
	math = strings.ReplaceAll(math, "\\right\\}", "\\}")

	// Исправляем индексы
	math = regexp.MustCompile(`([a-zA-Z])_([a-zA-Z0-9]+)([^{]|$)`).ReplaceAllString(math, `$1_{$2}$3`)

	// Исправляем степени
	math = regexp.MustCompile(`([a-zA-Z])\^([a-zA-Z0-9]+)([^{]|$)`).ReplaceAllString(math, `$1^{$2}$3`)

	// Исправляем команды LaTeX
	math = strings.ReplaceAll(math, "\\gets", "\\leftarrow")
	math = strings.ReplaceAll(math, "\\varnothing", "\\emptyset")
	math = strings.ReplaceAll(math, "\\displaystyle", "")

	// Убираем проблемные символы
	math = strings.ReplaceAll(math, "&", "")

	// Очищаем множественные пробелы
	math = regexp.MustCompile(`\s+`).ReplaceAllString(math, " ")

	return strings.TrimSpace(math)
}

// containsMathSymbols проверяет наличие математических символов
func containsMathSymbols(text string) bool {
	mathPatterns := []string{
		"\\alpha", "\\beta", "\\gamma", "\\delta", "\\tau", "\\rho",
		"\\mathbb", "\\in", "\\cup", "\\leftarrow", "\\gets", "\\emptyset",
		"\\infty", "\\ge", "\\le", "\\ne", "_", "^", "\\sum",
		"\\frac", "\\cdot", "\\times", "\\subset", "\\forall",
		"\\varnothing", "\\arg", "\\min", "\\max", "\\neq",
		"\\{", "\\}", "\\cap", "\\setminus", "\\bigl", "\\bigr",
	}

	for _, pattern := range mathPatterns {
		if strings.Contains(text, pattern) {
			return true
		}
	}

	return false
}

// processEquationsWithNumbering обрабатывает формулы с нумерацией
func processEquationsWithNumbering(content string) string {
	equationCounter := 1

	equationRe := regexp.MustCompile(`(?s)\\begin\{equation\}(.*?)\\end\{equation\}`)
	content = equationRe.ReplaceAllStringFunc(content, func(match string) string {
		inner := equationRe.FindStringSubmatch(match)[1]
		inner = strings.TrimSpace(inner)

		inner = processCasesInEquation(inner)
		inner = cleanMathSyntax(inner)

		result := fmt.Sprintf("\n<div class=\"equation\">$$%s \\tag{%d}$$</div>\n", inner, equationCounter)
		equationCounter++
		return result
	})

	return content
}

// processCasesInEquation обрабатывает cases
func processCasesInEquation(equation string) string {
	casesRe := regexp.MustCompile(`(?s)\\begin\{cases\}(.*?)\\end\{cases\}`)
	equation = casesRe.ReplaceAllStringFunc(equation, func(match string) string {
		inner := casesRe.FindStringSubmatch(match)[1]
		inner = strings.TrimSpace(inner)

		lines := regexp.MustCompile(`\\\\`).Split(inner, -1)
		var processedLines []string

		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}

			parts := strings.Split(line, "&")
			if len(parts) >= 2 {
				value := strings.TrimSpace(parts[0])
				value = cleanMathSyntax(value)

				condition := strings.TrimSpace(parts[1])
				condition = cleanMathSyntax(condition)

				processedLine := value + " & " + condition
				processedLines = append(processedLines, processedLine)
			} else {
				cleanLine := cleanMathSyntax(line)
				processedLines = append(processedLines, cleanLine)
			}
		}

		if len(processedLines) > 0 {
			processedCases := strings.Join(processedLines, " \\\\ ")
			return "\\begin{cases}" + processedCases + "\\end{cases}"
		}

		return "\\begin{cases}" + inner + "\\end{cases}"
	})

	return equation
}

// processParagraphs обрабатывает абзацы
func processParagraphs(content string) string {
	lines := strings.Split(content, "\n")
	var result []string
	var currentParagraph []string

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if line == "" {
			if len(currentParagraph) > 0 {
				paragraph := strings.Join(currentParagraph, " ")
				if !strings.HasPrefix(paragraph, "<") && !strings.HasPrefix(paragraph, "$$") {
					paragraph = "<p>" + paragraph + "</p>"
				}
				result = append(result, paragraph)
				currentParagraph = nil
			}
		} else if strings.HasPrefix(line, "<") || strings.HasPrefix(line, "$$") {
			if len(currentParagraph) > 0 {
				paragraph := strings.Join(currentParagraph, " ")
				paragraph = "<p>" + paragraph + "</p>"
				result = append(result, paragraph)
				currentParagraph = nil
			}
			result = append(result, line)
		} else {
			currentParagraph = append(currentParagraph, line)
		}
	}

	if len(currentParagraph) > 0 {
		paragraph := strings.Join(currentParagraph, " ")
		if !strings.HasPrefix(paragraph, "<") {
			paragraph = "<p>" + paragraph + "</p>"
		}
		result = append(result, paragraph)
	}

	return strings.Join(result, "\n")
}

// processCommands обрабатывает LaTeX команды
func processCommands(content string) string {
	content = regexp.MustCompile(`\\textbf\{([^}]+)\}`).ReplaceAllString(content, `<strong>$1</strong>`)
	content = regexp.MustCompile(`\\textit\{([^}]+)\}`).ReplaceAllString(content, `<em>$1</em>`)
	content = regexp.MustCompile(`\\emph\{([^}]+)\}`).ReplaceAllString(content, `<em>$1</em>`)

	return content
}

// cleanupMathSymbols очищает оставшиеся символы
func cleanupMathSymbols(content string) string {
	lines := strings.Split(content, "\n")
	var result []string

	for _, line := range lines {
		line = strings.TrimSpace(line)

		if line == "$$" {
			continue
		}

		line = regexp.MustCompile(`<p>\$\$([^$]+)\$\$</p>`).ReplaceAllString(line, `<div class="equation">$$$1$$</div>`)

		if line != "" {
			result = append(result, line)
		}
	}

	return strings.Join(result, "\n")
}

// generateHTML генерирует финальный HTML
func generateHTML(content string, references []string, title string) string {
	referencesHTML := ""
	if len(references) > 0 {
		referencesHTML = `
<hr>
<div class="references">
  <ol>`
		for _, ref := range references {
			// Убираем номер в начале
			ref = regexp.MustCompile(`^\d+\.\s*`).ReplaceAllString(ref, "")
			referencesHTML += "<li>" + ref + "</li>"
		}
		referencesHTML += "</ol>\n</div>"
	}

	html := `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>` + title + `</title>
    
    <script>
        window.MathJax = {
            tex: {
                inlineMath: [['$', '$'], ['\\(', '\\)']],
                displayMath: [['$$', '$$'], ['\\[', '\\]']],
                tags: 'ams',
                tagSide: 'right',
                processEscapes: true,
                processEnvironments: true
            },
            svg: {
                fontCache: 'global'
            },
            startup: {
                ready: () => {
                    console.log('MathJax готов');
                    MathJax.startup.defaultReady();
                    MathJax.startup.promise.then(() => {
                        showContent();
                    });
                }
            }
        };
    </script>
    
    <script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
    
    <style>
        body {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
            color: white;
            background-color: #111;
            font-family: 'Times New Roman', Times, serif;
        }
        
        .equation {
            margin: 20px 0;
            text-align: center;
            padding: 10px;
        }
        
        .algorithm {
            margin: 20px 0;
            padding: 20px;
            border: 1px solid #444;
            background-color: #1a1a1a;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            border-radius: 5px;
        }
        
        .algorithm-title {
            margin-bottom: 15px;
            font-weight: bold;
            color: #fff;
            font-family: 'Times New Roman', Times, serif;
            text-align: center;
            font-size: 16px;
        }
        
        .algorithm-input, .algorithm-output, .algorithm-init {
            margin: 10px 0;
            padding: 8px 0;
            color: #ccc;
            border-bottom: 1px solid #333;
            font-family: 'Times New Roman', Times, serif;
        }
        
        .algorithm-for, .algorithm-while, .algorithm-foreach, .algorithm-return {
            margin: 5px 0;
            color: #fff;
            font-weight: bold;
            line-height: 1.4;
        }
        
        .algorithm-line {
            margin: 3px 0;
            color: #ddd;
            line-height: 1.4;
        }
        
        .algorithm-comment {
            margin: 3px 0;
            color: #888;
            font-style: italic;
            line-height: 1.4;
        }
        
        .algorithm mjx-container {
			font-family: 'Times New Roman', Times, serif !important;
			font-size: 1em !important;
			color: #fff !important;
		}
		.algorithm-math {
			display: inline-block;
			margin: 2px 0;
		}
		.algorithm-math div {
			text-align: center;
		}

        .algorithm mjx-container[display="true"] {
            display: block !important;
            margin: 0.5em 0 !important;
            text-align: left !important;
        }
        
        .algorithm mjx-container svg {
            vertical-align: baseline !important;
        }
        
        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.5em;
        }
        
        p {
            text-align: justify;
            margin-bottom: 15px;
            font-size: 16px;
        }
        
        .loading {
            text-align: center;
            color: #666;
            font-style: italic;
            padding: 50px;
        }
        
        .loading-spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #666;
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
            margin-right: 10px;
        }

		.references {
			border-top: none;   /* убираем верхнюю линию у блока */
			border-bottom: none; /* убираем нижнюю */
			margin-top: 0.5em;
		}

		.references ol {
			margin: 0;
			padding-left: 20px;
		}

		hr {
			border: none;
			border-top: 1px solid #444; /* более мягкий серый */
			margin: 1em 0;
		}

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="loading" class="loading">
        <div class="loading-spinner"></div>
        Загрузка математических формул...
    </div>
    
    <div id="content" style="display: none;">
        <h1>` + title + `</h1>
        ` + content + `
        ` + referencesHTML + `
    </div>

    <script>
        function showContent() {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('content').style.display = 'block';
            console.log('Контент отображен');
        }

        function waitForMathJax() {
            if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
                window.MathJax.startup.promise.then(() => {
                    console.log('MathJax загружен');
                    showContent();
                }).catch((err) => {
                    console.log('Ошибка MathJax:', err);
                    showContent();
                });
            } else {
                setTimeout(waitForMathJax, 100);
            }
        }

        document.addEventListener('DOMContentLoaded', function() {
            setTimeout(() => {
                if (document.getElementById('loading').style.display !== 'none') {
                    showContent();
                }
            }, 5000);
            
            waitForMathJax();
        });
    </script>
</body>
</html>`

	return html
}
