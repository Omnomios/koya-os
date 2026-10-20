import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { searchZones, zoneCity, zoneRegion, offsetLabel, zoneTime } from '../apps/model.js';

// The real list from the system's tables, searched the way people type.
const zones = JSON.parse(execFileSync(new URL('../backend/timezones.sh', import.meta.url).pathname, { encoding: 'utf8' }));
assert(zones.length > 300, 'Every zone in the system tables');
assert(zones.every(item => /^[+-]\d{4}$/.test(item.offset)), 'Each zone has its offset');
const first = query => searchZones(zones, query)[0]?.zone;
assert.equal(first('syd'), 'Australia/Sydney', 'A city prefix finds the city');
assert.equal(first('Sydney'), 'Australia/Sydney');
assert.equal(first('new york'), 'America/New_York', 'Several words match a city');
assert.equal(first('new_york'), 'America/New_York');
assert.equal(first('uk'), 'Europe/London', 'Common names find countries');
assert.equal(first('germany'), 'Europe/Berlin', 'Countries find their zones');
assert.equal(first('kolkata'), 'Asia/Kolkata');
assert.equal(first('sao paulo'), 'America/Sao_Paulo', 'Accents are optional');
assert.equal(first('utc'), 'UTC');
const australia = searchZones(zones, 'australia').map(item => item.zone);
assert(['Australia/Sydney', 'Australia/Perth', 'Australia/Darwin'].every(zone => australia.includes(zone)), 'A country lists all its zones');
assert(searchZones(zones, 'queensland').some(item => item.zone === 'Australia/Brisbane'), 'Regions match');
assert.deepEqual(searchZones(zones, 'zzzz'), [], 'Nothing matches nonsense');
// Nothing typed: the current zone first, then its country's other zones.
const browse = searchZones(zones, '', 'Australia/Sydney');
assert.equal(browse[0].zone, 'Australia/Sydney');
assert(browse.slice(1, 6).every(item => item.country === 'Australia'), 'Neighbours follow the current zone');
assert.equal(zoneCity('America/Argentina/Buenos_Aires'), 'Buenos Aires');
assert.equal(zoneRegion('America/Argentina/Buenos_Aires'), 'America / Argentina');
assert.equal(offsetLabel('+1100'), 'UTC+11');
assert.equal(offsetLabel('+0530'), 'UTC+5:30');
assert.equal(offsetLabel('-0300'), 'UTC−3');
assert.equal(offsetLabel('+0000'), 'UTC');
assert.equal(zoneTime('+0530', Date.UTC(2026, 0, 1, 23, 45)), '05:15', 'The time there, across midnight');
console.log('Timezone search: passed');
