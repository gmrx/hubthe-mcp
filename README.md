# HubThe MCP

MCP-сервер для работы с платформой [HubThe](https://hubthe.team) из AI-редакторов (Cursor, Windsurf, Claude Desktop и др.).

Позволяет AI-агенту получать информацию о проектах и задачах пользователя через [Model Context Protocol](https://modelcontextprotocol.io/).

## Возможности

| Инструмент | Описание |
|---|---|
| `hubthe_whoami` | Информация о текущем пользователе |
| `hubthe_list_projects` | Список доступных проектов |
| `hubthe_set_project` | Выбор активного проекта по GUID |
| `hubthe_list_my_tasks` | Задачи, назначенные на текущего пользователя |

## Быстрый старт

### Вариант 1: Docker (рекомендуется)

```bash
# Склонировать репозиторий
git clone <repo-url> && cd hubthemcp

# Создать .env с credentials
cp .env.example .env
# Отредактировать .env — указать email и пароль

# Запустить
docker compose up -d
```

Сервер поднимется на `http://localhost:8080` в SSE-режиме.

Подключение к Cursor:

```json
{
  "mcpServers": {
    "hubthe": {
      "url": "http://localhost:8080/sse"
    }
  }
}
```

### Вариант 2: Docker без compose

```bash
docker build -t hubthemcp .

docker run -d --name hubthemcp \
  -p 8080:8080 \
  -e HUBTHE_EMAIL=your@email.com \
  -e HUBTHE_PASSWORD=your-password \
  -e HUBTHE_URL=https://hubthe.team \
  hubthemcp
```

### Вариант 3: Docker + stdio

Если ваш MCP-клиент поддерживает только stdio-транспорт:

```json
{
  "mcpServers": {
    "hubthe": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "HUBTHE_EMAIL=your@email.com",
        "-e", "HUBTHE_PASSWORD=your-password",
        "-e", "HUBTHE_URL=https://hubthe.team",
        "hubthemcp",
        "--stdio"
      ]
    }
  }
}
```

### Вариант 4: Локально на macOS

```bash
npm install
npm run build

# Сохранить credentials в macOS Keychain (безопасно)
./setup.sh
```

Подключение к Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "hubthe": {
      "command": "node",
      "args": ["/путь/до/hubthemcp/dist/index.js"],
      "env": {
        "HUBTHE_URL": "https://hubthe.team"
      }
    }
  }
}
```

## Режимы работы

| Режим | Запуск | Применение |
|---|---|---|
| **SSE** (по умолчанию) | `node dist/index.js --sse` | Docker, постоянный сервис |
| **stdio** | `node dist/index.js` | Локально, клиент запускает процесс |

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `HUBTHE_URL` | `https://hubthe.team` | Базовый URL платформы |
| `HUBTHE_EMAIL` | — | Email для авторизации |
| `HUBTHE_PASSWORD` | — | Пароль для авторизации |
| `PORT` | `8080` | Порт HTTP-сервера (SSE-режим) |

На macOS credentials в первую очередь берутся из Keychain (service: `hubthe-mcp`). Если Keychain недоступен или пуст — из переменных окружения.

## Инструменты

### hubthe_whoami

Возвращает профиль авторизованного пользователя: guid, имя, email, лицензию, аватар.

### hubthe_list_projects

Возвращает массив проектов с полями: `guid`, `name`, `slug`, `description`, `creator`, `hidden`, `archive`.

### hubthe_set_project

Устанавливает активный проект. Необходим перед вызовом `hubthe_list_my_tasks`.

| Параметр | Тип | Описание |
|---|---|---|
| `project_guid` | `string (UUID)` | GUID проекта |

### hubthe_list_my_tasks

Возвращает задачи, где текущий пользователь указан как исполнитель.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `top_level_only` | `boolean` | `false` | Только задачи верхнего уровня |
| `additional_fields` | `string[]` | — | Дополнительные slug кастомных полей |

Поля в ответе: номер, название, описание, статус, приоритет, спринт, исполнители.

## Архитектура

```
hubthemcp/
├── src/
│   ├── index.ts            # MCP-сервер (stdio + SSE)
│   └── hubthe-client.ts    # HTTP-клиент HubThe API
├── Dockerfile              # Multi-stage сборка
├── docker-compose.yml      # Запуск одной командой
├── .env.example            # Шаблон переменных
├── setup.sh                # macOS Keychain setup
├── package.json
└── tsconfig.json
```

### Авторизация

1. При первом вызове инструмента `autoAuth()` ищет credentials (Keychain → env vars)
2. POST `/api/v1/auth` — получение JWT в `Set-Cookie`
3. JWT сохраняется в памяти процесса на время сессии
4. Все запросы используют JWT, повторная авторизация не нужна

### API-эндпоинты

| Эндпоинт | Сервис | Назначение |
|---|---|---|
| `POST /api/v1/auth` | Django | Авторизация |
| `GET /api/v1/whoami` | Django | Текущий пользователь |
| `GET /api/v1/project` | Django | Список проектов |
| `GET /api/v1/project/:guid` | Django | Детали проекта |
| `GET /api/v3/project/:guid/customfields` | Go | Карта кастомных полей |
| `POST /api/v3/project/:guid/filters` | Go | Фильтрация задач |

## Разработка

```bash
npm install
npm run dev        # TypeScript watch
npm run build      # Сборка
npm start          # stdio-режим
node dist/index.js --sse   # SSE-режим
```

## Безопасность

- На macOS credentials хранятся в Keychain, а не в файлах
- В Docker credentials передаются через env vars или `.env` файл (не коммитится)
- JWT хранится только в памяти процесса
- `.env` добавлен в `.dockerignore`
