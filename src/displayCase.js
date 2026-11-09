// Names of machines, labor services (Serviços), stages (Etapas) and stock materials (name and specification) show in
// capital letters everywhere on screen. The database and the API keep them as typed: searches, the matching by name
// (stages of an OS, resources of an offer) and the edit forms work on the original text. Inputs use the CSS class
// `upper-input`, which only changes how the typed text looks.
export const upper = (value) => value == null || value === '' ? value : String(value).toLocaleUpperCase('pt-BR')
