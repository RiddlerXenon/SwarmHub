# SwarmHub

Лёгкое Go‑приложение со серверной отрисовкой шаблонов и статикой. Готово к запуску через Docker Compose.

- Язык: Go
- Лицензия: GPL‑3.0 (см. [LICENSE](LICENSE))

## Что внутри
- Шаблоны: `templates/`
- Статика: `static/`
- Логи приложения: `./logs` (монтируется в контейнер)
- Сервис и порты описаны в [docker-compose.yml](docker-compose.yml)

## Быстрый старт (только Docker Compose)

Требуется Docker и Docker Compose v2.

```bash
# Сборка и запуск в фоне
docker compose up -d --build

# Просмотр логов
docker compose logs -f

# Остановка и удаление контейнеров
docker compose down
```

После старта приложение доступно на:
- http://localhost:8090
- Healthcheck: http://localhost:8090/api/v1/health

Проброс порта настроен как `127.0.0.1:8090 -> контейнер:8080`.

## Конфигурация

Переменные окружения задаются в [docker-compose.yml](docker-compose.yml):
- `HTTP_PORT=8080` — порт внутри контейнера
- `GO_ENV=production` — окружение запуска
- `DOMAIN=swarmhub.integralize.ru` — домен приложения

Чтобы изменить значения, отредактируйте `docker-compose.yml` (или используйте `.env` и соответствующие ссылки в compose‑файле).

## Структура проекта (кратко)
```
cmd/         — точки входа (main)
internal/    — внутренняя логика
utils/       — утилиты
templates/   — HTML‑шаблоны
static/      — статика (CSS/JS/изображения)
Dockerfile
docker-compose.yml
nginx.conf
```

## Лицензия

GPL‑3.0 — см. [LICENSE](LICENSE).
