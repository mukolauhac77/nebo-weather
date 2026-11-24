import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { test } from 'node:test'
import {
  forecastUrl, isForecast, kyiv, localDateLabel, skyEffect, temperature,
  unpackSeries, upcomingHours, walkWindow, weatherCondition,
  currentFields, hourlyFields, dailyFields,
} from '../dist/weather.mjs'

const root = new URL('../dist/', import.meta.url)

test('published files referenced by the page are present and relative', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8')
  const styles = await readFile(new URL('styles.css', root), 'utf8')
  const script = await readFile(new URL('app.mjs', root), 'utf8')
  const references = [
    ...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g),
    ...styles.matchAll(/url\("(\.\/[^"]+)"\)/g),
    ...script.matchAll(/from '(\.\/[^']+)'/g),
  ].map(match => match[1]).filter(url => url !== './')
  assert.ok(references.length >= 4)
  for (const path of references) assert.ok((await stat(new URL(path, root))).isFile(), path)
})

test('temperatures, nighttime icons and local forecast dates', () => {
  assert.equal(temperature(-5), '−5°')
  assert.equal(temperature(20, 'F'), '68°')
  assert.equal(temperature(null), '—')
  assert.equal(weatherCondition(0, false).icon, '🌙')
  assert.equal(weatherCondition(95, false).icon, '⛈️')
  assert.equal(localDateLabel('2026-11-24T23:00', { weekday: 'short' }), 'вт')
})

test('sky animation follows the reported weather', () => {
  assert.deepEqual(
    [null, 0, 3, 45, 61, 66, 71, 80, 85, 95].map(skyEffect),
    ['clouds', 'clouds', 'clouds', 'fog', 'rain', 'rain', 'snow', 'rain', 'snow', 'rain'],
  )
})

test('weekly forecast request, schema and current-hour alignment', () => {
  const url = forecastUrl(kyiv)
  assert.equal(url.searchParams.get('timezone'), 'auto')
  assert.equal(url.searchParams.get('forecast_days'), '7')
  const series = (fields, time) => Object.fromEntries([['time', time], ...fields.map(field => [field, time.map(() => 1)])])
  const data = {
    current: Object.fromEntries([['time', '2026-11-24T14:15'], ...currentFields.map(field => [field, 1])]),
    hourly: series(hourlyFields, ['2026-11-24T13:00', '2026-11-24T14:00', '2026-11-24T15:00']),
    daily: series(dailyFields, ['2026-11-24']),
  }
  assert.ok(isForecast(data))
  assert.equal(upcomingHours(unpackSeries(data.hourly), data.current.time)[0].time, '2026-11-24T14:00')
  data.hourly.weather_code = []
  assert.equal(isForecast(data), false)
})

test('walk tip ignores past, dark, stormy and windy hours and picks the drier daytime hour', () => {
  const hour = (time, details = {}) => ({
    time: '2026-11-24T' + time, is_day: 1, apparent_temperature: 18,
    precipitation_probability: 0, wind_speed_10m: 4, weather_code: 0, ...details,
  })
  const hours = [
    hour('06:00'), hour('07:00', { is_day: 0 }), hour('08:00', { weather_code: 95 }),
    hour('09:00', { wind_speed_10m: 58 }), hour('10:00', { precipitation_probability: 40 }),
    hour('11:00', { precipitation_probability: 5 }),
  ]
  assert.equal(walkWindow(hours, '2026-11-24T06:15'), hours[5])
  assert.equal(walkWindow(hours.slice(0, 4), '2026-11-24T06:15'), null)
  assert.equal(walkWindow(hours, '2026-11-24T23:00'), null)
})
