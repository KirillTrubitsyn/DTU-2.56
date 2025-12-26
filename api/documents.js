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

  // GET - получить все документы
  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('document_links')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Fetch documents error:', error);
        throw error;
      }

      return res.status(200).json({ documents: data || [] });

    } catch (error) {
      console.error('Get documents error:', error);
      return res.status(500).json({
        error: 'Ошибка загрузки документов',
        details: error.message
      });
    }
  }

  // POST - добавить документ
  if (req.method === 'POST') {
    try {
      const {
        password,
        title,
        description,
        url,
        type = 'link',
        fileName,
        originalName,
        fileSize,
        storage = 'external'
      } = req.body;

      // Проверка пароля
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      // Валидация
      if (!title || !url) {
        return res.status(400).json({ error: 'Требуется название и URL документа' });
      }

      // Вставка в базу
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
        console.error('Insert document error:', error);
        throw error;
      }

      console.log(`[Documents] Added: "${title}"`);

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
      const { password, id } = req.body;

      // Проверка пароля
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      if (!id) {
        return res.status(400).json({ error: 'Требуется ID документа' });
      }

      // Получаем документ для проверки файла в storage
      const { data: doc } = await supabase
        .from('document_links')
        .select('file_name, storage')
        .eq('id', id)
        .single();

      // Удаляем файл из Supabase Storage если это загруженный файл
      if (doc?.storage === 'supabase' && doc?.file_name) {
        const { error: storageError } = await supabase.storage
          .from('documents')
          .remove([doc.file_name]);

        if (storageError) {
          console.error('Storage delete error:', storageError);
        }
      }

      // Удаляем запись из базы
      const { error } = await supabase
        .from('document_links')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Delete document error:', error);
        throw error;
      }

      console.log(`[Documents] Deleted: ${id}`);

      return res.status(200).json({
        success: true,
        message: 'Документ удалён'
      });

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
