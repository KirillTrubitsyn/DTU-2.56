import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Initialize clients
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// System prompt with case context
const SYSTEM_PROMPT = `Ты — юридический ИИ-помощник, специализирующийся на деле № А73-19604/2025 АО «Дальтрансуголь» против Приамурского МУ Росприроднадзора.

КОНТЕКСТ ДЕЛА:
- Компания: АО «Дальтрансуголь» (угольный терминал)
- Истец: Приамурское МУ Росприроднадзора
- Сумма иска: 2 562 113 054,91 ₽
- Суть: возмещение вреда за загрязнение водного объекта (бухта Мучке) угольной пылью

ОСНОВНЫЕ ЛИНИИ ЗАЩИТЫ (по силе):
1. [9/10] Постановление КС РФ № 56-П от 06.12.2024 — суд обязан учитывать фактический вред, не формально применять методики
2. [8/10] Данные мониторинга ДВФУ 2008-2024 — отсутствие реального экологического вреда
3. [6/10] Зачёт экологических инвестиций (2 047 545 642 ₽) — п.14 Методики 87
4. [5/10] Оспаривание коэффициента Кзагр (6 → 1) — диффузное загрязнение
5. [5/10] Соблюдение нормативов выбросов — концентрации в 10× ниже ПДК
6. [4/10] Квалификация угольной пыли — выброс ≠ отход
7. [2/10] Процедурные нарушения — НЕ РЕКОМЕНДУЕТСЯ использовать

ВАЖНО:
- Отвечай на русском языке
- Давай конкретные ссылки на документы и судебные акты
- Если информация из контекста — укажи источник
- Если не знаешь точного ответа — скажи об этом честно
- Будь кратким, но информативным`;

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

// Function to search relevant documents in Supabase
async function searchDocuments(query, limit = 5) {
  try {
    const embedding = await getEmbedding(query);

    if (!embedding) {
      // Fallback: simple text search if embeddings fail
      const { data, error } = await supabase
        .from('documents')
        .select('id, title, content, source')
        .textSearch('content', query, { type: 'websearch', config: 'russian' })
        .limit(limit);

      if (error) throw error;
      return data || [];
    }

    // Vector similarity search
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: 0.7,
      match_count: limit
    });

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
}

// Format documents as context
function formatContext(documents) {
  if (!documents || documents.length === 0) {
    return '';
  }

  const context = documents.map((doc, i) =>
    `[Документ ${i + 1}: ${doc.title || 'Без названия'}]\n${doc.content}`
  ).join('\n\n---\n\n');

  return `\n\nРЕЛЕВАНТНЫЕ ДОКУМЕНТЫ ИЗ БАЗЫ:\n${context}`;
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
      model: 'gemini-1.5-pro',
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
