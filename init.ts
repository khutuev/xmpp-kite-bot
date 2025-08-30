import Database from 'better-sqlite3'
import { client, xml } from '@xmpp/client'
// import 'dotenv'
import fetch from 'node-fetch'
import cron from 'node-cron'

console.log('--- start')

const dbPath = process.env.DB_PATH || '/external_db/database.sqlite'
const db = new Database(dbPath)

db.exec(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jid TEXT NOT NULL,
    lat TEXT NOT NULL,
    lon TEXT NOT NULL,
    time TEXT NOT NULL
  );
`)

const WRONG_COORDS_MESSAGE = 'Координаты мне не понятны (._. ) они должны быть в формате get:LAT,LON'
const START_MESSAGE = 'Кидай сюда свои координаты. Во многих клиентах это `Отправить местоположение`.'

const SUBCRIBE_MESSAGE = `
Йооооооу! Я бот для запуска воздушных змеев! 
Пиши \`start\` чтобы начать.
Пиши \`!stop\` чтобы отменить подписку.
И отключи шифрование. Это делается через значок замочка.
Давай запустим пару змеев в небо! Пиши \`start\`.
`

const COORDS_SAVE_MESSAGE = `
Координаты сохранены! 
Теперь я буду отправлять прогноз каждый день в 8:00.
Ты можешь отправить время для запуска в виде \`8:00\`.
Можешь написать \`now\` чтобы узнать можно ли запустить змея сейчас.
`

const STOP_MESSAGE = 'Да пожалуиста. Ты удалён из базы. Пусть молния ударит в твой воздушный змей, падла.'
const CREATE_MESSAGE = 'Отлично! Теперь я буду отправлять прогноз для запуска воздушного змей каждый день в '
const COORDS_FIRST_MESSAGE = 'Так. Ну что не понятно тебе? Сначалa надо указать координаты -_-* уффф....'
const OTHER_MESSAGE = 'Да что тебе не понятно??? Я же русским языком написал что надо делать...'

const xmpp = client({
  service: process.env.XMPP_SERVICE ?? 'xmpp://wave.crabdance.com:5222',
  domain: process.env.XMPP_DOMAIN ?? 'wave.crabdance.com',
  lang: 'RU',
  username: 'kitebot',
  password: process.env.XMPP_PASSWORD
})

xmpp.on('online', async (address) => {
  console.log('Weather Bot запущен! Адресс ', address)
  await xmpp.send(xml('presence'))
})

xmpp.on('error', async (error: Error) => {
  console.log('Error: ', error)
})

xmpp.on('stanza', async (stanza) => {
  if (stanza.is('presence')) {
    const from = stanza.attrs.from.split("/")[0]
    const type = stanza.attrs.type

    if (type === 'subscribe') {
      xmpp.send(xml('presence', { to: from, type: "subscribed" }))
      sendMessage(from, SUBCRIBE_MESSAGE)
    }
  }

  if (stanza.is('message') && stanza.attrs.type === 'chat') {
    const body = stanza.getChildText('body')
    console.log('---message: ' + stanza.getChild('encrypted'))
    const from = stanza.attrs.from.split("/")[0]

    if (!body) {
      return
    }

    if (body.toLowerCase() === "start") {
      sendMessage(from, START_MESSAGE)
    } else if (isCoords(body)) {
      processingSetCoordsMessage(from, body)
    } else if (isTime(body)) {
      processingSetTimeMessage(from, body)
    } else if (body.toLowerCase() === '!stop') {
      processingStopMessage(from)
    } else if (body.toLowerCase() === 'now') {
      const sub = getSubscription(from) as any
      const report = await getKiteMessage(sub.lat, sub.lon)
      sendMessage(sub.jid, report.text)
    } else {
      sendMessage(from, OTHER_MESSAGE)
    }
  }
})

xmpp.start()

function sendMessage(to: string, text: string) {
  xmpp.send(
    xml(
      'message',
      { type: 'chat', to },
      xml("body", {}, text)
    )
  )
}

cron.schedule('* * * * *', async () => {
  const now = new Date()
  const hhmm = now.toTimeString().slice(0, 5)


  const subs = getAllSubscription() as any

  for (const sub of subs) {
    if (sub.time === hhmm) {
      const report = await getKiteMessage(sub.lat, sub.lon)
      sendMessage(sub.jid, report.text)
    }
  }
})

interface KiteMessage {
  text: string;
}
 
interface OpenMeteoResponse {
  current_weather: {
    temperature: number;
    windspeed: number;
    winddirection: number;
  };
  daily: {
    sunrise: string;
    sunset: string;
    precipitation_sum: number[];
    cloudcover_max: number[];
  };
}
 
export async function getKiteMessage(lat: number, lon: number): Promise<KiteMessage> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&daily=sunrise,sunset,precipitation_sum,cloudcover_max&timezone=auto`
  const res = await fetch(url);
  if (!res.ok) {
    return { text: "⚠️ Не удалось получить данные о погоде." }
  }
 
  const data: OpenMeteoResponse = await res.json() as OpenMeteoResponse
 
  const temp = data.current_weather.temperature
  const windSpeed = data.current_weather.windspeed
  const windDir = data.current_weather.winddirection
  const sunrise = new Date(data.daily.sunrise[0])
  const sunset = new Date(data.daily.sunset[0])
  const precipitation = data.daily.precipitation_sum[0]
  const cloudCover = data.daily.cloudcover_max[0]
 
  let windMsg = ""
  let sunMsg = ""
  let overallMsg = ""
 
  if (windSpeed < 2) {
    windMsg = "💨 Сегодня ветер почти не дует. Змей едва ли поднимется."
  } else if (windSpeed <= 5) {
    windMsg = "🌬 Лёгкий и приятный ветер — идеальный для небольшого полёта змея!"
  } else if (windSpeed <= 10) {
    windMsg = "💨 Сильный ветер! Змей взлетит высоко, держи покрепче нитку 🪁"
  } else {
    windMsg = "🌪 Слишком сильный ветер! Опасно запускать змея."
  }
 
  if (precipitation > 0.1 || cloudCover > 80) {
    sunMsg = "☁️ Плохое солнце — дождь или облачность. Лучше оставить змея дома."
  } else if (cloudCover > 50) {
    sunMsg = "⛅ Солнце прячется за облаками, но запускать змея всё ещё можно."
  } else {
    sunMsg = "☀️ Яркое солнце и чистое небо! Отличный день для полёта змея 🪁"
  }
 
  if (windSpeed >= 2 && windSpeed <= 10 && cloudCover <= 50 && precipitation <= 0.1) {
    overallMsg = "🎉 Сегодня почти идеальный день для змея! Лови ветер и наслаждайся полётом!"
  } else if (windSpeed < 2) {
    overallMsg = "😴 Слишком слабый ветер. Змей едва ли поднимется."
  } else if (windSpeed > 10) {
    overallMsg = "⚠️ Опасный ветер! Не рискуй запускать змея."
  } else if (cloudCover > 80 || precipitation > 0.1) {
    overallMsg = "🌧 Плохая погода — дождь или облачность. Лучше отложить запуск."
  } else {
    overallMsg = "🤔 Условия средние. Можно попробовать запустить змея, но осторожно."
  }
 
  const message = `
📍 Погода для ${getCityFromCoordinates(lat, lon)}:
🌡 Температура: ${temp}°C
🌬 Ветер: ${windSpeed} м/с, направление ${windDir}°
☀️ Восход: ${sunrise.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
🌇 Закат: ${sunset.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
🌧 Осадки: ${precipitation} мм
☁️ Облачность: ${cloudCover}%
 
🪁 Чек-лист для запуска змея:
- Ветер: ${windMsg}
- Солнце: ${sunMsg}
- Общая оценка: ${overallMsg}
`;
 
  return { text: message.trim() };
}

async function getCityFromCoordinates(lat: number, lon: number) {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
  const data = await response.json() as any
  return data.address.city || data.address.town || data.address.village;
}

function createSubscription(
  from: string, 
  lat: number, 
  lon: number, 
  time: string
): void {
  db
    .prepare('INSERT INTO subscriptions (jid, lat, lon, time) VALUES (?, ?, ?, ?)')
    .run(from, lat, lon, time)
}

function getSubscription(from: string): unknown {
  return db
    .prepare('SELECT * from subscriptions WHERE jid=?')
    .get(from)
}

function getAllSubscription(): unknown {
  return db
    .prepare('SELECT * from subscriptions')
    .all()
}

function updateCoords(
  lat: number, 
  lon: number, 
  from: string
): void {
  db
    .prepare('UPDATE subscriptions SET lat=?, lon=? WHERE jid=?')
    .run(lat, lon, from)
}

function deleteSubscription(from: string): void {
  db
    .prepare('DELETE FROM subscriptions WHERE jid=?')
    .run(from)
}

function updateTime(from: string, time: string): void {
  db
    .prepare('UPDATE subscriptions SET time=? WHERE jid=?')
    .run(time, from)
}

function isTime(body: string) {
  return /^\d{2}:\d{2}$/.test(body)
}

function isCoords(body: string) {
  return body.startsWith('geo:')
}

function processingSetCoordsMessage(from: string, message: string): void {
  const coords = message.slice(4).split(',')

  if (coords.length === 2) {
    const lat = parseFloat(coords[0])
    const lon = parseFloat(coords[1])

    if (!isNaN(lat) && !isNaN(lon)) {
      const existing = getSubscription(from)

      if (existing) {
        updateCoords(lat, lon, from)
      } else {
        createSubscription(from, lat, lon, '08:00')
      }

      sendMessage(from, getCityFromCoordinates(lat, lon) + ' ' + COORDS_SAVE_MESSAGE)
    } else {
      sendMessage(from, WRONG_COORDS_MESSAGE)
    }
  } else {
    sendMessage(from, WRONG_COORDS_MESSAGE)
  }
}

function processingSetTimeMessage(from: string, message: string): void {
  const existing = getSubscription(from)

  if (existing) {
    updateTime(message, from)
    sendMessage(from, CREATE_MESSAGE + message)
  } else {
    sendMessage(from, COORDS_FIRST_MESSAGE)
  }
}

function processingStopMessage(from: string): void {
  deleteSubscription(from)
  sendMessage(from, STOP_MESSAGE)
}
