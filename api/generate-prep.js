// دالة خادم (Vercel Serverless Function) — تستدعي Gemini API من جهة الخادم
// بحيث لا يظهر مفتاح API أبداً في متصفح المستخدم.
// يجب ضبط متغيّر البيئة GEMINI_API_KEY في إعدادات مشروع Vercel (وليس هنا في الكود).

const MODEL_CANDIDATES = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      message: 'GEMINI_API_KEY غير مضبوط على الخادم. أضِفه من إعدادات المشروع في Vercel (Environment Variables).'
    });
  }

  const { systemPrompt, userPrompt } = req.body || {};
  if (!userPrompt) {
    return res.status(400).json({ message: 'userPrompt مفقود' });
  }

  const callGemini = (modelName) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: 8192
        }
      })
    });

  let lastErrorBody = { message: 'تعذّر الوصول لأي نموذج من نماذج Gemini' };
  let lastStatus = 502;

  for (const modelName of MODEL_CANDIDATES) {
    try {
      const r = await callGemini(modelName);

      if (r.status === 404) {
        lastStatus = 404;
        lastErrorBody = { message: `النموذج ${modelName} غير متاح حالياً` };
        continue; // جرّب النموذج التالي
      }

      const data = await r.json();

      if (!r.ok) {
        lastStatus = r.status;
        lastErrorBody = { message: data?.error?.message || `فشل الاتصال بـ Gemini (رمز الحالة ${r.status})` };
        if (r.status === 429) {
          return res.status(429).json({ message: 'تم بلوغ الحد الأقصى المؤقت لطلبات Gemini في الدقيقة الحالية.' });
        }
        continue;
      }

      // نرجّع بنفس الشكل الأصلي لرد Gemini حتى لا نحتاج نغيّر منطق القراءة بالواجهة
      return res.status(200).json(data);
    } catch (error) {
      lastErrorBody = { message: error.message || 'خطأ غير متوقع أثناء الاتصال بـ Gemini' };
      lastStatus = 500;
    }
  }

  return res.status(lastStatus).json(lastErrorBody);
}
