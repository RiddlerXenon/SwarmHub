package server

import (
	"crypto/tls"
	"net/http"
	"time"
	"log"

	"github.com/RiddlerXenon/SwarmHub/internal/handlers"
	"github.com/RiddlerXenon/SwarmHub/internal/middleware"
	"github.com/gorilla/mux"
)

type Server struct {
	router *mux.Router
}

func NewServer() *Server {
	s := &Server{
		router: mux.NewRouter(),
	}

	s.setupRoutes()
	s.setupMiddleware()

	return s
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

	// Маршруты для HTML страниц - используем FileServer напрямую
	s.router.PathPrefix("/").Handler(http.FileServer(http.Dir("./templates/")))
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
