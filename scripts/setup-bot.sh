#!/usr/bin/env bash
# Настройка бота в Telegram одной командой.
# Использование:
#   BOT_TOKEN=123:ABC WEBHOOK_SECRET=... PROJECT_REF=abcd1234 APP_URL=https://user.github.io/repo ./scripts/setup-bot.sh
set -euo pipefail
: "${BOT_TOKEN:?}" "${WEBHOOK_SECRET:?}" "${PROJECT_REF:?}" "${APP_URL:?}"
API="https://api.telegram.org/bot${BOT_TOKEN}"

echo "→ webhook"
curl -s "$API/setWebhook" -d "url=https://${PROJECT_REF}.supabase.co/functions/v1/bot" \
  -d "secret_token=${WEBHOOK_SECRET}" -d "drop_pending_updates=true" \
  -d 'allowed_updates=["message","callback_query","my_chat_member","pre_checkout_query"]'; echo

echo "→ команды"
curl -s "$API/setMyCommands" -H 'content-type: application/json' -d '{"commands":[
 {"command":"app","description":"Открыть календарь"},
 {"command":"list","description":"Ближайшие события"},
 {"command":"today","description":"События на сегодня"},
 {"command":"help","description":"Как добавлять события"},
 {"command":"words","description":"Слова-команды"},
 {"command":"plan","description":"Тарифы"},
 {"command":"code","description":"Ввести код подписки"},
 {"command":"ref","description":"Пригласить друга (скидка 20%)"},
 {"command":"lang","description":"Язык / Language"},
 {"command":"client","description":"Карточка клиента"},
 {"command":"tz","description":"Часовой пояс"},
 {"command":"export","description":"Выгрузить мои данные"},
 {"command":"delete","description":"Удалить мои данные"},
 {"command":"paysupport","description":"Помощь с оплатой"},
 {"command":"terms","description":"Условия"}]}'; echo

echo "→ кнопка меню (открывает календарь)"
curl -s "$API/setChatMenuButton" -H 'content-type: application/json' \
  -d "{\"menu_button\":{\"type\":\"web_app\",\"text\":\"Календарь\",\"web_app\":{\"url\":\"${APP_URL}\"}}}"; echo
echo "Готово."
