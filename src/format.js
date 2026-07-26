// Times from Entur carry the correct offset; show the local wall-clock part verbatim.
export function hhmm(iso) {
  return typeof iso === 'string' ? iso.slice(11, 16) : '';
}

export function dur(seconds) {
  const m = Math.round(seconds / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

// Minutes of delay between aimed and expected ISO times; '' when on time.
export function delayStr(aimed, expected) {
  if (!aimed || !expected) return '';
  const min = Math.round((new Date(expected) - new Date(aimed)) / 60000);
  return min > 0 ? `+${min}m` : '';
}
