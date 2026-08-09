// Netlify Function: /.netlify/functions/chat
// Müştəri sualına salon haqqında canlı məlumatla (ustalar, xidmətlər, iş saatları) cavab verir.
// Groq API istifadə olunur (OpenAI-uyğun). GROQ_API_KEY mühit dəyişəni Netlify Dashboard-da
// gizli saxlanılır, heç vaxt brauzerə göndərilmir.

const SUPABASE_URL = 'https://pxmijumubqojaiapsect.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kP3Q0Ung7ScsFNP2y9KEeQ_mZO24Doj'; // index.html-dəki ilə eyni ictimai anon açar

async function getKV(key) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        }
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    return rows && rows[0] ? rows[0].value : null;
  } catch (e) {
    console.error('getKV failed', key, e);
    return null;
  }
}

const DAY_NAMES = {
  mon: 'Bazar ertəsi', tue: 'Çərşənbə axşamı', wed: 'Çərşənbə',
  thu: 'Cümə axşamı', fri: 'Cümə', sat: 'Şənbə', sun: 'Bazar'
};
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function formatServices(services) {
  if (!services || !services.length) return 'Xidmət məlumatı tapılmadı.';
  const berber = services.filter(s => s.cat === 'berber');
  const lazer = services.filter(s => s.cat === 'lazer');
  const line = s => `- ${s.name}: ${s.price} AZN, ${s.dur} dəqiqə`;
  let out = '';
  if (berber.length) out += 'Bərbər xidmətləri:\n' + berber.map(line).join('\n') + '\n';
  if (lazer.length) out += 'Lazer epilyasiya xidmətləri:\n' + lazer.map(line).join('\n');
  return out.trim();
}

function formatBarbers(barbers) {
  if (!barbers || !barbers.length) return 'Usta məlumatı tapılmadı.';
  return barbers.map(b => {
    const roles = [];
    if (b.doesBerber !== false) roles.push('bərbər xidmətləri');
    if (b.doesLaser) roles.push('lazer epilyasiya');
    const roleStr = roles.length ? roles.join(' + ') : 'heç bir xidmət təyin olunmayıb';
    const hoursStr = b.hours ? ' (bu ustanın öz xüsusi iş saatları var, aşağıda göstərilib)' : '';
    return `- ${b.name}: ${roleStr}${hoursStr}`;
  }).join('\n');
}

function formatBarberHours(barbers, defaultHours) {
  if (!barbers || !barbers.length) return '';
  const withCustom = barbers.filter(b => b.hours);
  if (!withCustom.length) return '';
  return withCustom.map(b => `${b.name}:\n${formatHours(b.hours)}`).join('\n\n');
}

function formatHours(hours) {
  if (!hours) return 'İş saatları məlumatı tapılmadı.';
  return DAY_ORDER.map(k => {
    const h = hours[k];
    if (!h || h.closed) return `- ${DAY_NAMES[k]}: bağlıdır`;
    return `- ${DAY_NAMES[k]}: ${h.open} - ${h.close}`;
  }).join('\n');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Yanlış sorğu formatı.' }) };
  }

  const userMessage = (body.message || '').toString().slice(0, 1000);
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

  if (!userMessage.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Mesaj boşdur.' }) };
  }

  if (!process.env.GROQ_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server tənzimlənməyib: GROQ_API_KEY Netlify-də əlavə olunmayıb.' })
    };
  }

  const [services, barbers, hours] = await Promise.all([
    getKV('services'),
    getKV('barbers'),
    getKV('hours')
  ]);

  const systemPrompt = `Sən RF Barber & Lazer salonunun sayt köməkçisisən. Müştərilərə salon, ustalar, xidmətlər, qiymətlər, iş saatları və rezervasiya haqqında Azərbaycan dilində qısa, səmimi və dəqiq cavab ver.

QAYDALAR:
- Yalnız aşağıdakı real məlumata əsaslan. Bilmədiyin və ya burada olmayan şeyi uydurma.
- Rezervasiya etmək istəyən müştəriyə: saytdakı "Rezervasiya" bölməsindən xidmət, usta, tarix və saat seçərək rezervasiya edə biləcəyini söylə (sən özün rezervasiya edə bilmirsən, sadəcə istiqamətləndirirsən).
- "Uşaq saç kəsimi" və "Keratin" xidmətləri yalnız Orxan tərəfindən edilir — başqa usta üçün bu xidmətlər seçimi görünməyəcək.
- Bərbər xidməti etməyən ustalar (yalnız lazer edən) adi saç kəsimi rezervasiyasında görünmür, yalnız lazer bölməsində seçilə bilər.
- Hər ustanın öz iş saatı ola bilər (aşağıda göstərilib); əgər ustanın xüsusi saatı yoxdursa, ümumi saatlarla işləyir.
- Cavabların qısa olsun (adətən 2-4 cümlə), lazım olmadıqca uzatma.
- Salonla əlaqəsi olmayan suallara nəzakətlə bildir ki, yalnız salon haqqında kömək edə bilərsən.

USTALAR:
${formatBarbers(barbers)}

XİDMƏTLƏR VƏ QİYMƏTLƏR:
${formatServices(services)}

ÜMUMİ İŞ SAATLARI (xüsusi saatı olmayan ustalar üçün):
${formatHours(hours)}
${formatBarberHours(barbers, hours) ? '\nXÜSUSİ USTA SAATLARI:\n' + formatBarberHours(barbers, hours) : ''}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'),
    { role: 'user', content: userMessage }
  ];

  try {
    const apiRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        max_tokens: 500,
        messages
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('Groq API error', apiRes.status, errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'Cavab alınmadı, bir az sonra yenidən cəhd edin.' }) };
    }

    const data = await apiRes.json();
    const reply = data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : 'Üzr istəyirəm, cavab hazırlaya bilmədim.';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply })
    };
  } catch (e) {
    console.error('chat function failed', e);
    return { statusCode: 500, body: JSON.stringify({ error: 'Server xətası.' }) };
  }
};
