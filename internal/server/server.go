package server

import (
	"crypto/tls"
	"net/http"
	"time"

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

	// Редирект на HTTPS (если нужен)
	s.router.HandleFunc("/.well-known/acme-challenge/{token}", handlers.ACMEChallengeHandler).Methods("GET")

	// Статические файлы (если нужны)
	s.router.PathPrefix("/").Handler(http.FileServer(http.Dir("./static/")))
}

func (s *Server) Start(addr string) error {
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
