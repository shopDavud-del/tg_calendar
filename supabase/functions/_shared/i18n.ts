// Язык сообщений бота. Тексты в коде написаны по-русски; для остальных языков они заменяются по словарю
// (самые длинные фразы первыми) плюс правила для чисел («за 30 мин»). Непереведённое остаётся по-русски.
export const LANGS = ["ru", "en", "uz", "de", "ja", "tr"] as const;
export type Lang = typeof LANGS[number];
export const LOCALE: Record<Lang, string> = { ru: "ru-RU", en: "en-GB", uz: "uz-UZ", de: "de-DE", ja: "ja-JP", tr: "tr-TR" };
export const LANG_NAMES: Record<Lang, string> = { ru: "Русский", en: "English", uz: "Oʻzbekcha", de: "Deutsch", ja: "日本語", tr: "Türkçe" };
// Язык запроса хранится в AsyncLocalStorage (разные запросы не мешают друг другу). Если среда его не поддерживает — запасной вариант.
// deno-lint-ignore no-explicit-any
let als: any = null;
try { const m = await import("node:async_hooks"); als = new m.AsyncLocalStorage(); } catch (_e) { als = null; }
let fallback: Lang = "ru";
export const asLang = (l: unknown): Lang => (LANGS as readonly string[]).includes(String(l)) ? (l as Lang) : "ru";
export const withLang = <T>(lang: Lang, fn: () => T): T => { if (als) return als.run({ lang }, fn); fallback = lang; return fn(); };
export const getLang = (): Lang => (als ? als.getStore()?.lang : fallback) ?? "ru";
export const locale = () => LOCALE[getLang()];
/** Язык по коду Telegram (language_code) */
export const fromTelegram = (code?: string): Lang => { const c = (code ?? "").slice(0, 2).toLowerCase(); return (LANGS as readonly string[]).includes(c) ? (c as Lang) : "ru"; };

const IDX: Record<string, number> = { en: 0, uz: 1, de: 2, ja: 3, tr: 4 };
// ru: [en, uz, de, ja, tr]
const D: Record<string, string[]> = {
  "Добавлено": ["Added", "Qo'shildi", "Hinzugefügt", "追加しました", "Eklendi"],
  "Запись для": ["Appointment for", "Yozuv:", "Termin für", "予約：", "Randevu:"],
  "Вам назначена запись": ["An appointment was assigned to you", "Sizga yozuv tayinlandi", "Ihnen wurde ein Termin zugewiesen", "予約が割り当てられました", "Size bir randevu atandı"],
  "Назначил(а)": ["Assigned by", "Tayinladi", "Zugewiesen von", "担当者", "Atayan"],
  "Отменить": ["Cancel", "Bekor qilish", "Rückgängig", "取り消す", "İptal"],
  "Событие отменено": ["Event cancelled", "Tadbir bekor qilindi", "Termin storniert", "予定を取り消しました", "Etkinlik iptal edildi"],
  "Событие удалено": ["Event deleted", "Tadbir o'chirildi", "Termin gelöscht", "予定を削除しました", "Etkinlik silindi"],
  "Открыть календарь": ["Open calendar", "Kalendarni ochish", "Kalender öffnen", "カレンダーを開く", "Takvimi aç"],
  "Календарь в Telegram": ["Calendar in Telegram", "Telegramdagi kalendar", "Kalender in Telegram", "Telegramカレンダー", "Telegram'da takvim"],
  "Пишите события обычными словами, я запомню и напомню вовремя.": ["Write events in plain words, I'll save them and remind you on time.", "Tadbirlarni oddiy so'zlar bilan yozing, men eslab qolaman va o'z vaqtida eslataman.", "Schreiben Sie Termine in einfachen Worten – ich merke sie mir und erinnere rechtzeitig.", "普通の言葉で予定を書いてください。覚えて、時間通りにお知らせします。", "Etkinlikleri sade kelimelerle yazın, kaydedip zamanında hatırlatırım."],
  "Попробуйте прямо сейчас:": ["Try it right now:", "Hoziroq sinab ko'ring:", "Probieren Sie es jetzt:", "今すぐ試してみましょう：", "Hemen deneyin:"],
  "Как пользоваться": ["How to use", "Qanday foydalanish", "So funktioniert's", "使い方", "Nasıl kullanılır"],
  "Это время уже занято": ["This time is already taken", "Bu vaqt band", "Diese Zeit ist bereits belegt", "この時間はすでに埋まっています", "Bu saat dolu"],
  "Записать всё равно?": ["Book it anyway?", "Baribir yozaymi?", "Trotzdem eintragen?", "それでも登録しますか？", "Yine de kaydedilsin mi?"],
  "Да, записать": ["Yes, book it", "Ha, yozish", "Ja, eintragen", "はい、登録", "Evet, kaydet"],
  "✅ Да": ["✅ Yes", "✅ Ha", "✅ Ja", "✅ はい", "✅ Evet"],
  "✖️ Нет": ["✖️ No", "✖️ Yo'q", "✖️ Nein", "✖️ いいえ", "✖️ Hayır"],
  "Хорошо, не добавляю.": ["OK, not adding it.", "Xo'p, qo'shmayman.", "OK, ich füge es nicht hinzu.", "追加しません。", "Tamam, eklemiyorum."],
  "Не нашёл дату": ["I couldn't find a date", "Sana topilmadi", "Ich habe kein Datum gefunden", "日付が見つかりません", "Tarih bulamadım"],
  "Не понял 🤔 Начните со слова-команды и укажите дату:": ["Didn't get that 🤔 Start with a command word and add a date:", "Tushunmadim 🤔 Buyruq so'zidan boshlang va sanani yozing:", "Nicht verstanden 🤔 Beginnen Sie mit einem Befehlswort und geben Sie ein Datum an:", "分かりませんでした 🤔 コマンドの単語で始め、日付を入れてください：", "Anlamadım 🤔 Bir komut kelimesiyle başlayıp tarih yazın:"],
  "Через": ["In", "", "In", "", ""], "Сегодня": ["Today", "Bugun", "Heute", "今日", "Bugün"], "Сейчас": ["Now", "Hozir", "Jetzt", "今", "Şimdi"],
  "Напоминание": ["Reminder", "Eslatma", "Erinnerung", "リマインダー", "Hatırlatma"],
  "Завтра": ["Tomorrow", "Ertaga", "Morgen", "明日", "Yarın"],
  "весь день": ["all day", "kun bo'yi", "ganztägig", "終日", "tüm gün"],
  "без напоминания": ["no reminder", "eslatmasiz", "keine Erinnerung", "通知なし", "hatırlatmasız"],
  "✓ Готово": ["✓ Done", "✓ Tayyor", "✓ Erledigt", "✓ 完了", "✓ Tamam"],
  "⏰ +10 мин": ["⏰ +10 min", "⏰ +10 daq", "⏰ +10 Min.", "⏰ +10分", "⏰ +10 dk"],
  "⏰ +1 час": ["⏰ +1 h", "⏰ +1 soat", "⏰ +1 Std.", "⏰ +1時間", "⏰ +1 sa"],
  "Выполнено": ["Done", "Bajarildi", "Erledigt", "完了", "Tamamlandı"],
  "Отложено на": ["Snoozed for", "Kechiktirildi:", "Verschoben um", "延期：", "Ertelendi:"],
  "Напомню через": ["I'll remind you in", "Eslataman:", "Ich erinnere Sie in", "リマインド：", "Hatırlatırım:"],
  "План на сегодня": ["Today's plan", "Bugungi reja", "Plan für heute", "今日の予定", "Bugünün planı"],
  "и ещё": ["and", "va yana", "und", "他", "ve"],
  "Ближайшие события": ["Upcoming events", "Yaqin tadbirlar", "Nächste Termine", "今後の予定", "Yaklaşan etkinlikler"],
  "Сегодня событий нет 🌿": ["No events today 🌿", "Bugun tadbirlar yo'q 🌿", "Heute keine Termine 🌿", "今日の予定はありません 🌿", "Bugün etkinlik yok 🌿"],
  "Ближайших событий нет.": ["No upcoming events.", "Yaqin tadbirlar yo'q.", "Keine anstehenden Termine.", "予定はありません。", "Yaklaşan etkinlik yok."],
  "Часовой пояс": ["Time zone", "Vaqt mintaqasi", "Zeitzone", "タイムゾーン", "Saat dilimi"],
  "Клиент": ["Client", "Mijoz", "Kunde", "お客様", "Müşteri"],
  "Визитов": ["Visits", "Tashriflar", "Besuche", "来店回数", "Ziyaret"],
  "Последний визит": ["Last visit", "Oxirgi tashrif", "Letzter Besuch", "前回の来店", "Son ziyaret"],
  "Ближайшая запись": ["Next appointment", "Keyingi yozuv", "Nächster Termin", "次回の予約", "Sonraki randevu"],
  "Заметка": ["Note", "Izoh", "Notiz", "メモ", "Not"],
  "Заготовка сообщения клиенту": ["Draft message for the client", "Mijozga xabar qoralamasi", "Nachrichtenentwurf für den Kunden", "お客様への連絡文案", "Müşteriye mesaj taslağı"],
  "Написать клиенту": ["Message the client", "Mijozga yozish", "Kunden schreiben", "お客様に連絡", "Müşteriye yaz"],
  "Выбран язык": ["Language set", "Til tanlandi", "Sprache gewählt", "言語を設定しました", "Dil seçildi"],
  "Пригласите друга": ["Invite a friend", "Do'stingizni taklif qiling", "Freund einladen", "友達を招待", "Arkadaşını davet et"],
  "скидка 20%": ["20% off", "20% chegirma", "20 % Rabatt", "20%割引", "%20 indirim"],
};
const KEYS = Object.keys(D).sort((a, b) => b.length - a.length);
const U: Record<string, string[]> = { "мин": ["min", "daq", "Min.", "分", "dk"], "ч": ["h", "soat", "Std.", "時間", "sa"], "дн.": ["d", "kun", "Tg.", "日", "gün"], "нед.": ["wk", "hafta", "Wo.", "週", "hf"] };
export function tr(text: string, lang: Lang = getLang()): string {
  if (lang === "ru" || !text) return text;
  const i = IDX[lang];
  let out = text;
  // числа: «за 30 мин», «Через 2 ч»
  out = out.replace(/Через (\d+) (мин|ч|дн\.)/g, (_m, n, u) => { const x = U[u][i]; return ["In " + n + " " + x, n + " " + x + " dan keyin", "In " + n + " " + x, n + x + "後", n + " " + x + " sonra"][i]; });
  out = out.replace(/за (\d+) (мин|ч|дн\.|нед\.)/g, (_m, n, u) => { const x = U[u][i]; return [n + " " + x + " before", n + " " + x + " oldin", n + " " + x + " vorher", n + x + "前", n + " " + x + " önce"][i]; });
  out = out.replace(/в (\d{1,2}):00 в тот же день/g, (_m, h) => ["at " + h + ":00 the same day", "o'sha kuni " + h + ":00 da", "am selben Tag um " + h + ":00", "当日 " + h + ":00", "aynı gün " + h + ":00"][i]);
  for (const k of KEYS) if (out.includes(k)) out = out.split(k).join(D[k][i] || k);
  return out;
}
export const trKb = (kb: unknown): unknown => {
  // deno-lint-ignore no-explicit-any
  const k = kb as any; if (!k?.inline_keyboard) return kb;
  // deno-lint-ignore no-explicit-any
  return { ...k, inline_keyboard: k.inline_keyboard.map((row: any[]) => row.map((b) => ({ ...b, text: tr(b.text) }))) };
};
