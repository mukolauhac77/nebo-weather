import {
  forecastUrl, hourLabel, isForecast, kyiv, localDateLabel, skyEffect, temperature,
  unpackSeries, upcomingHours, walkWindow, weatherCondition,
} from './weather.mjs'

const element = id => document.getElementById(id)
const cityInput = element('city')
const results = element('results')
const searchMessage = element('search-message')
const locate = element('locate')
const hero = element('hero')
const skyEffects = element('sky-effects')
const motionButton = element('sky-motion')
const units = [...document.querySelectorAll('[data-unit]')]
const savedPlace = read('nebo:place')
let selectedPlace = validPlace(savedPlace) ? savedPlace : kyiv
let unit = read('nebo:unit') === 'F' ? 'F' : 'C'
let forecastController
let searchController
let searchTimer
let displayed
let options = []
let activeOption = -1
let searchRevision = 0
let placeRevision = 0

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) }
  catch { return null }
}

function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { /* The forecast also works with browser storage turned off. */ }
}

function validPlace(place) {
  return typeof place?.name === 'string' && Number.isFinite(place.latitude) &&
    Number.isFinite(place.longitude)
}

function create(tag, className, text) {
  const item = document.createElement(tag)
  item.className = className
  if (text !== undefined) item.textContent = text
  return item
}

function weatherIcon(code, isDay = true) {
  const { name, icon } = weatherCondition(code, isDay)
  const item = create('span', 'weather-icon', icon)
  item.setAttribute('role', 'img')
  item.setAttribute('aria-label', name)
  return item
}

function notice(message, retry = false) {
  element('status').textContent = message
  element('retry').hidden = !retry
  element('notice').hidden = !message
}

function setSkyMotion(enabled) {
  hero.dataset.motion = enabled ? 'running' : 'paused'
  motionButton.setAttribute('aria-pressed', String(enabled))
  motionButton.title = enabled ? 'Призупинити анімацію' : 'Відтворити анімацію'
}

function drawSky(code) {
  const next = skyEffect(code)
  if (hero.dataset.effect === next) return
  hero.dataset.effect = next

  const count = next === 'rain' ? 30 : next === 'snow' ? 24 : 0
  const particles = Array.from({ length: count }, (_, index) => {
    const track = create('span', 'sky-track')
    const size = next === 'snow' ? 2 + (index % 5) * .65 : 1 + (index % 4) * .25
    const duration = next === 'snow' ? 5.5 + (index % 8) * .6 : .9 + (index % 8) * .09
    track.style.setProperty('--left', (index * 47 % 101) + '%')
    track.style.setProperty('--size', size + 'px')
    track.style.setProperty('--duration', duration + 's')
    track.style.setProperty('--delay', -((index * 37 % 101) / 101) * duration + 's')
    track.style.setProperty('--opacity', .24 + (index % 6) * .1)
    return track
  })
  skyEffects.replaceChildren(...particles)
}

function clearForecast(place, message) {
  displayed = null
  element('location').textContent = place.name
  element('place').textContent = place.country || ''
  element('local-date').textContent = 'Прогноз погоди'
  element('temperature').textContent = '—'
  element('current-icon').textContent = ''
  element('condition').textContent = message
  element('range').textContent = ''
  hero.removeAttribute('data-sky')
  drawSky()
  element('weather-state').hidden = true
  for (const id of ['hours', 'week', 'walk', 'details']) {
    element(id).replaceChildren(create('p', 'empty', 'Очікуємо на прогноз'))
  }
}

function drawHours(data, hourly) {
  const hours = upcomingHours(hourly, data.current.time)
  element('hours').replaceChildren(...hours.map((hour, index) => {
    const item = create('div', 'hour')
    const temp = index === 0 ? data.current.temperature_2m : hour.temperature_2m
    const code = index === 0 ? data.current.weather_code : hour.weather_code
    const isDay = index === 0 ? data.current.is_day : hour.is_day
    const rain = Number.isFinite(hour.precipitation_probability) ? hour.precipitation_probability + '%' : '—'
    const rainLabel = create('span', 'hour-rain', rain)
    rainLabel.setAttribute('aria-label', 'Імовірність опадів ' + rain)
    item.append(
      create('span', 'hour-time', index === 0 ? 'Зараз' : hourLabel(hour.time)),
      weatherIcon(code, isDay === 1),
      create('strong', 'hour-temp', temperature(temp, unit)),
      rainLabel,
    )
    return item
  }))
}

function drawWeek(daily) {
  const values = daily.flatMap(day => [day.temperature_2m_min, day.temperature_2m_max]).filter(Number.isFinite)
  const low = Math.min(...values)
  const spread = Math.max(1, Math.max(...values) - low)
  const rows = daily.map((day, index) => {
    const bar = create('span', 'day-track')
    bar.setAttribute('aria-hidden', 'true')
    if (Number.isFinite(day.temperature_2m_min) && Number.isFinite(day.temperature_2m_max)) {
      const segment = create('span', '')
      const left = (day.temperature_2m_min - low) / spread * 100
      const exactWidth = (day.temperature_2m_max - day.temperature_2m_min) / spread * 100
      const width = Math.max(4, exactWidth)
      segment.style.left = Math.min(left, 100 - width) + '%'
      segment.style.width = width + '%'
      bar.append(segment)
    }
    const row = create('div', 'day')
    row.append(
      create('strong', '', index === 0 ? 'Сьогодні' : localDateLabel(day.time, { weekday: 'short' })),
      weatherIcon(day.weather_code),
      create('span', 'day-low', temperature(day.temperature_2m_min, unit)),
      bar,
      create('span', 'day-high', temperature(day.temperature_2m_max, unit)),
    )
    return row
  })
  element('week').replaceChildren(...rows)
}

function drawWalk(hourly, now, stale) {
  const target = element('walk')
  if (stale) {
    target.replaceChildren(create('p', 'walk-factors', 'Для підказки потрібен свіжий прогноз.'))
    return
  }
  const best = walkWindow(hourly, now)
  if (!best) {
    target.replaceChildren(create('p', 'walk-factors', 'У найближчі 36 годин немає вдалої години зі світлом і погодою для прогулянки.'))
    return
  }

  const date = best.time.slice(0, 10)
  const today = now.slice(0, 10)
  const tomorrow = new Date(Date.parse(today + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10)
  const dayLabel = date === today ? 'Сьогодні' : date === tomorrow ? 'Завтра' : localDateLabel(date, { weekday: 'long' })
  const slot = create('p', 'walk-slot')
  slot.append(create('strong', '', hourLabel(best.time)), create('span', '', dayLabel + ', місцевий час'))
  target.replaceChildren(slot, create('p', 'walk-factors',
    `Відчувається як ${temperature(best.apparent_temperature, unit)} · Опади ${best.precipitation_probability}% · Вітер ${Math.round(best.wind_speed_10m)} км/год`))
}

function metric(value, suffix) {
  return Number.isFinite(value) ? Math.round(value) + suffix : '—'
}

function drawDetails(current, day) {
  const metrics = [
    ['Відчувається як', temperature(current.apparent_temperature, unit)],
    ['Вологість', metric(current.relative_humidity_2m, '%')],
    ['Вітер', metric(current.wind_speed_10m, ' км/год')],
    ['Схід / захід сонця', `${hourLabel(day.sunrise)} / ${hourLabel(day.sunset)}`],
  ]
  element('details').replaceChildren(...metrics.map(([name, value]) => {
    const tile = create('div', 'detail')
    tile.append(create('p', '', name), create('strong', '', value))
    return tile
  }))
}

function render() {
  if (!displayed) return
  const { place, data, stale } = displayed
  const current = data.current
  const hourly = unpackSeries(data.hourly)
  const daily = unpackSeries(data.daily)
  const condition = weatherCondition(current.weather_code, current.is_day === 1)

  element('location').textContent = place.name
  element('place').textContent = place.country || ''
  element('local-date').textContent = localDateLabel(current.time, { weekday: 'long', day: 'numeric', month: 'long' })
  element('temperature').textContent = temperature(current.temperature_2m, unit)
  element('current-icon').textContent = condition.icon
  element('condition').textContent = condition.name
  element('range').textContent = `Макс. ${temperature(daily[0].temperature_2m_max, unit)}  ·  Мін. ${temperature(daily[0].temperature_2m_min, unit)}`
  hero.dataset.sky = current.is_day === 0 ? 'night' : current.weather_code >= 51 ? 'wet' : 'day'
  drawSky(current.weather_code)
  const state = element('weather-state')
  state.hidden = false
  state.dataset.mode = stale ? 'cache' : 'live'
  state.firstElementChild.textContent = stale ? 'Збережений прогноз' : 'Актуальний прогноз'
  drawHours(data, hourly)
  drawWeek(daily)
  drawWalk(hourly, current.time, stale)
  drawDetails(current, daily[0])
}

async function getJson(url, controller) {
  const timer = setTimeout(() => controller.abort('timeout'), 9000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error('HTTP ' + response.status)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function loadForecast(place) {
  forecastController?.abort()
  const controller = new AbortController()
  forecastController = controller
  const changed = displayed?.place.latitude !== place.latitude || displayed?.place.longitude !== place.longitude
  if (changed) clearForecast(place, 'Завантажуємо прогноз…')
  selectedPlace = place
  hero.setAttribute('aria-busy', 'true')
  notice('')

  try {
    const data = await getJson(forecastUrl(place), controller)
    if (forecastController !== controller) return
    if (!isForecast(data)) throw new Error('Invalid forecast')
    displayed = { place, data, stale: false }
    save('nebo:place', place)
    save('nebo:forecast', { latitude: place.latitude, longitude: place.longitude, data, time: Date.now() })
    render()
  } catch {
    if (forecastController !== controller) return
    const cache = read('nebo:forecast')
    if (cache?.latitude === place.latitude && cache.longitude === place.longitude &&
        Date.now() - cache.time < 24 * 3600 * 1000 && isForecast(cache.data)) {
      displayed = { place, data: cache.data, stale: true }
      render()
      notice('Показуємо останні збережені дані. Свіжий прогноз зараз недоступний.', true)
    } else {
      clearForecast(place, 'Прогноз недоступний')
      for (const item of document.querySelectorAll('.empty')) item.textContent = 'Дані недоступні'
      notice('Не вдалося отримати прогноз. Перевір інтернет і спробуй ще раз.', true)
    }
  } finally {
    if (forecastController === controller) hero.setAttribute('aria-busy', 'false')
  }
}

function setUnits(next) {
  unit = next
  save('nebo:unit', next)
  units.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.unit === unit)))
  render()
}

function closeSearch() {
  searchRevision++
  clearTimeout(searchTimer)
  searchController?.abort()
  options = []
  activeOption = -1
  results.hidden = true
  searchMessage.hidden = true
  cityInput.setAttribute('aria-expanded', 'false')
  cityInput.removeAttribute('aria-activedescendant')
}

function selectPlace(place) {
  placeRevision++
  closeSearch()
  cityInput.value = ''
  loadForecast(place)
}

function activateOption(index) {
  activeOption = (index + options.length) % options.length
  for (const [position, option] of [...results.children].entries()) {
    option.setAttribute('aria-selected', String(position === activeOption))
  }
  cityInput.setAttribute('aria-activedescendant', results.children[activeOption].id)
}

async function findCities(query, revision) {
  const controller = new AbortController()
  searchController = controller
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search')
  url.search = new URLSearchParams({ name: query, count: 7, language: 'uk' })
  searchMessage.textContent = 'Шукаємо міста…'
  searchMessage.hidden = false

  try {
    const response = await getJson(url, controller)
    if (revision !== searchRevision) return
    options = (response.results ?? []).filter(validPlace)
    if (options.length === 0) {
      searchMessage.textContent = 'Місто не знайдено'
      return
    }
    results.replaceChildren(...options.map((place, index) => {
      const option = create('div', 'search-option', place.name)
      const subtitle = [...new Set([place.admin1, place.country].filter(name => name && name !== place.name))].join(', ')
      option.id = `city-option-${index}`
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', 'false')
      if (subtitle) option.append(create('small', '', subtitle))
      option.addEventListener('mousedown', event => event.preventDefault())
      option.addEventListener('click', () => selectPlace(place))
      return option
    }))
    results.hidden = false
    searchMessage.hidden = true
    cityInput.setAttribute('aria-expanded', 'true')
  } catch {
    if (revision === searchRevision) searchMessage.textContent = 'Пошук зараз недоступний'
  }
}

cityInput.addEventListener('input', () => {
  closeSearch()
  const query = cityInput.value.trim()
  if (query.length < 2) return
  const revision = searchRevision
  searchTimer = setTimeout(() => findCities(query, revision), 260)
})
cityInput.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closeSearch()
  }
  if (options.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    activateOption(event.key === 'ArrowDown' ? activeOption + 1 : activeOption < 0 ? -1 : activeOption - 1)
  }
})
document.addEventListener('pointerdown', event => {
  if (!element('search').contains(event.target)) closeSearch()
})
element('search').addEventListener('focusout', event => {
  if (!element('search').contains(event.relatedTarget)) closeSearch()
})
element('search').addEventListener('submit', event => {
  event.preventDefault()
  if (options.length) selectPlace(options[Math.max(0, activeOption)])
})
element('retry').addEventListener('click', () => loadForecast(selectedPlace))

locate.addEventListener('click', () => {
  if (!navigator.geolocation) {
    notice('Геолокація недоступна. Знайди своє місто в пошуку.')
    return
  }

  const revision = ++placeRevision
  locate.disabled = true
  notice('Визначаємо твоє місце…')
  navigator.geolocation.getCurrentPosition(position => {
    locate.disabled = false
    if (revision !== placeRevision) return
    selectPlace({ name: 'Моє місце', latitude: position.coords.latitude, longitude: position.coords.longitude })
  }, error => {
    locate.disabled = false
    if (revision !== placeRevision) return
    notice(error.code === 1
      ? 'Доступ до геолокації вимкнений. Знайди своє місто в пошуку.'
      : 'Не вдалося визначити твоє місце. Знайди місто в пошуку.')
  }, { timeout: 9000, maximumAge: 3 * 60 * 1000 })
})

motionButton.addEventListener('click', () => {
  const enabled = hero.dataset.motion !== 'running'
  setSkyMotion(enabled)
  save('nebo:motion', enabled)
})
setSkyMotion(read('nebo:motion') !== false)
motionButton.hidden = false
for (const button of units) button.addEventListener('click', () => setUnits(button.dataset.unit))
setUnits(unit)
loadForecast(selectedPlace)
