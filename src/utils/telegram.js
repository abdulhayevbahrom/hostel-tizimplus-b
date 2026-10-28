const apiUrl = (method) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`

export async function telegramCall(method, body) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN kiritilmagan')
  const response = await fetch(apiUrl(method), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram API xatosi: ${response.status}`)
  return result.result
}

export const sendTelegramMessage = (chatId, text, replyMarkup) => telegramCall('sendMessage', {
  chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
})

export async function registerTelegramWebhook() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')
  if (!token || !secret || !baseUrl) {
    console.log('Telegram webhook o‘tkazib yuborildi: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET va PUBLIC_BASE_URL kerak')
    return null
  }
  const url = `${baseUrl}/api/surveys/telegram/webhook`
  const result = await telegramCall('setWebhook', {
    url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false,
  })
  console.log(`Telegram webhook ulandi: ${url}`)
  return result
}
