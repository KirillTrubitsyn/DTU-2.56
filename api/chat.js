import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Initialize clients
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// System prompt with built-in case knowledge + knowledge base
const SYSTEM_PROMPT = `Ты — юридический ИИ-помощник по делу № А73-19604/2025 (АО «Дальтрансуголь» против Приамурского МУ Росприроднадзора).

=== ВСТРОЕННЫЕ ЗНАНИЯ О ДЕЛЕ ===

СУТЬ ДЕЛА: Росприроднадзор взыскивает с ДТУ вред водному объекту (бухта Мучке) за загрязнение угольной пылью. Сумма иска: ~147 млн руб.

ЛИНИИ ЗАЩИТЫ (7 аргументов):

**АРГУМЕНТ 1 (сила 9/10) — Позиция КС РФ:**
Постановление КС № 56-П от 06.12.2024. Суд НЕ вправе ограничиваться установлением состава правонарушения. Обязан учитывать обстоятельства, исключающие или уменьшающие вред. Формальное применение методик недопустимо. В судах ещё не заявлялось. Практика: АС ЗСО 25.12.2024, АС ПО 28.02.2025.

**АРГУМЕНТ 2 (сила 8/10) — Отсутствие реального вреда:**
Мониторинг ДВФУ за 16 лет (2008-2024): здоровый бентос, нормальная фито/зоопланктон, ихтиофауна в норме. Видеосъёмка 2023: высокая продуктивность, нет заиления. Заключение Галышевой: «Деятельность терминала НЕ оказывает негативного воздействия на экосистему». Подводные леса 70-98% покрытия. Суды: не исследовали по существу.

**АРГУМЕНТ 3 (сила 6/10) — Зачёт экологических инвестиций:**
Инвестиции с 2023: 2 047 545 642 ₽. Ветрозащитные экраны 25м×2400м, системы пылеподавления, станция СКАТ. По п.14 Методики 87 затраты на предотвращение вычитаются из суммы вреда. Общий принцип: п.11 ст.16.3 ФЗ-7. В судах не заявлялось.

**АРГУМЕНТ 4 (сила 5/10) — Оспаривание методики:**
Кзагр=6 применяется при скоплении >10 м² на 100 м². Угольная пыль = диффузное загрязнение, не очаговое. Космоснимки: большая часть акватории НЕ покрыта. Корректный Кзагр=1. Суды отклонили: АС ХК 15.01.2025, 6 ААС 08.04.2025, АС ДВО 09.07.2025.

**АРГУМЕНТ 5 (сила 5/10) — Соблюдение нормативов выбросов:**
Проверка РПН: превышений не установлено. Пробы воздуха: 0,023-0,033 мг/м³ при ПДК 0,3 мг/м³. ДТУ платит НВОС за выбросы. РПН: плата НВОС за атмосферу, не за воду. Суды разграничили воздействие на атмосферу и воду.

**АРГУМЕНТ 6 (сила 4/10) — Квалификация угольной пыли:**
Угольная пыль в Перечне загрязняющих веществ п.37(1) для воздуха, не в ФККО как отход. Код 6 19 111 13 71 4 — для ТЭС/ТЭЦ, не терминалов. Суды: АС ХК 06.06.2024 — «пыль = отход по ст.1 ФЗ-89».

**АРГУМЕНТ 7 (сила 2/10) — Процедурные нарушения:**
Проверка согласована с ненадлежащей прокуратурой. РЕКОМЕНДАЦИЯ: ОТКАЗАТЬСЯ. Исчерпан во всех инстанциях.

СТРАТЕГИЯ:
★ ПРИОРИТЕТ: Линии 1-2 (КС 56-П + данные ДВФУ = отсутствие реального вреда)
● ПОДДЕРЖКА: Линии 3-6 (зачёт, методика, квалификация)
✗ ОТКАЗ: Линия 7 (процедурные нарушения)

=== ПРАВИЛА ОТВЕТА ===
ВАЖНО: У тебя ВСЕГДА есть информация о деле из ВСТРОЕННЫХ ЗНАНИЙ выше! Никогда не говори "база пуста" или "нет информации" если вопрос касается аргументов, стратегии или общих сведений о деле.

1. На вопросы об аргументах, стратегии, линиях защиты — ВСЕГДА отвечай из ВСТРОЕННЫХ ЗНАНИЙ
2. Документы из БАЗЫ ЗНАНИЙ — это дополнительные детали (тексты документов, точные цитаты)
3. Если база знаний пуста но вопрос об аргументах — отвечай из встроенных знаний
4. Говори "нет информации" ТОЛЬКО если вопрос требует конкретного документа которого нет
5. НЕ выдумывай факты, даты, номера документов
6. Отвечай на русском, кратко и по существу`;

// Function to get embeddings using Google or Supabase
async function getEmbedding(text) {
  try {
    // Use Google's embedding model
    const embeddingModel = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('Embedding error:', error);
    // Fallback to Supabase Edge Function
    try {
      const { data, error: sbError } = await supabase.functions.invoke('embed', {
        body: { text }
      });
      if (sbError) throw sbError;
      return data.embedding;
    } catch {
      return null;
    }
  }
}

// Hybrid search: combines vector similarity + keyword search + fallback
async function searchDocuments(query, limit = 8) {
  try {
    const embedding = await getEmbedding(query);
    let vectorResults = [];
    let keywordResults = [];
    let fallbackResults = [];

    // 1. Vector similarity search (if embedding available)
    if (embedding) {
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.3,  // Lowered to 0.3 for better recall
        match_count: limit
      });
      if (!error && data) {
        vectorResults = data;
      } else if (error) {
        console.log('Vector search error:', error.message);
      }
    }

    // 2. Keyword search (full-text search)
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('id, title, content, source')
        .textSearch('content', query, { type: 'websearch', config: 'russian' })
        .limit(limit);

      if (!error && data) {
        keywordResults = data;
      }
    } catch (e) {
      console.log('Keyword search failed:', e.message);
    }

    // 3. Fallback: simple ILIKE search if both above return nothing
    if (vectorResults.length === 0 && keywordResults.length === 0) {
      const searchTerms = query.split(' ').filter(t => t.length > 3).slice(0, 3);
      for (const term of searchTerms) {
        const { data, error } = await supabase
          .from('documents')
          .select('id, title, content, source')
          .or(`title.ilike.%${term}%,content.ilike.%${term}%`)
          .limit(limit);

        if (!error && data && data.length > 0) {
          fallbackResults = data;
          break;
        }
      }
    }

    // 4. Merge results (vector first, then keyword, then fallback)
    const seenIds = new Set();
    const merged = [];

    for (const doc of [...vectorResults, ...keywordResults, ...fallbackResults]) {
      if (!seenIds.has(doc.id)) {
        seenIds.add(doc.id);
        merged.push(doc);
      }
    }

    console.log(`Search: ${vectorResults.length} vector + ${keywordResults.length} keyword + ${fallbackResults.length} fallback = ${merged.length} total`);

    return merged.slice(0, limit);
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
}

// Format documents as context
function formatContext(documents) {
  if (!documents || documents.length === 0) {
    return '\n\n[ДОКУМЕНТЫ ИЗ БАЗЫ ЗНАНИЙ: не найдено релевантных документов]';
  }

  const context = documents.map((doc, i) =>
    `[Документ ${i + 1}: "${doc.title || 'Без названия'}"]\nИсточник: ${doc.source || 'не указан'}\nСодержание:\n${doc.content}`
  ).join('\n\n---\n\n');

  return `\n\n=== ДОКУМЕНТЫ ИЗ БАЗЫ ЗНАНИЙ (${documents.length} шт.) ===\n\n${context}\n\n=== КОНЕЦ ДОКУМЕНТОВ ===`;
}

// Convert history to Gemini format
function convertHistoryToGemini(history) {
  return history.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));
}

// Main handler
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
    const { message, history = [] } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Search for relevant documents
    const documents = await searchDocuments(message);
    const contextAddition = formatContext(documents);

    // Initialize Gemini model with system instruction
    const model = genAI.getGenerativeModel({
      model: 'gemini-3-pro-preview',
      systemInstruction: SYSTEM_PROMPT,
    });

    // Start chat with history
    const chat = model.startChat({
      history: convertHistoryToGemini(history),
    });

    // Send message with context
    const result = await chat.sendMessage(message + contextAddition);
    const response = await result.response;
    const assistantMessage = response.text();

    // Return response with sources
    return res.status(200).json({
      response: assistantMessage,
      sources: documents.map(d => d.title || d.source).filter(Boolean)
    });

  } catch (error) {
    console.error('Chat API error:', error);

    if (error.message?.includes('API_KEY')) {
      return res.status(500).json({ error: 'Invalid API key configuration' });
    }

    return res.status(500).json({
      error: 'Failed to generate response',
      details: error.message
    });
  }
}
