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
| `hubthe_list_sprints` | Список спринтов в активном проекте |
| `hubthe_list_sprint_tasks` | Задачи выбранного спринта |
| `hubthe_list_custom_fields` | Доступные кастомные поля проекта |
| `hubthe_search_tasks` | Фильтрация задач по кастомным полям |
| `hubthe_get_task_comments` | Комментарии задачи |
| `hubthe_add_comment` | Добавление комментария или ответа |
| `hubthe_add_diagram` | Добавление диаграммы Mermaid как Excalidraw-комментария |
| `hubthe_create_task` | Создание задачи или подзадачи |
| `hubthe_update_task` | Обновление полей задачи |
| `hubthe_list_project_participants` | Участники проекта |
| `hubthe_list_field_options` | Опции select-поля |
| `hubthe_fetch_image` | Загрузка изображения из комментариев HubThe |

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
| **SSE / HTTP** (по умолчанию) | `node dist/index.js --http` | Docker, постоянный сервис |
| **stdio** | `node dist/index.js` | Локально, клиент запускает процесс |

`--sse` также поддерживается как алиас к `--http` для обратной совместимости.

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

### hubthe_list_sprints

Возвращает список спринтов активного проекта с количеством задач в каждом.

### hubthe_list_sprint_tasks

Возвращает задачи выбранного спринта.

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `sprint_name` | `string` | — | Название спринта |
| `top_level_only` | `boolean` | `false` | Только задачи верхнего уровня |
| `additional_fields` | `string[]` | — | Дополнительные slug полей |

### hubthe_list_custom_fields

Возвращает список доступных кастомных полей активного проекта: slug, имя, тип, системность.

### hubthe_search_tasks

Фильтрует задачи по кастомным полям активного проекта.

| Параметр | Тип | Описание |
|---|---|---|
| `filters` | `Array<{field, values, mode}>` | Фильтры по slug поля |
| `fields` | `string[]` | Дополнительные поля в ответе |
| `top_level_only` | `boolean` | Только задачи верхнего уровня |

### hubthe_get_task_comments

Возвращает задачу и её комментарии по номеру задачи или GUID.

### hubthe_add_comment

Добавляет комментарий или ответ на комментарий.

### hubthe_add_diagram

Конвертирует Mermaid в Excalidraw через `@excalidraw/mermaid-to-excalidraw` и добавляет диаграмму в комментарий задачи.
Сериализация комментария совместима с `ExcalidrawNode` из `hubthe-front` (`Lexical JSON -> paragraph -> excalidraw`).
Поддерживает опциональный `caption`, который добавляется отдельным абзацем после диаграммы.

### hubthe_create_task

Создаёт задачу в активном проекте. Поддерживает резолв человекочитаемых значений для select/users/sprint полей.

### hubthe_update_task

Обновляет указанные поля существующей задачи.

### hubthe_list_project_participants

Возвращает участников активного проекта: guid, имя, email.

### hubthe_list_field_options

Возвращает доступные значения для select-поля по его slug.

### hubthe_fetch_image

Загружает изображение из HubThe по URL и возвращает его как base64-контент для MCP-клиента.

## Архитектура

```
hubthemcp/
├── src/
│   ├── index.ts            # MCP-сервер (stdio + SSE)
│   └── hubthe-client.ts    # HTTP-клиент HubThe API
│   └── mermaid-to-excalidraw.ts # Конвертация Mermaid -> Excalidraw
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
node dist/index.js --http  # SSE-режим
```

## Безопасность

- На macOS credentials хранятся в Keychain, а не в файлах
- В Docker credentials передаются через env vars или `.env` файл (не коммитится)
- JWT хранится только в памяти процесса
- `.env` добавлен в `.dockerignore`
