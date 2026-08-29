// دالة خادم (Vercel Serverless Function) — تستدعي Gemini API من جهة الخادم
// بحيث لا يظهر مفتاح API أبداً في متصفح المستخدم.
// يجب ضبط متغيّر البيئة GEMINI_API_KEY في إعدادات مشروع Vercel (وليس هنا في الكود).

// ⚠️ ملاحظة: هذا الإعداد لا يرفع الحد الحقيقي لحجم الطلب على خوادم Vercel،
// فذلك حد صارم على مستوى البنية التحتية (4.5MB) لا يمكن تغييره من الكود إطلاقاً.
// إبقاء هذا الإعداد هنا فقط لتوثيق الحد الأقصى العملي المتوقع من الواجهة الأمامية.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4mb'
    }
  }
};

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
  const { systemPrompt, userPrompt, attachment } = req.body || {};
  if (!userPrompt) {
    return res.status(400).json({ message: 'userPrompt مفقود' });
  }

  // إن أرفق المعلم ملف PDF (صفحات من الكتاب المدرسي)، نبنيه كجزء إضافي من
  // المُدخل (parts) حتى يقرأه Gemini فعلياً بجانب النص، لا كنص شكلي فقط
  const userParts = [{ text: userPrompt }];
  if (attachment && attachment.base64 && attachment.mimeType) {
    userParts.push({
      inline_data: {
        mime_type: attachment.mimeType,
        data: attachment.base64
      }
    });
  }

  const callGemini = (modelName) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: userParts }],
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
        if (r.status === 400 && /inline_data|mime|payload|too large/i.test(lastErrorBody.message || '')) {
          return res.status(400).json({ message: 'تعذّر معالجة الملف المرفق. جرّب ملفاً أصغر أو صفحات أقل من الكتاب.' });
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
