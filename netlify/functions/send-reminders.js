// Netlify Scheduled Function: /.netlify/functions/send-reminders
// Hər gün avtomatik işə düşür, SABAHKI rezervasiyaları tapır və müştərilərə SMS xatırlatma göndərir.
// Cədvəl netlify.toml-da təyin olunub (gündə bir dəfə, Bakı vaxtı ilə axşam).

const SUPABASE_URL = 'https://pxmijumubqojaiapsect.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_kP3Q0Ung7ScsFNP2y9KEeQ_mZO24Doj'; // index.html-dəki ilə eyni ictimai anon açar

async function getKV(key) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows[0] ? rows[0].value : null;
}

async function setKV(key, value) {
  await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ value })
  });
}

function tomorrowDateStr() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

async function sendSms(toPhone, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const params = new URLSearchParams({ To: toPhone, From: from, Body: body });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twilio xətası (${res.status}): ${errText}`);
  }
}

exports.handler = async () => {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) {
    console.error('Twilio mühit dəyişənləri (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER) əlavə olunmayıb.');
    return { statusCode: 500, body: 'Twilio konfiqurasiya olunmayıb.' };
  }

  const bookings = (await getKV('bookings')) || [];
  const targetDate = tomorrowDateStr();
  const toRemind = bookings.filter(b => b.date === targetDate && !b.reminded);

  let sent = 0;
  let failed = 0;

  for (const b of toRemind) {
    const msg = `Salam ${b.name}! Sabah saat ${b.time} RF Barber & Lazer-da "${b.serviceName}" (${b.barberName}) üçün rezervasiyanız var. Gözləyirik!`;
    try {
      await sendSms(b.phone, msg);
      b.reminded = true;
      sent++;
    } catch (e) {
      console.error('SMS göndərilmədi:', b.phone, e.message);
      failed++;
    }
  }

  if (sent > 0) {
    await setKV('bookings', bookings);
  }

  console.log(`Xatırlatma tamamlandı: ${sent} göndərildi, ${failed} uğursuz, tarix: ${targetDate}`);
  return { statusCode: 200, body: JSON.stringify({ date: targetDate, sent, failed }) };
};
