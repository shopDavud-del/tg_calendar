# Настройка бота в Telegram для Windows (PowerShell).
# Берёт BOT_TOKEN, WEBHOOK_SECRET и APP_URL из файла .env в корне проекта.
# Запуск:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup-bot.ps1 -ProjectRef ваш_20_буквенный_ref
param([Parameter(Mandatory = $true)][string]$ProjectRef)

$envFile = Join-Path $PSScriptRoot '..\.env'
if (-not (Test-Path $envFile)) { Write-Error "Не найден файл .env в корне проекта"; exit 1 }
$cfg = @{}
Get-Content $envFile -Encoding UTF8 | ForEach-Object {
  if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { $cfg[$matches[1]] = $matches[2] }
}
foreach ($k in 'BOT_TOKEN', 'WEBHOOK_SECRET', 'APP_URL') { if (-not $cfg[$k]) { Write-Error "В .env нет $k"; exit 1 } }
$api = "https://api.telegram.org/bot$($cfg['BOT_TOKEN'])"

function Call($method, $body) {
  $json = $body | ConvertTo-Json -Depth 8 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Invoke-RestMethod -Method Post -Uri "$api/$method" -ContentType 'application/json; charset=utf-8' -Body $bytes
}

Write-Host '-> webhook'
Call 'setWebhook' @{
  url = "https://$ProjectRef.supabase.co/functions/v1/bot"
  secret_token = $cfg['WEBHOOK_SECRET']
  drop_pending_updates = $true
  allowed_updates = @('message', 'callback_query', 'my_chat_member', 'pre_checkout_query')
} | ConvertTo-Json -Compress

Write-Host '-> команды'
Call 'setMyCommands' @{ commands = @(
  @{ command = 'app'; description = 'Открыть календарь' },
  @{ command = 'list'; description = 'Ближайшие события' },
  @{ command = 'today'; description = 'События на сегодня' },
  @{ command = 'help'; description = 'Как добавлять события' },
  @{ command = 'words'; description = 'Слова-команды' },
  @{ command = 'plan'; description = 'Тарифы' },
  @{ command = 'code'; description = 'Ввести код подписки' },
  @{ command = 'ref'; description = 'Пригласить друга (скидка 20%)' },
  @{ command = 'lang'; description = 'Язык / Language' },
  @{ command = 'client'; description = 'Карточка клиента' },
  @{ command = 'tz'; description = 'Часовой пояс' },
  @{ command = 'export'; description = 'Выгрузить мои данные' },
  @{ command = 'delete'; description = 'Удалить мои данные' },
  @{ command = 'paysupport'; description = 'Помощь с оплатой' },
  @{ command = 'terms'; description = 'Условия' }
) } | ConvertTo-Json -Compress

Write-Host '-> кнопка меню'
Call 'setChatMenuButton' @{ menu_button = @{ type = 'web_app'; text = 'Календарь'; web_app = @{ url = (($cfg['APP_URL'] -replace '/+$','') + '/?v=3.3.1') } } } | ConvertTo-Json -Compress

Write-Host 'Готово.'
