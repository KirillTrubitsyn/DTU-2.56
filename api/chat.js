import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// Initialize clients
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// System prompt - relies on app content and knowledge base
const SYSTEM_PROMPT = `Ты — юридический ИИ-помощник по делу № А73-19604/2025 (АО «Дальтрансуголь» против Приамурского МУ Росприроднадзора).

СУТЬ ДЕЛА: Росприроднадзор взыскивает с ДТУ вред водному объекту (бухта Мучке) за загрязнение угольной пылью. Сумма иска: ~147 млн руб.

=== ИСТОЧНИКИ ИНФОРМАЦИИ (приоритет) ===

1. СОДЕРЖАНИЕ ПРИЛОЖЕНИЯ — пользователь имеет доступ к вкладкам:
   • «Хронология дела» — все ключевые события и документы в хронологическом порядке
   • «Стратегия защиты» — структурированный анализ аргументов с оценкой силы

   При необходимости направляй пользователя к соответствующей вкладке приложения для детального изучения.

2. ДОКУМЕНТЫ ИЗ БАЗЫ ЗНАНИЙ — дополнительный источник. Используй найденные документы для уточнения деталей, цитат, точных формулировок.

3. ВНЕШНИЕ ИСТОЧНИКИ — используй только если вопрос выходит за рамки дела (общие юридические понятия, актуальная судебная практика, законодательство).

=== ПРАВИЛА ОТВЕТА ===

1. Отвечай опираясь на информацию из вкладок «Хронология дела» и «Стратегия защиты»
2. Используй ДОКУМЕНТЫ ИЗ БАЗЫ ЗНАНИЙ для уточнения деталей и цитат
3. НЕ выдумывай факты, даты, номера документов
4. Если вопрос требует конкретного документа которого нет в базе — честно скажи об этом
5. Отвечай на русском, кратко и по существу
6. При ответах о стратегии и аргументах опирайся на документы, а не на предположения`;

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
async function searchDocuments(query, limit = 12) {
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
    const { message, history = [], appContext = '', webSearch = false, thinkLonger = false } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Search for relevant documents
    const documents = await searchDocuments(message);
    const knowledgeBaseContext = formatContext(documents);

    // Build full context: app content first, then knowledge base
    let fullContext = '';
    if (appContext) {
      fullContext += `\n\n=== СОДЕРЖАНИЕ ПРИЛОЖЕНИЯ ===\n${appContext}`;
    }
    fullContext += knowledgeBaseContext;

    // Model configuration
    const modelConfig = {
      model: 'gemini-3-pro-preview',
      systemInstruction: SYSTEM_PROMPT,
    };

    // Enable extended thinking mode for more detailed analysis
    if (thinkLonger) {
      modelConfig.generationConfig = {
        thinkingConfig: {
          thinkingBudget: 8192 // Extended thinking budget for deeper analysis
        }
      };
    }

    // Add Google Search grounding if web search is enabled
    if (webSearch) {
      modelConfig.tools = [{
        googleSearch: {}
      }];
    }

    // Initialize Gemini model
    const model = genAI.getGenerativeModel(modelConfig);

    // Start chat with history
    const chat = model.startChat({
      history: convertHistoryToGemini(history),
    });

    // Send message with context
    const result = await chat.sendMessage(message + fullContext);
    const response = await result.response;
    const assistantMessage = response.text();

    // Extract web search sources if available
    let webSources = [];
    if (webSearch && response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
      webSources = response.candidates[0].groundingMetadata.groundingChunks
        .filter(chunk => chunk.web)
        .map(chunk => ({
          title: chunk.web.title || 'Веб-источник',
          url: chunk.web.uri
        }));
    }

    // Return response with sources
    return res.status(200).json({
      response: assistantMessage,
      sources: documents.map(d => d.title || d.source).filter(Boolean),
      webSources: webSources
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
