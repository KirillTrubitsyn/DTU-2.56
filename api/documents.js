import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Пароль администратора
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Braesecke1973';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - получить документы
  if (req.method === 'GET') {
    const { password, page, limit, category } = req.query;

    // Если есть password, page, limit — это запрос к RAG базе знаний (таблица documents)
    if (password && page && limit) {
      // Проверка пароля для RAG
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      try {
        const pageNum = parseInt(page) || 1;
        const limitNum = parseInt(limit) || 20;
        const offset = (pageNum - 1) * limitNum;

        // Build query for RAG documents table
        let query = supabase
          .from('documents')
          .select('*', { count: 'exact' });

        // Apply category filter if not 'all'
        if (category && category !== 'all') {
          query = query.eq('category', category);
        }

        // Apply pagination and ordering
        query = query
          .order('created_at', { ascending: false })
          .range(offset, offset + limitNum - 1);

        const { data, error, count } = await query;

        if (error) {
          console.error('Fetch RAG documents error:', error);
          throw error;
        }

        return res.status(200).json({
          documents: data || [],
          total: count || 0,
          page: pageNum,
          limit: limitNum
        });

      } catch (error) {
        console.error('Get RAG documents error:', error);
        return res.status(500).json({
          error: 'Ошибка загрузки документов',
          details: error.message
        });
      }
    }

    // Без password — это запрос к пользовательским документам (таблица document_links)
    try {
      const { data, error } = await supabase
        .from('document_links')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Fetch user documents error:', error);
        throw error;
      }

      return res.status(200).json({ documents: data || [] });

    } catch (error) {
      console.error('Get user documents error:', error);
      return res.status(500).json({
        error: 'Ошибка загрузки документов',
        details: error.message
      });
    }
  }

  // POST - добавить документ
  if (req.method === 'POST') {
    try {
      const { password, title, content, source, category } = req.body;

      // Проверка пароля
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      // Если есть content — это RAG документ (таблица documents)
      if (content) {
        if (!title || !content) {
          return res.status(400).json({ error: 'Требуется название и содержимое документа' });
        }

        const { data, error } = await supabase
          .from('documents')
          .insert({
            title,
            content,
            source: source || '',
            category: category || 'документ'
          })
          .select()
          .single();

        if (error) {
          console.error('Insert RAG document error:', error);
          throw error;
        }

        console.log(`[RAG Documents] Added: "${title}"`);

        return res.status(200).json({
          success: true,
          message: 'Документ добавлен в базу знаний',
          document: data
        });
      }

      // Иначе это пользовательский документ (таблица document_links)
      const { description, url, type = 'link', fileName, originalName, fileSize, storage = 'external' } = req.body;

      if (!title || !url) {
        return res.status(400).json({ error: 'Требуется название и URL документа' });
      }

      const { data, error } = await supabase
        .from('document_links')
        .insert({
          title,
          description: description || '',
          url,
          type,
          file_name: fileName || null,
          original_name: originalName || null,
          file_size: fileSize || null,
          storage,
          is_default: false
        })
        .select()
        .single();

      if (error) {
        console.error('Insert user document error:', error);
        throw error;
      }

      console.log(`[User Documents] Added: "${title}"`);

      return res.status(200).json({
        success: true,
        message: 'Документ добавлен',
        document: data
      });

    } catch (error) {
      console.error('Add document error:', error);
      return res.status(500).json({
        error: 'Ошибка добавления документа',
        details: error.message
      });
    }
  }

  // DELETE - удалить документ
  if (req.method === 'DELETE') {
    try {
      const { password, id, deleteAll } = req.body;

      // Проверка пароля
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      // Удаление всех RAG документов
      if (deleteAll) {
        const { error, count } = await supabase
          .from('documents')
          .delete()
          .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

        if (error) {
          console.error('Delete all RAG documents error:', error);
          throw error;
        }

        console.log(`[RAG Documents] Deleted all`);

        return res.status(200).json({
          success: true,
          message: 'Все документы удалены',
          deletedCount: count
        });
      }

      if (!id) {
        return res.status(400).json({ error: 'Требуется ID документа' });
      }

      // Пробуем удалить из RAG таблицы documents
      const { data: ragDoc, error: ragCheckError } = await supabase
        .from('documents')
        .select('id')
        .eq('id', id)
        .single();

      if (ragDoc) {
        const { error } = await supabase
          .from('documents')
          .delete()
          .eq('id', id);

        if (error) throw error;

        console.log(`[RAG Documents] Deleted: ${id}`);

        return res.status(200).json({
          success: true,
          message: 'Документ удалён из базы знаний'
        });
      }

      // Пробуем удалить из user таблицы document_links
      const { data: userDoc } = await supabase
        .from('document_links')
        .select('file_name, storage')
        .eq('id', id)
        .single();

      if (userDoc) {
        // Удаляем файл из Supabase Storage если это загруженный файл
        if (userDoc.storage === 'supabase' && userDoc.file_name) {
          const { error: storageError } = await supabase.storage
            .from('documents')
            .remove([userDoc.file_name]);

          if (storageError) {
            console.error('Storage delete error:', storageError);
          }
        }

        const { error } = await supabase
          .from('document_links')
          .delete()
          .eq('id', id);

        if (error) throw error;

        console.log(`[User Documents] Deleted: ${id}`);

        return res.status(200).json({
          success: true,
          message: 'Документ удалён'
        });
      }

      return res.status(404).json({ error: 'Документ не найден' });

    } catch (error) {
      console.error('Delete document error:', error);
      return res.status(500).json({
        error: 'Ошибка удаления документа',
        details: error.message
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
