-- =====================================================
-- Supabase Schema для RAG системы
-- Дело № А73-19604/2025 АО «Дальтрансуголь»
-- =====================================================

-- Включаем расширение pgvector для работы с embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- Таблица документов
-- =====================================================
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT, -- Источник документа (напр. "Постановление КС РФ 56-П")
  category TEXT, -- Категория: court_decision, law, expert_opinion, evidence, etc.
  metadata JSONB DEFAULT '{}', -- Дополнительные данные
  embedding vector(768), -- Вектор для Google text-embedding-004 (768 измерений)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для быстрого векторного поиска (IVFFlat)
CREATE INDEX IF NOT EXISTS documents_embedding_idx
ON documents USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Индекс для полнотекстового поиска
CREATE INDEX IF NOT EXISTS documents_content_fts_idx
ON documents USING GIN (to_tsvector('russian', content));

-- Индекс по категориям
CREATE INDEX IF NOT EXISTS documents_category_idx ON documents(category);

-- =====================================================
-- Функция для семантического поиска документов
-- =====================================================
CREATE OR REPLACE FUNCTION match_documents(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  content TEXT,
  source TEXT,
  category TEXT,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.title,
    d.content,
    d.source,
    d.category,
    1 - (d.embedding <=> query_embedding) as similarity
  FROM documents d
  WHERE 1 - (d.embedding <=> query_embedding) > match_threshold
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =====================================================
-- Таблица истории чатов (опционально)
-- =====================================================
CREATE TABLE IF NOT EXISTS chat_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources TEXT[], -- Использованные источники
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_history_session_idx ON chat_history(session_id);
CREATE INDEX IF NOT EXISTS chat_history_created_idx ON chat_history(created_at);

-- =====================================================
-- Триггер для обновления updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- =====================================================
-- Row Level Security (RLS)
-- =====================================================
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- Политика: все могут читать документы
CREATE POLICY "Documents are viewable by everyone" ON documents
  FOR SELECT USING (true);

-- Политика: только авторизованные могут добавлять документы
CREATE POLICY "Authenticated users can insert documents" ON documents
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Политика: все могут добавлять историю чата
CREATE POLICY "Anyone can insert chat history" ON chat_history
  FOR INSERT WITH CHECK (true);

-- Политика: все могут читать свою историю (по session_id)
CREATE POLICY "Anyone can read chat history" ON chat_history
  FOR SELECT USING (true);

-- =====================================================
-- Примеры данных для начала работы
-- (Раскомментируйте для добавления тестовых данных)
-- =====================================================

-- =====================================================
-- Storage Bucket для файлов документов
-- =====================================================

-- Создаём публичный bucket для документов (выполните в SQL Editor)
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

-- Политика: все могут читать файлы
CREATE POLICY "Public read access for documents" ON storage.objects
  FOR SELECT USING (bucket_id = 'documents');

-- Политика: авторизованные могут загружать файлы
CREATE POLICY "Authenticated users can upload documents" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'documents');

-- Политика: авторизованные могут удалять файлы
CREATE POLICY "Authenticated users can delete documents" ON storage.objects
  FOR DELETE USING (bucket_id = 'documents');

-- =====================================================
-- Примеры данных для начала работы
-- (Раскомментируйте для добавления тестовых данных)
-- =====================================================

/*
INSERT INTO documents (title, content, source, category) VALUES
(
  'Постановление КС РФ № 56-П от 06.12.2024',
  'Конституционный Суд указал, что суд не вправе ограничиваться установлением элементов состава правонарушения. Суд обязан учитывать обстоятельства, исключающие или уменьшающие вред. Формальное применение методик расчёта недопустимо. Требуется оценка фактических неблагоприятных экологических последствий.',
  'Постановление КС РФ',
  'court_decision'
),
(
  'Данные мониторинга ДВФУ 2008-2024',
  'Мониторинг экосистемы бухты Мучке за 16 лет показывает: здоровый бентос, нормальная фито/зоопланктон, ихтиофауна в норме. Видеосъёмка 2023: высокая продуктивность, отсутствие заиления. Заключение Галышевой: деятельность терминала не оказывает негативного воздействия на экосистему бухты. Промысловые виды в норме, подводные леса 70-98% покрытия.',
  'ДВФУ',
  'expert_opinion'
),
(
  'Экологические инвестиции АО Дальтрансуголь',
  'Компания инвестировала в экологические мероприятия с 2023 года: ветрозащитные экраны (25м × 2400м), системы пылеподавления, станция СКАТ. Общая сумма инвестиций: 2 047 545 642 рублей. Согласно п.14 Методики 87, затраты на предотвращение сверхнормативного воздействия могут быть вычтены из суммы вреда.',
  'Документы компании',
  'evidence'
),
(
  'Методика расчёта ущерба (Методика 87)',
  'Методика утверждена Минприроды. Коэффициент Кзагр=6 применяется при скоплении отходов >10 м² на 100 м² водной площади. При диффузном загрязнении (не очаговом) корректный Кзагр=1, что снижает расчёт в 6 раз. П.16 Методики предназначен для бытовых отходов, а не промышленной пыли.',
  'Минприроды',
  'law'
),
(
  'Нормативы выбросов угольной пыли',
  'Проверка РПН: превышений нормативов выбросов угольной пыли не установлено. Пробы воздуха показали концентрации 0,023-0,033 мг/м³ при ПДК 0,3 мг/м³ (в 10 раз ниже нормы). ДТУ платит за негативное воздействие на окружающую среду по выбросам угольной пыли.',
  'Росприроднадзор',
  'evidence'
);
*/

-- =====================================================
-- Таблица для ссылок на документы (раздел "Документы")
-- Хранит метаданные документов для отображения в UI
-- =====================================================
CREATE TABLE IF NOT EXISTS document_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'link', -- 'link' или 'file'
  file_name TEXT, -- имя файла в Supabase Storage (для type='file')
  original_name TEXT, -- оригинальное имя файла
  file_size INTEGER, -- размер файла в байтах
  storage TEXT DEFAULT 'external', -- 'supabase' или 'external'
  is_default BOOLEAN DEFAULT false, -- документы по умолчанию
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS document_links_created_idx ON document_links(created_at DESC);

-- RLS политики
ALTER TABLE document_links ENABLE ROW LEVEL SECURITY;

-- Все могут читать
CREATE POLICY "Document links are viewable by everyone" ON document_links
  FOR SELECT USING (true);

-- Все могут добавлять (проверка пароля на уровне API)
CREATE POLICY "Anyone can insert document links" ON document_links
  FOR INSERT WITH CHECK (true);

-- Все могут удалять (проверка пароля на уровне API)
CREATE POLICY "Anyone can delete document links" ON document_links
  FOR DELETE USING (true);

-- Документы по умолчанию
INSERT INTO document_links (title, description, url, type, is_default) VALUES
(
  'Справка о споре РПН - ДТУ на 23.12.2025',
  'Google Документ',
  'https://docs.google.com/document/d/1IpoDPWQt_rzvd8tXr3yG_7bxQQqtQepi/edit?usp=drive_link&ouid=100981517467924755686&rtpof=true&sd=true',
  'link',
  true
),
(
  'Таймлайн дела',
  'Google Документ',
  'https://docs.google.com/document/d/1D92lJRMqVtFQ96VA-7X2DTsjjhOx9HCS/edit?usp=drive_link&ouid=100981517467924755686&rtpof=true&sd=true',
  'link',
  true
)
ON CONFLICT DO NOTHING;
