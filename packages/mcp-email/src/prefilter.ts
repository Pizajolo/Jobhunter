import { domainMatches, registrableDomain } from '@jobhunter/shared';
import type { RawEmail } from './types.js';

/** Sender domains of ATS systems and recruiting tools. */
export const ATS_SENDER_DOMAINS = [
  'greenhouse.io', 'greenhouse-mail.io', 'lever.co', 'hire.lever.co', 'ashbyhq.com', 'smartrecruiters.com', 'workable.com',
  'workablemail.com', 'recruitee.com', 'personio.de', 'personio.com', 'myworkday.com', 'workday.com', 'successfactors.com',
  'successfactors.eu', 'taleo.net', 'icims.com', 'jobvite.com', 'bamboohr.com', 'teamtailor.com', 'teamtailor-mail.com',
  'join.com', 'softgarden.io', 'softgarden.de', 'rexx-systems.com', 'umantis.com', 'onlyfy.com', 'prescreen.io',
  'pinpointhq.com', 'breezy.hr', 'jazzhr.com', 'recruiterbox.com', 'comeet.co', 'gem.com', 'dover.com', 'rippling.com',
  'eightfold.ai', 'phenompeople.com', 'avature.net', 'beamery.com', 'hirebridge.com', 'cornerstoneondemand.com',
];

/** Job-alert senders. LinkedIn jobs enter Jobhunter only this way (spec §2.3). */
export const ALERT_SENDERS = [
  'jobalerts-noreply@linkedin.com', 'jobs-noreply@linkedin.com', 'jobs-listings@linkedin.com', 'alert@indeed.com',
  'noreply@indeed.com', 'noreply@glassdoor.com', 'jobs@stepstone.de', 'noreply@xing.com', 'jobs.ch', 'jobup.ch',
  'welcometothejungle.com', 'infojobs.net', 'occ.com.mx', 'computrabajo.com', 'jobs@remotive.com', 'weworkremotely.com',
  'arbeitnow.com', 'otta.com', 'wellfound.com',
];

const KEYWORDS: RegExp[] = [
  // Recruiter outreach, all languages
  /\b(recruiter|recruiting|headhunter|talent acquisition|personalberater(in)?|recruteur|recruteuse|chasseur de têtes|reclutador(a)?|recrutador(a)?|selezionatore|opportunity|opportunité|oportunidad|oportunidade|opportunità|vacante|vaga)\b/iu,
  // EN
  /\b(your application|application (received|for)|thank you for applying|thanks for applying|unfortunately|regret to inform|not (be )?moving forward|other candidates|interview|next steps?|assessment|coding challenge|take-home|offer letter|job offer|recruiter|hiring manager|position|role at)\b/iu,
  // DE
  /\b(ihre bewerbung|deine bewerbung|bewerbung als|leider|absage|nicht berücksichtigen|anderen kandidaten|vorstellungsgespräch|kennenlerngespräch|interview|einladung|eignungstest|stellenangebot|vertragsangebot)\b/iu,
  // FR
  /\b(votre candidature|candidature|malheureusement|nous regrettons|entretien|entrevue|test technique|offre d'emploi|proposition d'embauche)\b/iu,
  // IT
  /\b(la tua candidatura|la sua candidatura|purtroppo|colloquio|offerta di lavoro|valutazione)\b/iu,
  // PT
  /\b(sua candidatura|tua candidatura|infelizmente|entrevista|proposta de emprego|oferta de emprego|avaliação)\b/iu,
  // ES
  /\b(tu candidatura|su candidatura|tu solicitud|lamentablemente|desafortunadamente|entrevista|oferta de empleo|oferta laboral|prueba técnica)\b/iu,
];

export interface PrefilterContext {
  /** Domains of companies the user applied to or is tracking. */
  companyDomains: string[];
  /** Normalised company names the user applied to (matched in subject/sender name). */
  companyNames: string[];
  extraAtsDomains?: string[];
}

export interface PrefilterResult {
  pass: boolean;
  reason: 'ats_sender' | 'company_domain' | 'alert_sender' | 'keyword' | 'company_name' | null;
}

function senderDomain(addr: string): string {
  return addr.slice(addr.lastIndexOf('@') + 1).toLowerCase();
}

/** Cheap, local filter so only job-related mail reaches the model (spec §5.5 step 1). */
export function prefilter(email: RawEmail, ctx: PrefilterContext): PrefilterResult {
  const dom = senderDomain(email.fromAddress);
  if (ALERT_SENDERS.some((a) => (a.includes('@') ? email.fromAddress === a : domainMatches(dom, a)))) return { pass: true, reason: 'alert_sender' };
  if ([...ATS_SENDER_DOMAINS, ...(ctx.extraAtsDomains ?? [])].some((d) => domainMatches(dom, d))) return { pass: true, reason: 'ats_sender' };
  if (ctx.companyDomains.some((d) => domainMatches(dom, d) || registrableDomain(dom) === registrableDomain(d))) return { pass: true, reason: 'company_domain' };
  const head = `${email.subject}\n${email.fromName}`.toLowerCase();
  if (ctx.companyNames.some((n) => n.length > 2 && head.includes(n))) return { pass: true, reason: 'company_name' };
  const sample = `${email.subject}\n${email.text.slice(0, 4000)}`;
  if (KEYWORDS.some((re) => re.test(sample))) return { pass: true, reason: 'keyword' };
  return { pass: false, reason: null };
}

/** Newsletters and marketing are noise even when they mention "interview" or "position". */
export function looksLikeBulk(email: RawEmail): boolean {
  return /unsubscribe|abmelden|se désabonner|darse de baja|cancelar inscrição/iu.test(email.text.slice(-1500)) && !/application|bewerbung|candidat|solicitud/iu.test(email.subject);
}
