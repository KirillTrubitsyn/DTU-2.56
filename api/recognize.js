import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Braesecke1973';

// Промпт для распознавания документа
const RECOGNITION_PROMPT = `Ты — система распознавания юридических документов. Проанализируй изображение документа и извлеки информацию.

ЗАДАЧА:
1. Распознай весь текст документа (OCR)
2. Определи тип/категорию документа
3. Предложи название документа
4. Определи источник (если указан)

КАТЕГОРИИ (выбери одну):
- договор
- акт
- переписка
- заключение (экспертное заключение)
- судебный_акт
- нормативный_акт
- отчет (отчёт, мониторинг)
- документ (если не подходит ни одна)

ВАЖНО:
- Распознай текст максимально точно, сохраняя структуру
- Если текст на русском — сохрани русский язык
- Если есть таблицы — преобразуй в читаемый текст
- Номера, даты, суммы распознавай особенно внимательно

Ответь СТРОГО в формате JSON:
{
  "title": "Краткое название документа",
  "category": "категория_из_списка",
  "source": "источник или название файла",
  "content": "Полный распознанный текст документа..."
}

Ответь ТОЛЬКО JSON, без markdown и пояснений.`;

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
    const { password, image, mediaType, fileName } = req.body;

    // Проверка пароля
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }

    // Валидация
    if (!image) {
      return res.status(400).json({ error: 'Изображение не предоставлено' });
    }

    // Вызов Claude Vision API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType || 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: RECOGNITION_PROMPT + (fileName ? `\n\nИмя файла: ${fileName}` : ''),
            },
          ],
        },
      ],
    });

    // Извлекаем текст ответа
    const responseText = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    // Парсим JSON
    let result;
    try {
      // Убираем возможные markdown-обёртки
      const jsonStr = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // Если не удалось распарсить, возвращаем текст как есть
      result = {
        title: fileName || 'Документ',
        category: 'документ',
        source: fileName || '',
        content: responseText,
      };
    }

    return res.status(200).json({
      success: true,
      ...result,
    });

  } catch (error) {
    console.error('Recognition error:', error);

    if (error.status === 401) {
      return res.status(500).json({ error: 'Ошибка API ключа' });
    }

    return res.status(500).json({
      error: 'Ошибка распознавания документа',
      details: error.message,
    });
  }
}
