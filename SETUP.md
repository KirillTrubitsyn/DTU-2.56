# Настройка RAG чата для дела АО «Дальтрансуголь»

## Архитектура

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   index.html    │────▶│  Vercel API     │────▶│    Claude API   │
│   (UI чата)     │     │  /api/chat.js   │     │   (Anthropic)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │    Supabase     │
                        │  • pgvector     │
                        │  • documents    │
                        │  • Edge Func    │
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

### 1.4 (Опционально) Настройте Edge Function

Если хотите генерировать embeddings через Supabase:

```bash
# Установите Supabase CLI
npm install -g supabase

# Войдите в аккаунт
supabase login

# Свяжите с проектом
supabase link --project-ref YOUR_PROJECT_REF

# Разверните функцию
supabase functions deploy embed

# Добавьте секреты
supabase secrets set VOYAGE_API_KEY=your-key
# или
supabase secrets set OPENAI_API_KEY=your-key
```

## Шаг 2: Получите API ключи

### Claude API (Anthropic)

1. Зайдите на [console.anthropic.com](https://console.anthropic.com)
2. Создайте API ключ в разделе API Keys
3. Сохраните ключ (начинается с `sk-ant-api03-`)

### Voyage AI (для embeddings, рекомендуется)

1. Зайдите на [dash.voyageai.com](https://dash.voyageai.com)
2. Создайте API ключ
3. Модель `voyage-multilingual-2` лучше работает с русским текстом

### Или OpenAI (альтернатива)

1. Зайдите на [platform.openai.com](https://platform.openai.com)
2. Создайте API ключ
3. Модель `text-embedding-3-small` дешевле и быстрее

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
| `ANTHROPIC_API_KEY` | sk-ant-api03-... |
| `SUPABASE_URL` | https://xxx.supabase.co |
| `SUPABASE_ANON_KEY` | eyJhbGc... |
| `VOYAGE_API_KEY` | pa-... (или OPENAI_API_KEY) |

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
│   └── chat.js             # API route для чата (Vercel Serverless)
├── supabase/
│   ├── schema.sql          # SQL схема для базы данных
│   └── functions/
│       └── embed/
│           └── index.ts    # Edge Function для embeddings
└── scripts/
    └── upload-documents.js # Скрипт загрузки документов
```

## Troubleshooting

### Чат не отвечает

1. Проверьте консоль браузера (F12 → Console)
2. Убедитесь, что все переменные окружения заданы в Vercel
3. Проверьте логи в Vercel Dashboard → Functions

### Embeddings не работают

1. Убедитесь, что VOYAGE_API_KEY или OPENAI_API_KEY задан
2. Проверьте, что Edge Function развёрнута (если используете)
3. Попробуйте fallback на текстовый поиск (работает без embeddings)

### Документы не находятся

1. Проверьте, что документы загружены: Supabase → Table Editor → documents
2. Убедитесь, что embeddings сгенерированы (колонка embedding не NULL)
3. Проверьте, что функция `match_documents` создана

## Добавление новых документов

### Через интерфейс Supabase

1. Откройте Supabase → Table Editor → documents
2. Нажмите Insert Row
3. Заполните title, content, source, category
4. Embedding будет сгенерирован автоматически при следующем запросе (или вручную)

### Через скрипт

Добавьте документы в массив `DOCUMENTS` в `scripts/upload-documents.js` и запустите:

```bash
node scripts/upload-documents.js
```

## Контакты

Если возникли вопросы по настройке — создайте Issue в GitHub репозитории.
