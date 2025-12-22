import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Braesecke1973';

// Промпт для распознавания документа (одна страница или изображение)
const RECOGNITION_PROMPT_SINGLE = `Ты — система распознавания юридических документов. Проанализируй изображение документа и извлеки информацию.

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
- судебный_акт (решения, определения, постановления суда)
- процессуальный_документ (иск, отзыв, пояснения, ходатайства)
- нормативный_акт
- отчет (отчёт, мониторинг)
- справка_ии (юридическая справка от ИИ)
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

// Промпт для многостраничного PDF
const RECOGNITION_PROMPT_MULTI = `Ты — система распознавания юридических документов. Тебе предоставлены ВСЕ страницы PDF-документа. Проанализируй их и извлеки информацию.

ЗАДАЧА:
1. Распознай весь текст со ВСЕХ страниц документа (OCR)
2. Объедини текст в единый связный документ
3. Определи тип/категорию документа
4. Предложи название документа
5. Определи источник (если указан)

КАТЕГОРИИ (выбери одну):
- договор
- акт
- переписка
- заключение (экспертное заключение)
- судебный_акт (решения, определения, постановления суда)
- процессуальный_документ (иск, отзыв, пояснения, ходатайства)
- нормативный_акт
- отчет (отчёт, мониторинг)
- справка_ии (юридическая справка от ИИ)
- документ (если не подходит ни одна)

ВАЖНО:
- Распознай текст со ВСЕХ страниц, не пропускай ни одной
- Сохраняй порядок страниц
- Если текст на русском — сохрани русский язык
- Если есть таблицы — преобразуй в читаемый текст
- Номера, даты, суммы распознавай особенно внимательно
- Между страницами можешь добавить разделитель если это улучшит читаемость

Ответь СТРОГО в формате JSON:
{
  "title": "Краткое название документа",
  "category": "категория_из_списка",
  "source": "источник или название файла",
  "content": "Полный распознанный текст документа со ВСЕХ страниц..."
}

Ответь ТОЛЬКО JSON, без markdown и пояснений.`;

// Промпт для анализа текстового документа (MD, TXT)
const TEXT_ANALYSIS_PROMPT = `Проанализируй этот текстовый документ и извлеки метаданные.

ЗАДАЧА:
1. Определи тип/категорию документа
2. Предложи краткое название документа
3. Определи источник (если указан в тексте)

КАТЕГОРИИ (выбери одну):
- договор
- акт
- переписка
- заключение (экспертное заключение)
- судебный_акт (решения, определения, постановления суда)
- процессуальный_документ (иск, отзыв, пояснения, ходатайства)
- нормативный_акт
- отчет (отчёт, мониторинг)
- справка_ии (юридическая справка от ИИ)
- документ (если не подходит ни одна)

Ответь СТРОГО в формате JSON:
{
  "title": "Краткое название документа",
  "category": "категория_из_списка",
  "source": "источник или название файла"
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
    const { password, image, images, mediaType, fileName, textContent, fileType } = req.body;

    // Проверка пароля
    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Неверный пароль' });
    }

    let result;

    // Обработка текстовых файлов (MD, TXT)
    if (fileType === 'text' && textContent) {
      result = await processTextDocument(textContent, fileName);
    }
    // Обработка многостраничного PDF (массив изображений)
    else if (images && Array.isArray(images) && images.length > 0) {
      result = await processMultiPageDocument(images, fileName);
    }
    // Обработка одиночного изображения
    else if (image) {
      result = await processSingleImage(image, mediaType, fileName);
    }
    else {
      return res.status(400).json({ error: 'Не предоставлены данные для распознавания' });
    }

    return res.status(200).json({
      success: true,
      ...result,
    });

  } catch (error) {
    console.error('Recognition error:', error);

    return res.status(500).json({
      error: 'Ошибка распознавания документа',
      details: error.message,
    });
  }
}

// Обработка одиночного изображения
async function processSingleImage(image, mediaType, fileName) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const prompt = RECOGNITION_PROMPT_SINGLE + (fileName ? `\n\nИмя файла: ${fileName}` : '');

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: mediaType || 'image/jpeg',
        data: image
      }
    }
  ]);

  const response = await result.response;
  return parseResponse(response.text(), fileName);
}

// Обработка многостраничного документа
async function processMultiPageDocument(images, fileName) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  // Формируем контент с всеми страницами
  const parts = [];

  // Добавляем промпт
  parts.push(RECOGNITION_PROMPT_MULTI + `\n\nВсего страниц: ${images.length}` + (fileName ? `\nИмя файла: ${fileName}` : ''));

  // Добавляем все изображения страниц
  images.forEach((img, index) => {
    parts.push({
      inlineData: {
        mimeType: img.mediaType || 'image/png',
        data: img.data
      }
    });
  });

  const result = await model.generateContent(parts);
  const response = await result.response;

  return parseResponse(response.text(), fileName);
}

// Обработка текстового документа
async function processTextDocument(textContent, fileName) {
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const prompt = TEXT_ANALYSIS_PROMPT + `\n\nИмя файла: ${fileName}\n\nТекст документа:\n${textContent.substring(0, 5000)}`;

  const result = await model.generateContent(prompt);
  const response = await result.response;
  const metadata = parseResponse(response.text(), fileName);

  // Возвращаем оригинальный текст с метаданными
  return {
    title: metadata.title || fileName.replace(/\.(md|txt)$/i, ''),
    category: metadata.category || 'документ',
    source: metadata.source || fileName,
    content: textContent,
  };
}

// Парсинг ответа Gemini
function parseResponse(responseText, fileName) {
  try {
    // Убираем возможные markdown-обёртки
    const jsonStr = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (parseError) {
    console.error('JSON parse error:', parseError);
    // Если не удалось распарсить, возвращаем текст как есть
    return {
      title: fileName || 'Документ',
      category: 'документ',
      source: fileName || '',
      content: responseText,
    };
  }
}
