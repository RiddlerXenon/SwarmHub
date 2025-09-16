package server

import (
	"crypto/tls"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"log"

	"github.com/RiddlerXenon/SwarmHub/internal/handlers"
	"github.com/RiddlerXenon/SwarmHub/internal/middleware"
	"github.com/gorilla/mux"
)

type Server struct {
	router    *mux.Router
	templates *template.Template
}

func NewServer() *Server {
	s := &Server{
		router: mux.NewRouter(),
	}

	// Загружаем шаблоны
	s.loadTemplates()
	s.setupRoutes()
	s.setupMiddleware()

	return s
}

func (s *Server) loadTemplates() {
	// Загружаем все HTML шаблоны рекурсивно
	templateFiles, err := filepath.Glob("./templates/**/*.html")
	if err != nil {
		log.Printf("Ошибка при поиске шаблонов: %v", err)
		templateFiles = []string{}
	}

	// Добавляем шаблоны из корневой папки templates
	rootTemplates, err := filepath.Glob("./templates/*.html")
	if err == nil {
		templateFiles = append(templateFiles, rootTemplates...)
	}

	if len(templateFiles) > 0 {
		s.templates, err = template.ParseFiles(templateFiles...)
		if err != nil {
			log.Printf("Ошибка при парсинге шаблонов: %v", err)
			s.templates = template.New("main")
		}
	} else {
		s.templates = template.New("main")
	}

	log.Printf("Загружено %d шаблонов", len(templateFiles))
}

func (s *Server) setupMiddleware() {
	s.router.Use(middleware.CORSMiddleware)
	s.router.Use(middleware.LoggingMiddleware)
	s.router.Use(middleware.SecurityHeadersMiddleware)
}

func (s *Server) setupRoutes() {
	// API routes
	api := s.router.PathPrefix("/api/v1").Subrouter()

	api.HandleFunc("/health", handlers.HealthHandler).Methods("GET")
	api.HandleFunc("/status", handlers.StatusHandler).Methods("GET")
	api.HandleFunc("/ping", handlers.PingHandler).Methods("GET")

	// ACME Challenge для Let's Encrypt
	s.router.HandleFunc("/.well-known/acme-challenge/{token}", handlers.ACMEChallengeHandler).Methods("GET")

	// Статические файлы
	s.router.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("./static/"))))

	// Маршруты для главной страницы
	s.router.HandleFunc("/", s.indexHandler).Methods("GET")
	s.router.HandleFunc("/index.html", s.indexHandler).Methods("GET")

	// Маршруты для алгоритмов (без расширения .html)
	s.router.HandleFunc("/aco", s.acoHandler).Methods("GET")
	s.router.HandleFunc("/boids", s.boidsHandler).Methods("GET")
	s.router.HandleFunc("/sds", s.sdsHandler).Methods("GET")
	s.router.HandleFunc("/vicsek", s.vicsekHandler).Methods("GET")

	// Маршруты для алгоритмов (с расширением .html)
	s.router.HandleFunc("/aco.html", s.acoHandler).Methods("GET")
	s.router.HandleFunc("/boids.html", s.boidsHandler).Methods("GET")
	s.router.HandleFunc("/sds.html", s.sdsHandler).Methods("GET")
	s.router.HandleFunc("/vicsek.html", s.vicsekHandler).Methods("GET")

	// Маршруты для описаний (без расширения)
	s.router.HandleFunc("/descriptions/aco", s.acoDescHandler).Methods("GET")
	s.router.HandleFunc("/descriptions/boids", s.boidsDescHandler).Methods("GET")
	s.router.HandleFunc("/descriptions/sds", s.sdsDescHandler).Methods("GET")
	s.router.HandleFunc("/descriptions/vicsek", s.vicsekDescHandler).Methods("GET")

	// Маршруты для описаний (с расширением .html)
	s.router.HandleFunc("/descriptions/aco.html", s.acoDescHandler).Methods("GET")
	s.router.HandleFunc("/descriptions/boids.html", s.boidsDescHandler).Methods("GET")
	s.router.HandleFunc("/descriptions/sds.html", s.sdsDescHandler).Methods("GET")
	s.router.HandleFunc("/descriptions/vicsek.html", s.vicsekDescHandler).Methods("GET")
}

// Обработчики страниц
func (s *Server) indexHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "index.html", nil)
}

func (s *Server) acoHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "aco.html", nil)
}

func (s *Server) boidsHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "boids.html", nil)
}

func (s *Server) sdsHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "sds.html", nil)
}

func (s *Server) vicsekHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "vicsek.html", nil)
}

// Обработчики описаний
func (s *Server) acoDescHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "descriptions/aco.html", nil)
}

func (s *Server) boidsDescHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "descriptions/boids.html", nil)
}

func (s *Server) sdsDescHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "descriptions/sds.html", nil)
}

func (s *Server) vicsekDescHandler(w http.ResponseWriter, r *http.Request) {
	s.renderTemplate(w, r, "descriptions/vicsek.html", nil)
}

// Улучшенный метод для рендеринга шаблонов
func (s *Server) renderTemplate(w http.ResponseWriter, r *http.Request, tmpl string, data interface{}) {
	log.Printf("Попытка рендеринга шаблона: %s", tmpl)
	
	// Устанавливаем правильный Content-Type
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	
	// Получаем имя файла шаблона для поиска
	templateName := filepath.Base(tmpl)
	
	// Пытаемся выполнить шаблон
	err := s.templates.ExecuteTemplate(w, templateName, data)
	if err != nil {
		log.Printf("Ошибка выполнения шаблона %s: %v", tmpl, err)
		
		// Пытаемся найти файл напрямую
		var templatePath string
		
		if strings.HasPrefix(tmpl, "descriptions/") {
			templatePath = filepath.Join("./templates", tmpl)
		} else {
			templatePath = filepath.Join("./templates", tmpl)
		}
		
		log.Printf("Попытка загрузки файла: %s", templatePath)
		
		// Проверяем существование файла
		if _, err := os.Stat(templatePath); err == nil {
			http.ServeFile(w, r, templatePath)
			return
		}
		
		log.Printf("Файл не найден: %s", templatePath)
		http.Error(w, "Шаблон не найден: "+tmpl, http.StatusNotFound)
		return
	}
	
	log.Printf("Успешно отрендерен шаблон: %s", tmpl)
}

func (s *Server) Start(addr string) error {
	log.Printf("Запуск HTTP сервера на %s", addr)
	
	server := &http.Server{
		Addr:         addr,
		Handler:      s.router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return server.ListenAndServe()
}

func (s *Server) StartTLS(addr, certFile, keyFile string) error {
	log.Printf("Запуск HTTPS сервера на %s", addr)
	
	// Настройка TLS конфигурации
	tlsConfig := &tls.Config{
		MinVersion:               tls.VersionTLS12,
		CurvePreferences:         []tls.CurveID{tls.CurveP521, tls.CurveP384, tls.CurveP256},
		PreferServerCipherSuites: true,
		CipherSuites: []uint16{
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		},
	}

	server := &http.Server{
		Addr:         addr,
		Handler:      s.router,
		TLSConfig:    tlsConfig,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return server.ListenAndServeTLS(certFile, keyFile)
}
