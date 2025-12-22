import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Initialize clients
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// System prompt - generic, relies on knowledge base for case-specific info
const SYSTEM_PROMPT = `Ты — юридический ИИ-помощник по делу № А73-19604/2025 (АО «Дальтрансуголь» против Приамурского МУ Росприроднадзора).

ВАЖНЫЕ ПРАВИЛА:
1. Отвечай ТОЛЬКО на основе документов из базы знаний, которые тебе предоставлены
2. Если документы не предоставлены или в них нет ответа — честно скажи: "В базе знаний нет информации по этому вопросу"
3. НЕ выдумывай факты, даты, номера документов или суммы
4. Всегда указывай источник: "Согласно документу [название]..."
5. Отвечай на русском языке, кратко и по существу

Если пользователь спрашивает какие документы ты использовал — перечисли только те, что были переданы в разделе "ДОКУМЕНТЫ ИЗ БАЗЫ ЗНАНИЙ".`;

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

// Hybrid search: combines vector similarity + keyword search
async function searchDocuments(query, limit = 8) {
  try {
    const embedding = await getEmbedding(query);
    let vectorResults = [];
    let keywordResults = [];

    // 1. Vector similarity search (if embedding available)
    if (embedding) {
      const { data, error } = await supabase.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.5,  // Lowered from 0.7 for better recall
        match_count: limit
      });
      if (!error && data) {
        vectorResults = data;
      }
    }

    // 2. Keyword search (always run as supplement)
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
      // Keyword search failed, continue with vector results only
      console.log('Keyword search failed:', e.message);
    }

    // 3. Merge results (vector first, then keyword, deduplicated)
    const seenIds = new Set();
    const merged = [];

    // Add vector results first (higher priority)
    for (const doc of vectorResults) {
      if (!seenIds.has(doc.id)) {
        seenIds.add(doc.id);
        merged.push(doc);
      }
    }

    // Add keyword results that weren't in vector results
    for (const doc of keywordResults) {
      if (!seenIds.has(doc.id)) {
        seenIds.add(doc.id);
        merged.push(doc);
      }
    }

    console.log(`Search results: ${vectorResults.length} vector + ${keywordResults.length} keyword = ${merged.length} merged`);

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
      model: 'gemini-3-flash-preview',
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
