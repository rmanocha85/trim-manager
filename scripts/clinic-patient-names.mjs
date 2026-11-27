// Apply the roster convention to each word without changing its spelling or punctuation.
export function formatNamePart(value) {
  return value.trim().replace(/\p{L}[\p{L}\p{M}]*/gu, word => {
    const [first] = word;
    return first.toUpperCase() + word.slice(first.length).toLowerCase();
  });
}

export function rosterName(lastName, firstName) {
  if (!lastName?.trim() || !firstName?.trim()) throw new Error('Verified last and given names are required.');
  return formatNamePart(lastName) + ', ' + formatNamePart(firstName);
}

export function oatIntakeName(row) {
  if (row.firstName && row.lastName) return rosterName(row.lastName, row.firstName);
  const parts = String(row.name || '').split(',');
  if (parts.length !== 2) throw new Error('Supply the verified new patient name as Surname, Given name or provide separate lastName and firstName fields.');
  return rosterName(...parts);
}

export function maidIntakeIdentity(patient) {
  return {
    name: rosterName(patient.lastName, patient.firstName),
    firstName: formatNamePart(patient.firstName),
    lastName: formatNamePart(patient.lastName)
  };
}
