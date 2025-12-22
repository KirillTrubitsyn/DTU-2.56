import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Пароль администратора (в production лучше хранить в env)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Braesecke1973';

// Получение embedding через Google (та же модель что в chat.js)
async function getEmbedding(text) {
  try {
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('Embedding error:', error);
    return null;
  }
}

// Улучшенное разбиение текста на чанки с перекрытием
function splitIntoChunks(text, maxLength = 1000, overlap = 200) {
  // Для коротких текстов - возвращаем как есть
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLength;

    // Если это не конец текста, ищем границу предложения
    if (end < text.length) {
      // Ищем конец предложения (. ! ? или \n\n) в последних 30% чанка
      const searchStart = start + Math.floor(maxLength * 0.7);
      const searchArea = text.slice(searchStart, end);

      // Приоритет: конец абзаца > конец предложения
      let breakPoint = searchArea.lastIndexOf('\n\n');
      if (breakPoint === -1) {
        // Ищем конец предложения
        const sentenceEnders = ['. ', '.\n', '! ', '!\n', '? ', '?\n'];
        for (const ender of sentenceEnders) {
          const pos = searchArea.lastIndexOf(ender);
          if (pos > breakPoint) {
            breakPoint = pos + ender.length - 1;
          }
        }
      }

      if (breakPoint !== -1) {
        end = searchStart + breakPoint + 1;
      }
    }

    // Добавляем чанк
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    // Следующий чанк начинается с перекрытием
    // Но ищем начало предложения для чистого старта
    let nextStart = end - overlap;
    if (nextStart > start && nextStart < text.length) {
      // Ищем начало предложения после точки перекрытия
      const overlapArea = text.slice(nextStart, end);
      const sentenceStart = overlapArea.search(/[.!?]\s+[А-ЯA-Z]/);
      if (sentenceStart !== -1) {
        nextStart = nextStart + sentenceStart + 2; // После ". "
      }
    }

    start = Math.max(nextStart, end); // Защита от бесконечного цикла

    // Если остаток меньше overlap, просто берём его
    if (text.length - start < overlap) {
      const lastChunk = text.slice(start).trim();
      if (lastChunk && lastChunk.length > 50) { // Минимум 50 символов
        chunks.push(lastChunk);
      }
      break;
    }
  }

  console.log(`Chunking: ${text.length} chars → ${chunks.length} chunks`);
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
