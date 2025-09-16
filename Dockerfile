# Многоэтапная сборка
FROM golang:1.24-alpine AS builder

# Устанавливаем необходимые пакеты
RUN apk add --no-cache git wget

WORKDIR /app

# Копируем go mod и sum файлы
COPY go.mod go.sum ./

# Загружаем зависимости
RUN go mod download

# Копируем исходный код
COPY . .

# Собираем приложение
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/SwarmHub

# Финальный образ
FROM alpine:latest

RUN apk --no-cache add ca-certificates wget

WORKDIR /root/

# Копируем бинарник
COPY --from=builder /app/main .

# Копируем статические файлы и шаблоны
COPY --from=builder /app/static ./static
COPY --from=builder /app/templates ./templates

# Создаем директорию для логов
RUN mkdir -p /var/log/app

EXPOSE 8080

CMD ["./main"]
