export const kyiv = Object.freeze({
  name: 'Київ',
  country: 'Україна',
  latitude: 50.45,
  longitude: 30.52,
})

export const currentFields = [
  'temperature_2m', 'apparent_temperature', 'relative_humidity_2m',
  'weather_code', 'is_day', 'wind_speed_10m',
]
export const hourlyFields = [
  'temperature_2m', 'apparent_temperature', 'precipitation_probability',
  'weather_code', 'is_day', 'wind_speed_10m',
]
export const dailyFields = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'sunrise', 'sunset',
]

const conditions = new Map([
  [0, ['Ясно', '☀️']],
  [1, ['Переважно ясно', '🌤️']],
  [2, ['Мінлива хмарність', '⛅']],
  [3, ['Хмарно', '☁️']],
  [45, ['Туман', '🌫️']], [48, ['Імлистий туман', '🌫️']],
  [51, ['Легка мряка', '🌦️']], [53, ['Мряка', '🌦️']], [55, ['Сильна мряка', '🌧️']],
  [56, ['Крижана мряка', '🌧️']], [57, ['Сильна крижана мряка', '🌧️']],
  [61, ['Невеликий дощ', '🌦️']], [63, ['Дощ', '🌧️']], [65, ['Сильний дощ', '🌧️']],
  [66, ['Крижаний дощ', '🌧️']], [67, ['Сильний крижаний дощ', '🌧️']],
  [71, ['Невеликий сніг', '🌨️']], [73, ['Сніг', '🌨️']], [75, ['Сильний сніг', '🌨️']],
  [77, ['Снігові зерна', '🌨️']], [80, ['Невелика злива', '🌦️']],
  [81, ['Злива', '🌧️']], [82, ['Сильна злива', '🌧️']],
  [85, ['Снігопад', '🌨️']], [86, ['Сильний снігопад', '🌨️']],
  [95, ['Гроза', '⛈️']], [96, ['Гроза з градом', '⛈️']], [99, ['Сильна гроза з градом', '⛈️']],
])

export function weatherCondition(code, isDay = true) {
  const [name, icon] = conditions.get(code) ?? ['Немає даних', '·']
  return { name, icon: !isDay && code <= 1 && code !== null ? '🌙' : icon }
}

export function skyEffect(code) {
  if (code === 45 || code === 48) return 'fog'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow'
  if (Number.isFinite(code) && ((code >= 51 && code <= 67) ||
      (code >= 80 && code <= 82) || code >= 95)) return 'rain'
  return 'clouds'
}

export function temperature(value, unit = 'C') {
  if (!Number.isFinite(value)) return '—'
  const rounded = Math.round(unit === 'F' ? value * 1.8 + 32 : value)
  return `${String(rounded).replace('-', '−')}°`
}

export function unpackSeries(series) {
  return series.time.map((time, index) => {
    const row = { time }
    for (const [field, values] of Object.entries(series)) {
      if (field !== 'time') row[field] = values[index]
    }
    return row
  })
}

export function upcomingHours(hourly, now) {
  const start = hourly.findIndex(hour => hour.time >= now.slice(0, 13) + ':00')
  return start < 0 ? [] : hourly.slice(start, start + 24)
}

export function localDateLabel(timestamp, options) {
  return new Intl.DateTimeFormat('uk-UA', { ...options, timeZone: 'UTC' })
    .format(new Date(timestamp.slice(0, 10) + 'T12:00:00Z'))
}

export function hourLabel(timestamp) {
  return timestamp?.slice(11, 16) || '—'
}

export function walkWindow(hourly, now) {
  const start = hourly.findIndex(hour => hour.time >= now)
  if (start < 0) return null

  const candidates = hourly.slice(start, start + 36).filter(hour =>
    hour.is_day === 1 &&
    Number.isFinite(hour.apparent_temperature) &&
    Number.isFinite(hour.precipitation_probability) &&
    Number.isFinite(hour.wind_speed_10m) &&
    Number.isFinite(hour.weather_code) &&
    hour.weather_code < 95 &&
    hour.precipitation_probability < 55 &&
    hour.wind_speed_10m < 36 &&
    hour.apparent_temperature >= -15 &&
    hour.apparent_temperature <= 35
  )

  const score = hour => 100 - hour.precipitation_probability * 1.45 -
    Math.abs(hour.apparent_temperature - 18) * 1.1 -
    hour.wind_speed_10m * .75 - (hour.weather_code >= 51 ? 24 : 0)

  return candidates.reduce((best, hour) => !best || score(hour) > score(best) ? hour : best, null)
}

export function forecastUrl(location) {
  const url = new URL('https://api.open-meteo.com/v1/forecast')
  url.search = new URLSearchParams({
    latitude: location.latitude,
    longitude: location.longitude,
    current: currentFields.join(','),
    hourly: hourlyFields.join(','),
    daily: dailyFields.join(','),
    timezone: 'auto',
    forecast_days: 7,
  })
  return url
}

export function isForecast(data) {
  if (!data || typeof data.current?.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(data.current.time)) return false

  return currentFields.every(field => Object.hasOwn(data.current, field)) &&
    [[data.hourly, hourlyFields], [data.daily, dailyFields]].every(([series, fields]) =>
      Array.isArray(series?.time) && series.time.length > 0 &&
      series.time.every(time => typeof time === 'string') &&
      fields.every(field => Array.isArray(series[field]) && series[field].length === series.time.length)
    )
}
