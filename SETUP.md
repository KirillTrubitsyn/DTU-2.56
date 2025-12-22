# Настройка RAG чата для дела АО «Дальтрансуголь»

## Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   index.html    │────▶│  Vercel API     │────▶│  Google Gemini  │
│   (UI чата)     │     │  /api/chat.js   │     │   2.5 Pro       │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │    Supabase     │
                        │  • pgvector     │
                        │  • documents    │
                        └─────────────────┘
```

## Шаг 1: Настройка Supabase

### 1.1 Создайте проект Supabase

1. Зайдите на [supabase.com](https://supabase.com)
2. Создайте новый проект
3. Запишите `Project URL` и `anon key` из Settings → API

### 1.2 Включите pgvector

В SQL Editor выполните:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 1.3 Создайте таблицы

Скопируйте содержимое файла `supabase/schema.sql` и выполните в SQL Editor.

**Важно:** Размерность вектора в схеме указана как 1536. Если используете Google Embeddings (text-embedding-004), измените на 768:

```sql
-- Замените в schema.sql:
embedding vector(768)  -- вместо vector(1536)
```

## Шаг 2: Получите Google API ключ

### Google AI Studio (Gemini)

1. Зайдите на [aistudio.google.com](https://aistudio.google.com)
2. Нажмите **Get API Key** → **Create API key**
3. Выберите проект или создайте новый
4. Скопируйте ключ (начинается с `AIza...`)

**Бесплатный лимит:** 60 запросов в минуту для Gemini 2.5 Pro

## Шаг 3: Настройка Vercel

### 3.1 Разверните проект

```bash
# Установите Vercel CLI
npm install -g vercel

# Разверните проект
vercel

# Или подключите к GitHub репозиторию через vercel.com
```

### 3.2 Добавьте переменные окружения

В Vercel Dashboard → Settings → Environment Variables добавьте:

| Переменная | Значение |
|-----------|----------|
| `GOOGLE_API_KEY` | AIza... |
| `SUPABASE_URL` | https://xxx.supabase.co |
| `SUPABASE_ANON_KEY` | eyJhbGc... |

### 3.3 Повторите деплой

```bash
vercel --prod
```

## Шаг 4: Загрузите документы

### 4.1 Установите зависимости

```bash
npm install
```

### 4.2 Создайте .env.local

```bash
cp .env.example .env.local
# Отредактируйте файл и добавьте свои ключи
```

### 4.3 Запустите скрипт загрузки

```bash
node scripts/upload-documents.js
```

Это загрузит предустановленные документы по делу в Supabase.

### 4.4 Добавьте свои документы

Вы можете добавить дополнительные документы:

1. Отредактируйте массив `DOCUMENTS` в `scripts/upload-documents.js`
2. Или добавьте напрямую в Supabase через интерфейс

## Шаг 5: Проверка

1. Откройте ваш сайт на Vercel
2. Нажмите на кнопку чата (синий кружок с AI в правом нижнем углу)
3. Задайте вопрос, например: "Какие самые сильные аргументы защиты?"

## Структура проекта

```
DTU-2.56/
├── index.html              # Основная страница с UI чата
├── package.json            # Зависимости Node.js
├── vercel.json             # Конфигурация Vercel
├── .env.example            # Пример переменных окружения
├── api/
│   └── chat.js             # API route для чата (Google Gemini)
├── supabase/
│   ├── schema.sql          # SQL схема для базы данных
│   └── functions/
│       └── embed/
│           └── index.ts    # Edge Function для embeddings (опционально)
└── scripts/
    └── upload-documents.js # Скрипт загрузки документов
```

## Используемые модели Google

| Модель | Назначение |
|--------|-----------|
| `gemini-2.5-pro-preview-06-05` | Генерация ответов (основная) |
| `text-embedding-004` | Создание embeddings для RAG |

## Troubleshooting

### Чат не отвечает

1. Проверьте консоль браузера (F12 → Console)
2. Убедитесь, что `GOOGLE_API_KEY` задан в Vercel
3. Проверьте логи в Vercel Dashboard → Functions

### Ошибка "API key not valid"

1. Проверьте, что API ключ скопирован полностью
2. Убедитесь, что Gemini API включён в вашем Google Cloud проекте
3. Проверьте квоты на [console.cloud.google.com](https://console.cloud.google.com)

### Документы не находятся

1. Проверьте, что документы загружены: Supabase → Table Editor → documents
2. Убедитесь, что embeddings сгенерированы (колонка embedding не NULL)
3. Проверьте размерность вектора (должна быть 768 для Google)

## Добавление новых документов

### Через интерфейс Supabase

1. Откройте Supabase → Table Editor → documents
2. Нажмите Insert Row
3. Заполните title, content, source, category
4. Embedding будет сгенерирован автоматически при следующем запросе

### Через скрипт

Добавьте документы в массив `DOCUMENTS` в `scripts/upload-documents.js` и запустите:

```bash
node scripts/upload-documents.js
```

## Стоимость

### Google Gemini 2.5 Pro
- **Бесплатно:** 60 RPM, 1500 RPD
- **Платно:** $1.25 / 1M input tokens, $10 / 1M output tokens

### Supabase
- **Бесплатно:** 500MB база данных, 50MB file storage
- **Pro:** $25/месяц

## Контакты

Если возникли вопросы по настройке — создайте Issue в GitHub репозитории.
