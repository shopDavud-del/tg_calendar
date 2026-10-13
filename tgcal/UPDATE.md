# Обновление до v2 (если у вас уже работает первая версия)

Выполняйте по порядку, в папке проекта `D:\Bot Calendar\The App\tg_calendar`.

1. **Файлы.** Распакуйте новый `tgcal.zip` во временную папку и скопируйте её содержимое поверх проекта (файл `.env` не трогайте, его в архиве нет):
   ```
   robocopy путь\к\распакованному\tgcal . /E
   ```
2. **База.** Supabase → SQL Editor → по очереди выполните файлы `supabase/migrations/002_v2.sql` (если ещё не выполняли) и `supabase/migrations/003_v21.sql` (Run). Каждый один раз.
3. **Функции.**
   ```
   npx supabase functions deploy bot api cron google ics --use-api
   ```
4. **Команды бота** (появилась `/code`):
   ```
   powershell -ExecutionPolicy Bypass -File .\scripts\setup-bot.ps1 -ProjectRef ВАШ_REF
   ```
5. **Сайт.** В GitHub Desktop: Commit to main → Push origin. Через минуту страница обновится. Если вид не изменился, закройте и снова откройте мини-приложение.
6. **Планировщик.** Если ещё не запускали `supabase/cron.sql`, сделайте это сейчас. Без него не приходят напоминания и утренние/вечерние сводки. Проверка: напишите боту `/stats` (владельцу покажет, работает ли планировщик).
7. **Раскадровка тем:** `https://ВАШ_ЛОГИН.github.io/РЕПОЗИТОРИЙ/themes.html`.
