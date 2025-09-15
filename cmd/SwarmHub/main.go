package main

import (
	"log"
	"os"

	"github.com/RiddlerXenon/SwarmHub/internal/server"
)

func main() {
	httpPort := os.Getenv("HTTP_PORT")
	if httpPort == "" {
		httpPort = "8080"
	}

	httpsPort := os.Getenv("HTTPS_PORT")
	if httpsPort == "" {
		httpsPort = "8443"
	}

	certFile := os.Getenv("CERT_FILE")
	keyFile := os.Getenv("KEY_FILE")

	srv := server.NewServer()

	// Проверяем наличие сертификатов для HTTPS
	if certFile != "" && keyFile != "" {
		log.Printf("Запуск HTTPS сервера на порту %s", httpsPort)
		if err := srv.StartTLS(":"+httpsPort, certFile, keyFile); err != nil {
			log.Fatalf("Не удалось запустить HTTPS сервер: %v", err)
		}
	} else {
		log.Printf("Сертификаты не найдены, запуск HTTP сервера на порту %s", httpPort)
		log.Printf("Для HTTPS установите переменные CERT_FILE и KEY_FILE")
		if err := srv.Start(":" + httpPort); err != nil {
			log.Fatalf("Не удалось запустить HTTP сервер: %v", err)
		}
	}
}
