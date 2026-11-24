import type { CvCountry, CvTemplate } from '@jobhunter/shared';

/** CV conventions per country (spec §5.4: "the CV conventions of the selected country/language"). */
export interface CountryConvention {
  country: CvCountry;
  language: string;
  paper: 'A4' | 'Letter';
  photo: 'common' | 'optional' | 'avoid';
  personalDetails: boolean; // date of birth / nationality / permit
  pages: 1 | 2;
  dateFormat: Intl.DateTimeFormatOptions;
  locale: string;
  suggestedTemplates: CvTemplate[];
  notes: string;
}

export const CONVENTIONS: Record<CvCountry, CountryConvention> = {
  US: { country: 'US', language: 'en', paper: 'Letter', photo: 'avoid', personalDetails: false, pages: 1, locale: 'en-US', dateFormat: { month: 'short', year: 'numeric' }, suggestedTemplates: ['harvard', 'compact'], notes: 'One page, no photo, no date of birth or marital status.' },
  UK: { country: 'UK', language: 'en', paper: 'A4', photo: 'avoid', personalDetails: false, pages: 2, locale: 'en-GB', dateFormat: { month: 'short', year: 'numeric' }, suggestedTemplates: ['modern', 'harvard'], notes: 'Two pages are normal; no photo or date of birth.' },
  CH: { country: 'CH', language: 'de', paper: 'A4', photo: 'common', personalDetails: true, pages: 2, locale: 'de-CH', dateFormat: { month: '2-digit', year: 'numeric' }, suggestedTemplates: ['european', 'modern'], notes: 'Photo, nationality and work permit are common.' },
  DE: { country: 'DE', language: 'de', paper: 'A4', photo: 'optional', personalDetails: true, pages: 2, locale: 'de-DE', dateFormat: { month: '2-digit', year: 'numeric' }, suggestedTemplates: ['european', 'modern'], notes: 'Tabular CV; photo optional since anti-discrimination law but still common.' },
  FR: { country: 'FR', language: 'fr', paper: 'A4', photo: 'optional', personalDetails: false, pages: 1, locale: 'fr-FR', dateFormat: { month: '2-digit', year: 'numeric' }, suggestedTemplates: ['modern', 'compact'], notes: 'One to two pages; photo optional.' },
  ES: { country: 'ES', language: 'es', paper: 'A4', photo: 'optional', personalDetails: false, pages: 2, locale: 'es-ES', dateFormat: { month: '2-digit', year: 'numeric' }, suggestedTemplates: ['modern', 'european'], notes: 'Photo optional.' },
  PT: { country: 'PT', language: 'pt', paper: 'A4', photo: 'optional', personalDetails: false, pages: 2, locale: 'pt-PT', dateFormat: { month: '2-digit', year: 'numeric' }, suggestedTemplates: ['modern', 'european'], notes: 'Photo optional; Europass-style layouts are common.' },
  MX: { country: 'MX', language: 'es', paper: 'Letter', photo: 'optional', personalDetails: false, pages: 2, locale: 'es-MX', dateFormat: { month: 'short', year: 'numeric' }, suggestedTemplates: ['modern', 'harvard'], notes: 'Letter paper; photo optional. Never include CURP, RFC or marital status.' },
};

export const LABELS: Record<string, Record<string, string>> = {
  en: { summary: 'Profile', experience: 'Experience', education: 'Education', skills: 'Skills', languages: 'Languages', projects: 'Projects', certificates: 'Certifications', additional: 'Additional Information', personal: 'Personal details', dateOfBirth: 'Date of birth', nationality: 'Nationality', workAuthorization: 'Work authorization', present: 'Present', subject: 'Application: {{title}}', page: 'Page' },
  de: { summary: 'Profil', experience: 'Berufserfahrung', education: 'Ausbildung', skills: 'Kenntnisse', languages: 'Sprachen', projects: 'Projekte', certificates: 'Zertifikate', additional: 'Weitere Angaben', personal: 'Persönliche Angaben', dateOfBirth: 'Geburtsdatum', nationality: 'Nationalität', workAuthorization: 'Arbeitsbewilligung', present: 'heute', subject: 'Bewerbung als {{title}}', page: 'Seite' },
  fr: { summary: 'Profil', experience: 'Expérience professionnelle', education: 'Formation', skills: 'Compétences', languages: 'Langues', projects: 'Projets', certificates: 'Certifications', additional: 'Informations complémentaires', personal: 'Informations personnelles', dateOfBirth: 'Date de naissance', nationality: 'Nationalité', workAuthorization: 'Permis de travail', present: 'aujourd’hui', subject: 'Candidature : {{title}}', page: 'Page' },
  es: { summary: 'Perfil', experience: 'Experiencia profesional', education: 'Formación', skills: 'Habilidades', languages: 'Idiomas', projects: 'Proyectos', certificates: 'Certificaciones', additional: 'Información adicional', personal: 'Datos personales', dateOfBirth: 'Fecha de nacimiento', nationality: 'Nacionalidad', workAuthorization: 'Permiso de trabajo', present: 'actualidad', subject: 'Candidatura: {{title}}', page: 'Página' },
  pt: { summary: 'Perfil', experience: 'Experiência profissional', education: 'Formação', skills: 'Competências', languages: 'Idiomas', projects: 'Projetos', certificates: 'Certificações', additional: 'Informação adicional', personal: 'Dados pessoais', dateOfBirth: 'Data de nascimento', nationality: 'Nacionalidade', workAuthorization: 'Autorização de trabalho', present: 'atual', subject: 'Candidatura: {{title}}', page: 'Página' },
  it: { summary: 'Profilo', experience: 'Esperienza professionale', education: 'Formazione', skills: 'Competenze', languages: 'Lingue', projects: 'Progetti', certificates: 'Certificazioni', additional: 'Ulteriori informazioni', personal: 'Dati personali', dateOfBirth: 'Data di nascita', nationality: 'Nazionalità', workAuthorization: 'Permesso di lavoro', present: 'oggi', subject: 'Candidatura: {{title}}', page: 'Pagina' },
};

export function labels(language: string): Record<string, string> {
  return LABELS[language] ?? LABELS.en!;
}
