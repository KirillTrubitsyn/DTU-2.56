import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Пароль администратора
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Braesecke1973';

// Bucket name for document files
const BUCKET_NAME = 'documents';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - list files
  if (req.method === 'GET') {
    try {
      const { password } = req.query;

      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .list('', {
          limit: 100,
          sortBy: { column: 'created_at', order: 'desc' }
        });

      if (error) throw error;

      // Get public URLs for files
      const filesWithUrls = data.map(file => {
        const { data: urlData } = supabase.storage
          .from(BUCKET_NAME)
          .getPublicUrl(file.name);

        return {
          ...file,
          url: urlData.publicUrl
        };
      });

      return res.status(200).json({ files: filesWithUrls });

    } catch (error) {
      console.error('List files error:', error);
      return res.status(500).json({ error: 'Ошибка получения списка файлов' });
    }
  }

  // POST - upload file
  if (req.method === 'POST') {
    try {
      const { password, fileName, fileData, contentType, title, description } = req.body;

      // Check password
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      if (!fileName || !fileData) {
        return res.status(400).json({ error: 'Требуется имя файла и данные' });
      }

      // Decode base64 data
      const base64Data = fileData.split(',')[1] || fileData;
      const buffer = Buffer.from(base64Data, 'base64');

      // Generate unique filename
      const timestamp = Date.now();
      const safeName = fileName.replace(/[^a-zA-Z0-9а-яА-Я._-]/g, '_');
      const uniqueName = `${timestamp}_${safeName}`;

      // Upload to Supabase Storage
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .upload(uniqueName, buffer, {
          contentType: contentType || 'application/octet-stream',
          upsert: false
        });

      if (error) {
        console.error('Upload error:', error);
        throw error;
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(BUCKET_NAME)
        .getPublicUrl(uniqueName);

      console.log(`[Files] Uploaded: ${uniqueName}`);

      return res.status(200).json({
        success: true,
        message: 'Файл загружен',
        file: {
          name: uniqueName,
          originalName: fileName,
          url: urlData.publicUrl,
          title: title || fileName,
          description: description || '',
          size: buffer.length
        }
      });

    } catch (error) {
      console.error('Upload file error:', error);
      return res.status(500).json({
        error: 'Ошибка загрузки файла',
        details: error.message
      });
    }
  }

  // DELETE - remove file
  if (req.method === 'DELETE') {
    try {
      const { password, fileName } = req.body;

      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Неверный пароль' });
      }

      if (!fileName) {
        return res.status(400).json({ error: 'Требуется имя файла' });
      }

      const { error } = await supabase.storage
        .from(BUCKET_NAME)
        .remove([fileName]);

      if (error) throw error;

      console.log(`[Files] Deleted: ${fileName}`);

      return res.status(200).json({
        success: true,
        message: 'Файл удалён'
      });

    } catch (error) {
      console.error('Delete file error:', error);
      return res.status(500).json({ error: 'Ошибка удаления файла' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
