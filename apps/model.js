export const pages = ['connection', 'disk', 'customise', 'account', 'review', 'install', 'complete'];
export const stages = ['preflight', 'partition', 'encrypt', 'format', 'packages', 'runtime', 'account', 'desktop', 'wallpaper', 'services', 'boot', 'finish'];
export const optionalApps = [
  { id: 'firefox', name: 'Firefox', description: 'Web browser · Super+B', packages: ['firefox'] },
  { id: 'files', name: 'Files', description: 'Nautilus file manager · Super+E', packages: ['nautilus'] },
  { id: 'audio', name: 'Audio controls', description: 'Advanced sound configuration', packages: ['pavucontrol'] },
  { id: 'screenshots', name: 'Screenshot tools', description: 'Select, capture and annotate · Print', packages: ['grim', 'slurp', 'swappy', 'wl-clipboard', 'otf-font-awesome'] }
];
export const initialConfig = () => ({ disk: '', diskKey: '', username: 'user', hostname: 'koya', timezone: 'Australia/Sydney',
  encrypt: true, apps: optionalApps.map(app => app.id) });
export function accountError(config, secrets) {
  if (!/^[a-z_][a-z0-9_-]{0,30}$/.test(config.username) || config.username === 'root') return 'Use a valid account name, other than root.';
  if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(config.hostname)) return 'Enter a valid computer name.';
  if (!/^[A-Za-z0-9_+/-]{1,128}$/.test(config.timezone) || config.timezone.includes('..')) return 'Enter a timezone such as Australia/Sydney.';
  if (secrets.password.length < 8 || secrets.password.length > 512) return 'Use an account password of 8–512 characters.';
  if (secrets.password !== secrets.passwordAgain) return 'The account passwords do not match.';
  return '';
}
// The disk passphrase, asked on its own page when encryption is on.
export function passphraseError(config, secrets) {
  if (!config.encrypt) return '';
  if (secrets.luks.length < 8 || secrets.luks.length > 512) return 'Use a disk passphrase of 8–512 characters.';
  if (secrets.luks !== secrets.luksAgain) return 'The disk passphrases do not match.';
  return '';
}
// Everything installation needs, checked once more before erasing.
export const installError = (config, secrets) => accountError(config, secrets) || passphraseError(config, secrets);
export const emptySecrets = () => ({ password: '', passwordAgain: '', luks: '', luksAgain: '' });
export const capacity = bytes => (Number(bytes) / 1073741824).toFixed(1) + ' GiB';
export function frame(value) {
  const text = JSON.stringify(value) + '\n';
  // The installed process plugin writes synchronously. Keep each message
  // below PIPE_BUF and send one frame per worker acknowledgement.
  if (unescape(encodeURIComponent(text)).length > 4096) throw new Error('Installer message is too large');
  return text;
}
export function eventStream(receive) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    if (buffer.length > 65536) throw new Error('Invalid installer event stream');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      if (line) receive(JSON.parse(line));
    }
  };
}

// ---- Timezones ---------------------------------------------------------------
// Zones come from the system's tables (backend/timezones.sh): { zone, country,
// comment, offset: '+1100' }. People search by city, country, region or
// common name; every word typed must start a word of the zone's description.
const ALIASES = { 'Britain (UK)': 'uk united kingdom england scotland wales great britain', 'United States': 'usa us america',
  'United Arab Emirates': 'uae', 'Korea (South)': 'south korea', 'Korea (North)': 'north korea', 'Russia': 'russian federation' };
const words = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9+-]+/).filter(Boolean);
export const zoneCity = zone => zone.split('/').pop().replace(/_/g, ' ');
export const zoneRegion = zone => zone.includes('/') ? zone.split('/').slice(0, -1).join(' / ').replace(/_/g, ' ') : '';
export const offsetMinutes = offset => { const m = /^([+-])(\d\d)(\d\d)$/.exec(offset || ''); return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0; };
export const offsetLabel = offset => {
  const minutes = offsetMinutes(offset), sign = minutes < 0 ? '−' : '+', abs = Math.abs(minutes);
  return minutes === 0 ? 'UTC' : 'UTC' + sign + Math.floor(abs / 60) + (abs % 60 ? ':' + String(abs % 60).padStart(2, '0') : '');
};
// The time there now, as HH:MM.
export const zoneTime = (offset, now = Date.now()) => {
  const date = new Date(now + offsetMinutes(offset) * 60000);
  return String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0');
};
const countryOf = item => String(item.country || '').split(', ')[0];
export function searchZones(zones, query, current = '', limit = 40) {
  const terms = words(query);
  const byCity = (a, b) => zoneCity(a.zone).localeCompare(zoneCity(b.zone));
  if (!terms.length) {
    // Nothing typed: the current zone, its neighbours, then everything.
    const here = zones.find(item => item.zone === current), country = here && countryOf(here);
    const near = zones.filter(item => item !== here && country && countryOf(item) === country).sort(byCity);
    const rest = zones.filter(item => item !== here && !near.includes(item)).sort(byCity);
    return [...(here ? [here] : []), ...near, ...rest].slice(0, limit);
  }
  const scored = [];
  for (const item of zones) {
    const city = words(zoneCity(item.zone)), country = words(item.country + ' ' + (ALIASES[countryOf(item)] || ''));
    const all = [...city, ...country, ...words(zoneRegion(item.zone)), ...words(item.comment), ...words(offsetLabel(item.offset))];
    if (!terms.every(term => all.some(word => word.startsWith(term)))) continue;
    const joined = city.join(' '), phrase = terms.join(' ');
    // The city itself, then a city word, then a country named exactly (uk), then
    // a country prefix (Ukraine for "uk" comes after Britain), then anything.
    const rank = joined === phrase ? 0 : joined.startsWith(phrase) ? 1 : city.some(word => word.startsWith(terms[0])) ? 2
      : country.includes(terms[0]) ? 3 : country.some(word => word.startsWith(terms[0])) ? 4 : 5;
    scored.push({ item, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank || byCity(a.item, b.item)).slice(0, limit).map(entry => entry.item);
}
