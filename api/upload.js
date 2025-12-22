import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Пароль администратора (в production лучше хранить в env)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Braesecke1973';

// Получение embedding через Supabase Edge Function
async function getEmbedding(text) {
  try {
    const { data, error } = await supabase.functions.invoke('embed', {
      body: { text }
    });

    if (error) throw error;
    return data.embedding;
  } catch (error) {
    console.error('Embedding error:', error);
    return null;
  }
}

// Разбиение текста на чанки
function splitIntoChunks(text, maxLength = 1500) {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length > maxLength && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { password, title, content, source, category } = req.body;

    // Проверка пароля
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }

    // Валидация
    if (!title || !content) {
      return res.status(400).json({ error: 'Требуется название и содержимое документа' });
    }

    // Разбиваем на чанки если текст большой
    const chunks = splitIntoChunks(content);
    const results = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunkTitle = chunks.length > 1 ? `${title} (часть ${i + 1})` : title;
      const chunkContent = chunks[i];

      // Получаем embedding
      const embedding = await getEmbedding(chunkContent);

      // Вставляем в базу
      const { data, error } = await supabase
        .from('documents')
        .insert({
          title: chunkTitle,
          content: chunkContent,
          source: source || title,
          category: category || 'документ',
          embedding: embedding
        })
        .select('id, title')
        .single();

      if (error) {
        console.error('Insert error:', error);
        throw error;
      }

      results.push(data);
    }

    return res.status(200).json({
      success: true,
      message: `Загружено ${results.length} документ(ов)`,
      documents: results
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({
      error: 'Ошибка загрузки документа',
      details: error.message
    });
  }
}
