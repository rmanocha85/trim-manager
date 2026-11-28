import {formatNamePart,rosterName} from '../public/patient-names.mjs';
export {formatNamePart,rosterName};

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
