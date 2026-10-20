// Use only the stored Ava chart ID, never a name or PHN search.
export function avaChartUrl(patient){
  const id=String(patient?.ava||'').trim();
  return /^\d{6,10}$/.test(id)?`https://www.avaemr.ca/patients/${id}`:'';
}
