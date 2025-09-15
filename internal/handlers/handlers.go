package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gorilla/mux"
)

type HealthResponse struct {
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
	Message   string    `json:"message"`
	HTTPS     bool      `json:"https"`
}

type StatusResponse struct {
	Version   string            `json:"version"`
	Status    string            `json:"status"`
	Timestamp time.Time         `json:"timestamp"`
	HTTPS     bool              `json:"https"`
	Services  map[string]string `json:"services"`
}

// HealthHandler проверяет состояние сервера
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	isHTTPS := r.TLS != nil

	response := HealthResponse{
		Status:    "OK",
		Timestamp: time.Now(),
		Message:   "Сервер работает нормально",
		HTTPS:     isHTTPS,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// StatusHandler возвращает подробную информацию о статусе
func StatusHandler(w http.ResponseWriter, r *http.Request) {
	isHTTPS := r.TLS != nil

	response := StatusResponse{
		Version:   "1.0.0",
		Status:    "running",
		Timestamp: time.Now(),
		HTTPS:     isHTTPS,
		Services: map[string]string{
			"database": "connected",
			"cache":    "connected",
			"queue":    "connected",
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// PingHandler простой ping endpoint
func PingHandler(w http.ResponseWriter, r *http.Request) {
	isHTTPS := r.TLS != nil

	response := map[string]interface{}{
		"message":   "pong",
		"timestamp": time.Now(),
		"https":     isHTTPS,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// ACMEChallengeHandler для валидации Let's Encrypt
func ACMEChallengeHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	token := vars["token"]

	// Здесь должна быть логика для обработки ACME challenge
	// Обычно это чтение файла из .well-known/acme-challenge/
	w.Header().Set("Content-Type", "text/plain")
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ACME Challenge token: " + token))
}
