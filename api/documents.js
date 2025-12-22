import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

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

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { password } = req.method === 'GET' ? req.query : req.body;

  // Проверка пароля
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }

  try {
    // GET - список документов
    if (req.method === 'GET') {
      const { category, page = 1, limit = 50 } = req.query;
      const offset = (parseInt(page) - 1) * parseInt(limit);

      // Получаем общее количество
      let countQuery = supabase
        .from('documents')
        .select('*', { count: 'exact', head: true });

      if (category && category !== 'all') {
        countQuery = countQuery.eq('category', category);
      }

      const { count } = await countQuery;

      // Получаем документы
      let query = supabase
        .from('documents')
        .select('id, title, source, category, created_at, content')
        .order('created_at', { ascending: false })
        .range(offset, offset + parseInt(limit) - 1);

      if (category && category !== 'all') {
        query = query.eq('category', category);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Получаем статистику по категориям
      const { data: allDocs } = await supabase
        .from('documents')
        .select('category');

      const categoryStats = {};
      if (allDocs) {
        allDocs.forEach(doc => {
          const cat = doc.category || 'документ';
          categoryStats[cat] = (categoryStats[cat] || 0) + 1;
        });
      }

      return res.status(200).json({
        documents: data || [],
        total: count || 0,
        page: parseInt(page),
        limit: parseInt(limit),
        categoryStats
      });
    }

    // PUT - обновление документа
    if (req.method === 'PUT') {
      const { id, title, content, source, category } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'ID документа обязателен' });
      }

      // Обновляем embedding если изменился контент
      let updateData = { title, source, category };
      if (content !== undefined) {
        updateData.content = content;
        const embedding = await getEmbedding(content);
        if (embedding) {
          updateData.embedding = embedding;
        }
      }

      const { data, error } = await supabase
        .from('documents')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return res.status(200).json({
        success: true,
        document: data
      });
    }

    // DELETE - удаление документа
    if (req.method === 'DELETE') {
      const { id } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'ID документа обязателен' });
      }

      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', id);

      if (error) throw error;

      return res.status(200).json({
        success: true,
        message: 'Документ удалён'
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Documents API error:', error);
    return res.status(500).json({
      error: 'Ошибка при работе с документами',
      details: error.message
    });
  }
}
